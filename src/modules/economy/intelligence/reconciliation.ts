import type { AdjustmentPolicy } from "./model-version";
import { type ConfidenceLevel, confidenceFromSampleSize } from "./confidence";
import type { ActualExecutionEconomics } from "./actual-economics";
import type { ExecutionEconomicsEstimate } from "./pre-execution-estimate";

/**
 * How wrong the prediction was, and what to do about it (Sprint 0054, PART I/J).
 *
 * ## Why comparability is a field and not an assumption
 *
 * Most of Vibe's runs cannot be compared to a prediction, and pretending
 * otherwise is how a learning loop teaches itself nonsense. A prediction that
 * was `unknown` has no error; an actual cost that is a floor rather than a
 * total has an error that is itself a floor; and an estimate made under
 * `economy-model.v1` compared against costs incurred under v2's rate
 * assumptions is measuring the version change, not the prediction.
 *
 * So `comparable` is answered explicitly and `incomparableReason` names why
 * not. An incomparable pair contributes nothing to the loop rather than
 * contributing a zero.
 *
 * ## Why an adjustment is a proposal
 *
 * Nothing here activates. `reconcileExecutionEconomics` returns a number a
 * later pricing policy may choose to apply; it changes no rate card, writes no
 * row, and cannot be mistaken for an approval — `CREDIT_RATE_CARDS` is still
 * `[]` after every function in this file has run.
 *
 * And it is clamped. A loop that can raise its own cost expectation by 3x in
 * one round is not a learning loop, it is an outage with a feedback path. The
 * bounds live in the economy model version, so widening them is a version bump
 * that leaves the old bound visible.
 */

export const INCOMPARABLE_REASONS = [
  "prediction_unknown",
  "actual_incomplete",
  "model_version_mismatch",
] as const;
export type IncomparableReason = (typeof INCOMPARABLE_REASONS)[number];

export type EconomicsComparison = {
  predictedNanoUsd: number | null;
  /** The known floor. Named a floor because that is what an incomplete measurement is. */
  actualFloorNanoUsd: number | null;
  differenceNanoUsd: number | null;
  /** `(actual - predicted) / predicted`. Positive means the run cost more than expected. */
  relativeError: number | null;
  comparable: boolean;
  incomparableReason: IncomparableReason | null;
  /** True only when this pair can actually teach the estimator something. */
  learningSignal: boolean;
  economyModelVersion: string;
};

export function compareEstimateToActual(
  estimate: ExecutionEconomicsEstimate,
  actual: ActualExecutionEconomics,
  options: { actualEconomyModelVersion?: string } = {},
): EconomicsComparison {
  const predictedNanoUsd = estimate.estimatedCost.known ? estimate.estimatedCost.nanoUsd : null;

  // A floor of zero from a run where *nothing* resolved is not a cheap run, it
  // is an unmeasured one, and reporting 0 would make it the best-performing run
  // in any comparison it entered.
  const anythingKnown = Object.values(actual.components).some((component) => component.known);
  const actualFloorNanoUsd = anythingKnown ? actual.actualCost.knownFloorNanoUsd : null;

  const versionMismatch =
    options.actualEconomyModelVersion !== undefined &&
    options.actualEconomyModelVersion !== estimate.economyModelVersion;

  const incomparableReason: IncomparableReason | null = versionMismatch
    ? "model_version_mismatch"
    : predictedNanoUsd === null || predictedNanoUsd === 0
      ? "prediction_unknown"
      : !actual.actualCost.complete || actualFloorNanoUsd === null
        ? "actual_incomplete"
        : null;

  const comparable = incomparableReason === null;

  // The difference is reported whenever both numbers exist, even when the pair
  // is not comparable — a reader investigating one run still wants to see it.
  // Only `comparable` decides whether it may move future predictions.
  const differenceNanoUsd =
    predictedNanoUsd === null || actualFloorNanoUsd === null ? null : actualFloorNanoUsd - predictedNanoUsd;

  return {
    predictedNanoUsd,
    actualFloorNanoUsd,
    differenceNanoUsd,
    relativeError:
      predictedNanoUsd === null || predictedNanoUsd === 0 || differenceNanoUsd === null
        ? null
        : differenceNanoUsd / predictedNanoUsd,
    comparable,
    incomparableReason,
    learningSignal: comparable,
    economyModelVersion: estimate.economyModelVersion,
  };
}

export const ADJUSTMENT_REASONS = [
  "insufficient_samples",
  "no_comparable_observations",
  "prediction_on_target",
  "systematically_under_predicted",
  "systematically_over_predicted",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export type EconomyAdjustment = {
  /** Multiplier a future estimate may be scaled by. Exactly 1 when there is nothing to learn. */
  adjustment: number;
  /** True when the policy bounds, rather than the observations, decided the answer. */
  clamped: boolean;
  confidence: ConfidenceLevel;
  reason: AdjustmentReason;
  appliesToModelVersion: string;
  sampleSize: number;
  /** The median relative error across the comparable observations. Null when there were none. */
  medianRelativeError: number | null;
};

/** Below this median error either way, the prediction is doing its job and nothing moves. */
const ON_TARGET_BAND = 0.05;

export function reconcileExecutionEconomics(input: {
  comparisons: readonly EconomicsComparison[];
  policy: AdjustmentPolicy;
  modelVersion: string;
}): EconomyAdjustment {
  const usable = input.comparisons.filter(
    (comparison) =>
      comparison.comparable &&
      comparison.relativeError !== null &&
      comparison.economyModelVersion === input.modelVersion,
  );

  const base = {
    adjustment: 1,
    clamped: false,
    appliesToModelVersion: input.modelVersion,
    sampleSize: usable.length,
    medianRelativeError: median(usable.map((comparison) => comparison.relativeError ?? 0)),
  };

  if (usable.length === 0) {
    return { ...base, confidence: "none", reason: "no_comparable_observations" };
  }

  // Below the sample floor the answer is "no adjustment", not a small one.
  // A 1.08x correction fitted to three runs is noise with a decimal point.
  if (usable.length < input.policy.minSamples) {
    return { ...base, confidence: "none", reason: "insufficient_samples" };
  }

  const medianError = base.medianRelativeError ?? 0;

  if (Math.abs(medianError) < ON_TARGET_BAND) {
    return { ...base, confidence: confidenceFromSampleSize(usable.length), reason: "prediction_on_target" };
  }

  const requested = 1 + medianError;
  const adjustment = Math.min(input.policy.maxIncrease, Math.max(input.policy.maxDecrease, requested));

  return {
    ...base,
    adjustment,
    clamped: adjustment !== requested,
    confidence: confidenceFromSampleSize(usable.length),
    reason: medianError > 0 ? "systematically_under_predicted" : "systematically_over_predicted",
  };
}

/**
 * Median rather than mean.
 *
 * One run that hit a provider outage and burned four times its expected spend
 * should not drag the correction for every run after it. The median asks
 * whether the *typical* prediction is off, which is the question a systematic
 * correction is entitled to answer.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
