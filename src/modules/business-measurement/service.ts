import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPrefetchedFor, assertPreparedChangeIs } from "@/lib/db/latest-per-change";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange, type StoredPreparedChange } from "@/modules/execution/store";
import { resolveMeasurementContract } from "@/modules/execution/measurement-contract";
import { getLatestMergeForPreparedChange } from "@/modules/merge/store";
import type { ChangeMerge } from "@/modules/merge/schema";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  attachExecutionRun,
  createOperationRun,
  failOperationRun,
} from "@/modules/operations/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { metricDefinition } from "./metrics";
import { computeMeasurementIdentity } from "./identity";
import { measurementFailureMessage } from "./messages";
import {
  MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
  MEASUREMENT_POLICY_VERSION,
  type MeasurementFailureCode,
  type MeasurementPlan,
} from "./schema";
import { resolveSourceForMetric, type MetricSourceRegistry } from "./source";
import {
  createMeasurement,
  createMeasurementPlan,
  findMeasurementByIdentity,
  findPlanForMerge,
  getLatestMeasurementForPlan,
} from "./store";
import { buildBusinessImpactCard, type BusinessImpactCard } from "./view";
import { planWindows, windowHasClosed } from "./windows";

/**
 * Planning and measuring a business outcome (Sprint 12B §8, §34, §35, §36).
 *
 * ## Two very different acts
 *
 * **Creating a plan** is deterministic, free, and possible for every merged
 * change with a supported capability. It answers *what would we measure?* and
 * needs no connected source. That separation is the reason a project with no
 * analytics still gets a useful, honest screen rather than a blank one.
 *
 * **Starting a measurement** needs a connected source and an elapsed window,
 * and is the only path that ever contacts a vendor.
 *
 * ## What the client is allowed to say
 *
 * Two identifiers: which project, which prepared change. It cannot name the
 * metric, the direction, the windows, the timezone, the baseline, the source,
 * the classification or the sample size. Not because those are validated and
 * rejected — because there is no parameter to put them in (§44).
 *
 * ## What it costs
 *
 * Reading the card: two database reads, zero provider calls. Creating a plan:
 * one insert, zero provider calls. Starting a measurement: only the metrics
 * source, and only when one is connected and the window has closed. Never an AI
 * call, a sandbox, a browser session or a GitHub request (§36).
 */

export type PlanOutcome =
  | { kind: "created"; plan: MeasurementPlan }
  | { kind: "exists"; plan: MeasurementPlan }
  | { kind: "blocked"; reason: MeasurementFailureCode };

async function ownsProject(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<boolean> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Creates the measurement plan for a merged change, or returns the existing one.
 *
 * Idempotent by the unique index on `(project_id, change_merge_id)`: a second
 * plan for the same merge would be a second opinion about what the change was
 * for, and the product would have no basis for choosing between them.
 *
 * **Never uses model output** (§8). The plan is a pure function of the
 * capability and the project's structured business context; the opportunity's
 * prose is deliberately not read.
 */
export async function ensureMeasurementPlan(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; preparedChangeId: string },
): Promise<PlanOutcome> {
  if (!(await ownsProject(supabase, params))) {
    return { kind: "blocked", reason: "measurement_not_authorized" };
  }

  const [merge, prepared] = await Promise.all([
    getLatestMergeForPreparedChange(supabase, params),
    getPreparedChange(supabase, params),
  ]);

  // A change that never reached the default branch has no period after it to
  // measure. Not a failure — a statement of order (§37).
  if (!merge || merge.status !== "merged" || !prepared) {
    return { kind: "blocked", reason: "measurement_merge_required" };
  }

  const existing = await findPlanForMerge(supabase, {
    projectId: params.projectId,
    changeMergeId: merge.id,
  });
  if (existing) return { kind: "exists", plan: existing };

  const founderIntent = await getFounderIntent(supabase, params.projectId);
  const contract = resolveMeasurementContract({
    capability: prepared.capability,
    founderIntent: founderIntent.intent,
  });

  if (!contract.supported) {
    // Recorded as a plan rather than as nothing, because "Vibe cannot define a
    // metric for this" is itself the answer a user needs, and a missing row
    // would render identically to "we have not looked yet" (§8).
    const created = await createMeasurementPlan(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      preparedChangeId: prepared.id,
      changeMergeId: merge.id,
      businessGoal: contract.reason,
      // The columns are not nullable, so an unsupported plan still carries a
      // shape. Its `status` is what any reader must consult, and the view never
      // renders a metric for an unsupported plan.
      primaryMetric: "search_impressions",
      secondaryMetrics: [],
      metricDirection: "higher_is_better",
      metricCategory: "search_visibility",
      compatibleSourceKinds: [],
      baselineDays: 1,
      measurementDays: 1,
      settlingDays: 0,
      minimumObservations: 0,
      measurementProfile: "unsupported",
      measurementProfileVersion: "unsupported",
      measurementPolicyVersion: MEASUREMENT_POLICY_VERSION,
      status: "unsupported",
      unsupportedReason: contract.reason,
    });

    if (!created.ok) return { kind: "blocked", reason: "measurement_persistence_failed" };
    return { kind: "created", plan: created.plan };
  }

  const profile = contract.profile;

  const created = await createMeasurementPlan(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    preparedChangeId: prepared.id,
    changeMergeId: merge.id,
    businessGoal: contract.businessGoal,
    primaryMetric: profile.primaryMetric,
    secondaryMetrics: profile.secondaryMetrics,
    metricDirection: profile.metricDirection,
    metricCategory: profile.metricCategory,
    compatibleSourceKinds: profile.compatibleSourceKinds,
    baselineDays: profile.baselineDays,
    measurementDays: profile.measurementDays,
    settlingDays: profile.settlingDays,
    minimumObservations: profile.minimumObservations,
    measurementProfile: profile.profile,
    measurementProfileVersion: profile.profileVersion,
    measurementPolicyVersion: MEASUREMENT_POLICY_VERSION,
    status: "ready",
    unsupportedReason: null,
  });

  if (!created.ok) {
    if (created.error === "already_exists") {
      const raced = await findPlanForMerge(supabase, {
        projectId: params.projectId,
        changeMergeId: merge.id,
      });
      if (raced) return { kind: "exists", plan: raced };
    }
    return { kind: "blocked", reason: "measurement_persistence_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "business_measurement.created",
    metadata: {
      project_id: params.projectId,
      measurement_plan_id: created.plan.id,
      change_merge_id: merge.id,
      prepared_change_id: prepared.id,
      capability: prepared.capability,
      primary_metric: created.plan.primaryMetric,
      metric_direction: created.plan.metricDirection,
      baseline_days: created.plan.baselineDays,
      measurement_days: created.plan.measurementDays,
      settling_days: created.plan.settlingDays,
      measurement_policy_version: MEASUREMENT_POLICY_VERSION,
    },
  });

  return { kind: "created", plan: created.plan };
}

