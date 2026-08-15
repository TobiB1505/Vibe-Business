import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { classifyMeasurement, summarizeSeries } from "@/modules/business-measurement/classify";
import { metricDefinition } from "@/modules/business-measurement/metrics";
import {
  resolveSourceForMetric,
  type BusinessMetricSource,
  type MetricSeries,
  type MetricSourceFailure,
  type MetricSourceRegistry,
} from "@/modules/business-measurement/source";
import type {
  BusinessOutcomeMeasurement,
  MeasurementFailureCode,
  MeasurementWindow,
  MetricProvenance,
} from "@/modules/business-measurement/schema";
import {
  completeMeasurement,
  failMeasurement,
  findMeasurementByOperation,
  markMeasuring,
} from "@/modules/business-measurement/store";
import { windowHasClosed } from "@/modules/business-measurement/windows";
import { completeOperationRun, failOperationRun, getOperationRunById, setOperationStage } from "../store";

/**
 * Durable steps for business measurement (Sprint 12B §30, §33, §38).
 *
 * ```
 * collectBaseline ─▶ collectPost ─▶ compare ─▶ complete
 *        │                │            │
 *        └────────────────┴────────────┴──────▶ fail (Vibe could not measure)
 * ```
 *
 * ## What makes this different from every operation before it
 *
 * It reads **somebody else's data about their own business**, which brings two
 * obligations nothing earlier in the pipeline had.
 *
 * First, the numbers are authoritative and a browser must not be able to write
 * them. That is why this runs under the service-role client with no update
 * policy above it (§38, §44).
 *
 * Second, a source failing is not the customer's product failing. A rate limit,
 * an expired token and an unreachable endpoint are facts about the integration,
 * and each ends the measurement with a different typed code and a different
 * next step — never a silent `degraded` (§33, and mutation 10 in §46).
 *
 * ## Why the window is re-checked here
 *
 * Because the row was created when the post-change period had not elapsed. The
 * step that collects is the last place that can confirm it now has, and it
 * reads the **stored** window rather than recomputing one — a recomputed window
 * would drift forward every time the step ran (§42).
 *
 * ## What is not here
 *
 * No model. No sandbox. No browser. No GitHub call. No deployment provider. No
 * automatic revert of anything, whatever the result says (§28, §29, §36).
 */

export type MeasurementDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The project's connected sources, injected so every path here is testable
   * with in-memory doubles that touch no vendor.
   *
   * Today this resolves to nothing for every project — Vibe has no analytics
   * connector — which is why the honest terminal state in production is
   * `metric_source_required` rather than a number (§7, §49).
   */
  sources: MetricSourceRegistry;
};

export type MeasurementStepOutcome =
  | { ok: true }
  | { ok: false; failureCode: MeasurementFailureCode; retryable: boolean };

type MeasurementContext = {
  measurement: BusinessOutcomeMeasurement;
  projectId: string;
  userId: string;
};

/**
 * Loads the measurement this operation owns.
 *
 * Ownership comes from the persisted operation row, never from an argument: the
 * service-role client bypasses RLS entirely, so every query below has to assert
 * the project itself (CLAUDE.md rule 53).
 */
async function loadContext(
  deps: MeasurementDeps,
  operationId: string,
): Promise<MeasurementContext | null> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return null;

  const measurement = await findMeasurementByOperation(deps.supabase, operationId);
  if (!measurement || measurement.projectId !== operation.projectId) return null;

  return { measurement, projectId: operation.projectId, userId: operation.userId };
}

/** Maps a source failure onto the domain's vocabulary, preserving the distinction (§33). */
function toFailureCode(failure: MetricSourceFailure): MeasurementFailureCode {
  switch (failure) {
    case "unauthorized":
      return "metric_source_unauthorized";
    case "rate_limited":
      return "metric_source_rate_limited";
    case "metric_unsupported":
      return "metric_unavailable";
    case "unavailable":
      return "metric_source_unavailable";
  }
}

