import { createServiceClient } from "@/lib/supabase/service";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import type { MeasurementFailureCode } from "@/modules/business-measurement/schema";
import {
  abortMeasurementStep,
  completeMeasurementOperationStep,
  measureBusinessOutcomeStep,
  type MeasurementDeps,
} from "./execution";

/**
 * The durable business measurement (Sprint 12B §30, §31).
 *
 * ```
 * measure ─▶ complete
 *    │
 *    └──────▶ abort (Vibe could not measure)
 * ```
 *
 * The tenth operation type, and by far the shortest — which is the point.
 *
 * ## Why this workflow does not sleep
 *
 * Sprint 12A's observation slept between attempts because its whole window was
 * fifteen minutes. This one compares windows measured in **weeks**, and a
 * workflow that slept for six weeks would be a durable run holding a slot,
 * across deploys, for a period during which the answer cannot change.
 *
 * So the waiting is expressed as **data**: `next_observation_at` on the row says
 * when the measurement becomes due, and this workflow performs exactly one
 * attempt of an already-due measurement. Whatever eventually notices that a
 * measurement is due — a page visit, an explicit action, or a scheduled runner
 * that does not exist in this architecture yet — starts it.
 *
 * That trade is recorded honestly in ADR 0021 rather than glossed: the missing
 * piece is a scheduled runner, and until one exists a measurement completes
 * when somebody comes back to look. Inventing a cron for it would be new
 * infrastructure ahead of the decision that authorises it (CLAUDE.md rules 3
 * and 24), and the preview lifecycle already set the precedent of converging
 * lazily rather than building a sweeper.
 *
 * ## Retries
 *
 * The step is read-only against the analytics source and idempotent against the
 * database — it reads two windows and writes one row conditionally — so the
 * platform default applies, bounded to two. This is the same reasoning as the
 * outcome observation's, and the opposite of the merge write's `maxRetries = 0`.
 *
 * No model is called. No sandbox is created. No browser is opened. No GitHub
 * request is made. Nothing is reverted, whatever the result says (§28, §36).
 */

function deps(): MeasurementDeps {
  return {
    supabase: createServiceClient(),
    // Vibe has no analytics connector. This resolves to nothing for every
    // project, so the honest terminal state in production today is
    // `metric_source_required` — not a fabricated number (§7, §49).
    sources: new NoConnectedMetricSources(),
  };
}

async function measure(operationId: string) {
  "use step";
  return measureBusinessOutcomeStep(deps(), operationId);
}
measure.maxRetries = 2;

async function finish(operationId: string) {
  "use step";
  await completeMeasurementOperationStep(deps(), operationId);
}

async function abort(operationId: string, failureCode: MeasurementFailureCode, retryable: boolean) {
  "use step";
  await abortMeasurementStep(deps(), operationId, { failureCode, retryable });
}

export async function businessMeasurementWorkflow(operationId: string) {
  "use workflow";

  let failure: { failureCode: MeasurementFailureCode; retryable: boolean } | null = null;

  try {
    const outcome = await measure(operationId);
    if (!outcome.ok) {
      failure = { failureCode: outcome.failureCode, retryable: outcome.retryable };
    }
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected — and it becomes "Vibe could not
    // measure", never a claim about the customer's metric (§33).
    failure = { failureCode: "measurement_failed", retryable: true };
  }

  if (failure !== null) {
    const { failureCode, retryable } = failure;
    await abort(operationId, failureCode, retryable);
    return;
  }

  await finish(operationId);
}