export type StartMeasurementOutcome =
  | { kind: "started"; measurementId: string }
  /** Already asked — the same question is in flight or already answered (§35). */
  | { kind: "active"; measurementId: string }
  | { kind: "blocked"; reason: MeasurementFailureCode };

/**
 * Starts measuring, when there is anything to measure with (§34).
 *
 * The two refusals before anything is created are the honest ones:
 *
 *  - **no compatible source** → `metric_source_required`. Today this is every
 *    project, because Vibe has no analytics connector. The product says so and
 *    offers no button rather than pretending (§7, §21, §49).
 *  - **the window has not closed** → the row is created `waiting_for_window`
 *    with `next_observation_at` set, so the wait is recorded rather than lost.
 */
export async function startBusinessMeasurement(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  sources: MetricSourceRegistry,
  params: { projectId: string; userId: string; preparedChangeId: string; now?: Date },
): Promise<StartMeasurementOutcome> {
  const now = params.now ?? new Date();

  const planned = await ensureMeasurementPlan(supabase, params);
  if (planned.kind === "blocked") return { kind: "blocked", reason: planned.reason };

  const plan = planned.plan;
  if (plan.status !== "ready") return { kind: "blocked", reason: "measurement_not_defined" };

  const merge = await getLatestMergeForPreparedChange(supabase, params);
  if (!merge || merge.status !== "merged" || merge.mergedAt === null) {
    return { kind: "blocked", reason: "measurement_merge_required" };
  }

  // A compatible source must exist before anything is created. Creating a
  // measurement nobody can perform would put a permanent `waiting_for_source`
  // row in the table for every project in the product (§34).
  const source = await resolveSourceForMetric(sources, {
    projectId: params.projectId,
    metricKey: plan.primaryMetric,
  });
  if (source === null) return { kind: "blocked", reason: "metric_source_required" };

  const windows = planWindows({
    mergedAt: new Date(merge.mergedAt),
    baselineDays: plan.baselineDays,
    measurementDays: plan.measurementDays,
    settlingDays: plan.settlingDays,
  });

  const identity = computeMeasurementIdentity({
    projectId: params.projectId,
    changeMergeId: merge.id,
    measurementPlanId: plan.id,
    metricKey: plan.primaryMetric,
    baselineStart: windows.baseline.start,
    baselineEnd: windows.baseline.end,
    measurementStart: windows.measurement.start,
    measurementEnd: windows.measurement.end,
    measurementPolicyVersion: MEASUREMENT_POLICY_VERSION,
  });

  // Already asked. Returning the existing record is the honest answer to a
  // double click and to a deliberate re-request alike (§35).
  const existing = await findMeasurementByIdentity(supabase, {
    projectId: params.projectId,
    measurementIdentity: identity,
  });
  if (existing) return { kind: "active", measurementId: existing.id };

  const due = windowHasClosed(windows.measurement, now);

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "business_measurement",
    inputIdentity: identity,
    initiatedBy: "customer",
  });
  if (!created.ok) {
    if (created.error === "already_active") {
      const raced = await findMeasurementByIdentity(supabase, {
        projectId: params.projectId,
        measurementIdentity: identity,
      });
      if (raced) return { kind: "active", measurementId: raced.id };
    }
    return { kind: "blocked", reason: "measurement_failed" };
  }

  const operation = created.operation;

  const measurement = await createMeasurement(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    measurementPlanId: plan.id,
    changeMergeId: merge.id,
    metricKey: plan.primaryMetric,
    metricDirection: plan.metricDirection,
    metricAggregation: metricDefinition(plan.primaryMetric).aggregation,
    baselineWindow: windows.baseline,
    measurementWindow: windows.measurement,
    status: "waiting_for_window",
    measurementPolicyVersion: MEASUREMENT_POLICY_VERSION,
    measurementProfileVersion: plan.measurementProfileVersion,
    evidenceSchemaVersion: MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
    measurementIdentity: identity,
    operationRunId: operation.id,
    // The scheduling contract: when this becomes actionable (§30).
    nextObservationAt: windows.resultAvailableAt,
  });

  if (!measurement.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "measurement_persistence_failed",
    });
    return { kind: "blocked", reason: "measurement_persistence_failed" };
  }

  // **Only a due measurement is enqueued.** A workflow started six weeks early
  // would be a durable run holding a slot for a period during which the answer
  // cannot change (§30, §31). The row waits instead, and carries the instant it
  // becomes actionable.
  if (!due) {
    await failOperationRun(supabase, { operationId: operation.id, failureCode: "measurement_failed" });
    return { kind: "started", measurementId: measurement.measurement.id };
  }

  const started = await executor.start({
    operationId: operation.id,
    operationType: "business_measurement",
  });

  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    return { kind: "blocked", reason: "measurement_execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "business_measurement.started",
    metadata: {
      project_id: params.projectId,
      business_measurement_id: measurement.measurement.id,
      measurement_plan_id: plan.id,
      change_merge_id: merge.id,
      metric_key: plan.primaryMetric,
      operation_id: operation.id,
      // Vendor-neutral kind only — never a vendor name or an account id (§39).
      source_kind: source.kind,
      baseline_start: windows.baseline.start,
      baseline_end: windows.baseline.end,
      measurement_start: windows.measurement.start,
      measurement_end: windows.measurement.end,
      measurement_timezone: windows.baseline.timezone,
      measurement_policy_version: MEASUREMENT_POLICY_VERSION,
    },
  });

  return { kind: "started", measurementId: measurement.measurement.id };
}