function provenanceFor(
  source: BusinessMetricSource,
  series: MetricSeries,
  window: MeasurementWindow,
  measurement: BusinessOutcomeMeasurement,
): MetricProvenance {
  return {
    sourceKind: source.kind,
    // Deliberately null: the registry does not expose a connection id yet, and
    // a placeholder would be provenance that looks precise and is not. Never a
    // token, never a vendor account identifier (§18).
    connectionId: null,
    adapter: source.adapter,
    metricKey: measurement.metricKey,
    aggregation: measurement.metricAggregation,
    window,
    daysReturned: series.points.length,
    retrievedAt: series.retrievedAt,
  };
}

type Collected = {
  series: MetricSeries;
  provenance: MetricProvenance;
};

/**
 * Reads one window from the project's source.
 *
 * Returns the typed failure rather than throwing, so the caller can decide
 * between "stop and say why" and "stop and try again later" without inspecting
 * an exception (§33).
 */
async function collectWindow(
  deps: MeasurementDeps,
  context: MeasurementContext,
  window: MeasurementWindow,
): Promise<{ ok: true; collected: Collected; source: BusinessMetricSource } | { ok: false; failureCode: MeasurementFailureCode; retryable: boolean }> {
  const { measurement, projectId } = context;

  const source = await resolveSourceForMetric(deps.sources, {
    projectId,
    metricKey: measurement.metricKey,
  });

  if (source === null) {
    // The state every project is in today. Not a result, not a failure of the
    // change, and never rendered as "no impact" (§21, §48).
    return { ok: false, failureCode: "metric_source_required", retryable: true };
  }

  const result = await source.getMetricSeries({
    metricKey: measurement.metricKey,
    window,
    aggregation: measurement.metricAggregation,
  });

  if (!result.ok) {
    const failureCode = toFailureCode(result.error);
    return {
      ok: false,
      failureCode,
      // A coverage gap is permanent; a rate limit, an outage and an expired
      // token are not. Only the second group is worth coming back for.
      retryable: failureCode !== "metric_unavailable",
    };
  }

  return {
    ok: true,
    source,
    collected: {
      series: result.series,
      provenance: provenanceFor(source, result.series, window, measurement),
    },
  };
}

/**
 * The whole measurement, as one step.
 *
 * Both windows are read, compared and recorded together rather than across
 * three separately-journaled steps. That is deliberate: a measurement whose
 * baseline was fetched on Tuesday and post-window on Thursday would be
 * comparing two reads of a source that backfills between them, and the
 * `comparing` stage would have nothing to guarantee about their consistency.
 *
 * The stage markers still move, so a waiting user sees which half is in flight.
 */