/**
 * The business impact state for one prepared change (§21).
 *
 * ## What this costs
 *
 * Up to four database reads and **zero provider calls**. Rendering a project
 * page must never contact an analytics vendor, must never create a plan, and
 * must never start a measurement (§36, §45).
 *
 * It deliberately does *not* create the plan on read. A plan is a durable
 * record with an audit event, and creating one as a side effect of looking at a
 * page would make a page view a write.
 */
export async function getBusinessImpactCard(
  supabase: SupabaseClient,
  sources: MetricSourceRegistry,
  params: {
    projectId: string;
    preparedChangeId: string;
    now?: Date;
    /**
     * The merge and the prepared change, when the caller already holds them
     * (VB-023). The unmerged case — which is most cards — then costs no read
     * at all rather than two.
     */
    prefetched?: { merge: ChangeMerge | null; prepared: StoredPreparedChange | null };
  },
): Promise<BusinessImpactCard> {
  const [merge, prepared] = params.prefetched
    ? [
        assertPrefetchedFor(params.prefetched.merge, params, "merge"),
        assertPreparedChangeIs(params.prefetched.prepared, params),
      ]
    : await Promise.all([
        getLatestMergeForPreparedChange(supabase, params),
        getPreparedChange(supabase, params),
      ]);

  if (!merge || merge.status !== "merged" || !prepared) {
    return buildBusinessImpactCard({
      plan: null,
      measurement: null,
      sourceConnected: false,
      merged: false,
      resolveFailureMessage: measurementFailureMessage,
      now: params.now ?? new Date(),
    });
  }

  const plan = await findPlanForMerge(supabase, {
    projectId: params.projectId,
    changeMergeId: merge.id,
  });

  const measurement = plan
    ? await getLatestMeasurementForPlan(supabase, {
        projectId: params.projectId,
        measurementPlanId: plan.id,
      })
    : null;

  // Asks the registry whether anything is connected. Today that is a
  // synchronous "no" with no outbound request; when a connector exists it must
  // stay a *connection* check rather than a metric query, or opening a page
  // would start costing analytics quota (§36, §45).
  const sourceConnected =
    plan !== null && plan.status === "ready"
      ? (await resolveSourceForMetric(sources, {
          projectId: params.projectId,
          metricKey: plan.primaryMetric,
        })) !== null
      : false;

  return buildBusinessImpactCard({
    plan,
    measurement,
    sourceConnected,
    merged: true,
    resolveFailureMessage: measurementFailureMessage,
    now: params.now ?? new Date(),
  });
}

export type { BusinessImpactCard };