export async function measureBusinessOutcomeStep(
  deps: MeasurementDeps,
  operationId: string,
  now: Date = new Date(),
): Promise<MeasurementStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, failureCode: "measurement_failed", retryable: false };

  const { measurement, projectId } = context;

  // Already answered — by a previous run, or by a concurrent one.
  if (measurement.completedAt !== null) return { ok: true };

  // The **stored** window, never a recomputed one (§42). A measurement started
  // before the period elapsed is not a failure; it is simply not due yet.
  if (!windowHasClosed(measurement.measurementWindow, now)) {
    return { ok: false, failureCode: "measurement_failed", retryable: true };
  }

  await setOperationStage(deps.supabase, {
    operationId,
    stage: "collecting_baseline",
    markRunning: true,
  });

  const baseline = await collectWindow(deps, context, measurement.baselineWindow);
  if (!baseline.ok) {
    return { ok: false, failureCode: baseline.failureCode, retryable: baseline.retryable };
  }

  await markMeasuring(deps.supabase, {
    measurementId: measurement.id,
    projectId,
    sourceKind: baseline.source.kind,
  });

  await setOperationStage(deps.supabase, { operationId, stage: "collecting_post" });

  const post = await collectWindow(deps, context, measurement.measurementWindow);
  if (!post.ok) {
    return { ok: false, failureCode: post.failureCode, retryable: post.retryable };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "comparing" });

  const aggregation = measurement.metricAggregation;
  const before = summarizeSeries(baseline.collected.series, measurement.baselineWindow, aggregation);
  const after = summarizeSeries(post.collected.series, measurement.measurementWindow, aggregation);

  const classification = classifyMeasurement({
    metricKey: measurement.metricKey,
    direction: measurement.metricDirection,
    before,
    after,
  });

  if (classification.status === "failed") {
    // Reachable only through `direction_unsupported`, which is a Vibe defect
    // rather than anything about the customer's data (§5).
    return { ok: false, failureCode: "measurement_direction_unsupported", retryable: false };
  }

  const recorded = await completeMeasurement(deps.supabase, {
    measurementId: measurement.id,
    projectId,
    status: classification.status,
    baselineValue: before.value,
    observedValue: after.value,
    observedAbsoluteChange: classification.observedAbsoluteChange,
    observedRelativeChange: classification.observedRelativeChange,
    sampleSizeBefore: before.sampleSize,
    sampleSizeAfter: after.sampleSize,
    dataQuality: classification.dataQuality,
    provenance: [baseline.collected.provenance, post.collected.provenance],
  });

  if (!recorded) {
    // The Sprint 10B failure class, refused explicitly: the external read
    // succeeded and the persistence did not, and reporting success anyway would
    // leave the product claiming a result its own store does not hold (§38).
    return { ok: false, failureCode: "measurement_persistence_failed", retryable: false };
  }

  await recordAuditEvent(deps.supabase, {
    userId: context.userId,
    eventType:
      classification.status === "insufficient_data"
        ? "business_measurement.insufficient_data"
        : "business_measurement.completed",
    metadata: {
      project_id: projectId,
      business_measurement_id: measurement.id,
      measurement_plan_id: measurement.measurementPlanId,
      change_merge_id: measurement.changeMergeId,
      metric_key: measurement.metricKey,
      metric_direction: measurement.metricDirection,
      status: classification.status,
      data_quality: classification.dataQuality,
      // Sample sizes and the relative movement only — never the daily series,
      // never a raw provider payload, never a credential (§39).
      sample_size_before: before.sampleSize,
      sample_size_after: after.sampleSize,
      observed_relative_change: classification.observedRelativeChange,
      measurement_policy_version: measurement.measurementPolicyVersion,
      source_kind: baseline.source.kind,
      adapter: baseline.source.adapter,
    },
  });

  return { ok: true };
}

/** Marks the operation complete, pointing at the measurement it produced. */
export async function completeMeasurementOperationStep(
  deps: MeasurementDeps,
  operationId: string,
): Promise<void> {
  const measurement = await findMeasurementByOperation(deps.supabase, operationId);

  if (!measurement) {
    await failOperationRun(deps.supabase, { operationId, failureCode: "measurement_failed" });
    return;
  }

  await completeOperationRun(deps.supabase, { operationId, resultId: measurement.id });
}

/**
 * Records that Vibe could not measure (§33).
 *
 * A retryable failure keeps `next_observation_at` set, so the measurement stays
 * *due* rather than becoming a dead row — which is what makes "Vibe will try
 * again" in the copy a true statement about the data rather than a promise
 * nothing keeps.
 */
export async function abortMeasurementStep(
  deps: MeasurementDeps,
  operationId: string,
  failure: { failureCode: MeasurementFailureCode; retryable: boolean; nextObservationAt?: string | null },
): Promise<void> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  const measurement = await findMeasurementByOperation(deps.supabase, operationId);

  if (measurement && operation && measurement.projectId === operation.projectId) {
    const recorded = await failMeasurement(deps.supabase, {
      measurementId: measurement.id,
      projectId: measurement.projectId,
      failureCode: failure.failureCode,
      nextObservationAt: failure.retryable
        ? (failure.nextObservationAt ?? measurement.nextObservationAt)
        : null,
    });

    if (recorded) {
      await recordAuditEvent(deps.supabase, {
        userId: operation.userId,
        eventType: "business_measurement.failed",
        metadata: {
          project_id: measurement.projectId,
          business_measurement_id: measurement.id,
          measurement_plan_id: measurement.measurementPlanId,
          change_merge_id: measurement.changeMergeId,
          metric_key: measurement.metricKey,
          failure_code: failure.failureCode,
          retryable: failure.retryable,
          measurement_policy_version: measurement.measurementPolicyVersion,
        },
      });
    }
  }

  await failOperationRun(deps.supabase, { operationId, failureCode: failure.failureCode });
}

/** Re-exported so the workflow can name the metric's aggregation without a second import path. */
export { metricDefinition };
