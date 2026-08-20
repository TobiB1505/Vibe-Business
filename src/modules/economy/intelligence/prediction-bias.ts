import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { ExecutionPricingClass } from "../execution-class";
import { type ConfidenceLevel, confidenceFromSampleSize } from "./confidence";
import type { LearningRecord } from "./learning-dataset";
import type { AdjustmentPolicy } from "./model-version";

/**
 * Which kinds of work the estimator gets wrong the same way every time
 * (Sprint 0054).
 *
 * ## Why this is the difference between a dataset and a learning loop
 *
 * `historical-similarity.ts` finds neighbours and averages them. That improves
 * with data, but it never *notices* anything — if standard Next.js UI changes
 * cost 26% more than the estimator says, every single time, similarity will
 * keep quietly under-quoting them forever, because each new under-quote becomes
 * part of the average that produces the next one.
 *
 * A loop closes when the system can say "this class of work is systematically
 * mispredicted" and carry that forward as a correction. That is a statement
 * about a cohort, not about a run, which is why the grouping key is here and
 * not on the estimate.
 *
 * ## Why the cohort key holds only pre-execution fields
 *
 * Because a correction has to be applicable *before* the next run of that kind.
 * A cohort keyed on anything observed during execution could be identified only
 * in hindsight, which is a report rather than a loop.
 *
 * ## Why "none" is the answer today, and should be
 *
 * The correction is a scalar the estimator multiplies by, so a wrong one moves
 * real money. Below `minSamples` comparable observations the direction is
 * `none` and the correction is exactly 1 — not a hedged 1.08 fitted to three
 * runs. On today's dataset every cohort is below the floor, so every cohort
 * returns 1, and the machinery is what this sprint delivers rather than the
 * numbers.
 */

export type PredictionCohort = {
  pricingClass: ExecutionPricingClass | null;
  changeKind: StepChangeKind;
  riskClass: ExecutionRiskClass;
};

export const BIAS_DIRECTIONS = [
  "none",
  "systematic_underestimate",
  "systematic_overestimate",
] as const;
export type BiasDirection = (typeof BIAS_DIRECTIONS)[number];

export type CohortBias = {
  cohort: PredictionCohort;
  sampleSize: number;
  meanRelativeError: number | null;
  medianRelativeError: number | null;
  /** `none` below the sample floor, always. */
  direction: BiasDirection;
  /** Clamped by the adjustment policy. Exactly 1 whenever `direction` is `none`. */
  suggestedCorrection: number;
  confidence: ConfidenceLevel;
};

/** Below this median error either way, the cohort is predicted well enough to leave alone. */
const ON_TARGET_BAND = 0.05;

export function cohortKey(cohort: PredictionCohort): string {
  return `${cohort.pricingClass ?? "none"}|${cohort.changeKind}|${cohort.riskClass}`;
}

export function cohortOf(record: LearningRecord): PredictionCohort {
  return {
    pricingClass: record.input.pricingClass,
    changeKind: record.input.changeKind,
    riskClass: record.input.riskClass,
  };
}

export function detectCohortBias(
  records: readonly LearningRecord[],
  policy: AdjustmentPolicy,
): readonly CohortBias[] {
  const grouped = new Map<string, { cohort: PredictionCohort; errors: number[] }>();

  for (const record of records) {
    // An incomparable observation contributes nothing rather than contributing
    // a zero — a zero would read as a perfect prediction.
    if (!record.comparison.comparable) continue;
    const error = record.comparison.relativeError;
    if (error === null) continue;

    const cohort = cohortOf(record);
    const key = cohortKey(cohort);
    const bucket = grouped.get(key) ?? { cohort, errors: [] };
    bucket.errors.push(error);
    grouped.set(key, bucket);
  }

  return [...grouped.values()]
    .map(({ cohort, errors }) => summarise(cohort, errors, policy))
    .sort((a, b) => cohortKey(a.cohort).localeCompare(cohortKey(b.cohort)));
}

function summarise(
  cohort: PredictionCohort,
  errors: readonly number[],
  policy: AdjustmentPolicy,
): CohortBias {
  const meanRelativeError = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const medianRelativeError = median(errors);

  const base = {
    cohort,
    sampleSize: errors.length,
    meanRelativeError,
    medianRelativeError,
  };

  if (errors.length < policy.minSamples) {
    return { ...base, direction: "none", suggestedCorrection: 1, confidence: "none" };
  }

  const error = medianRelativeError ?? 0;
  if (Math.abs(error) < ON_TARGET_BAND) {
    return {
      ...base,
      direction: "none",
      suggestedCorrection: 1,
      confidence: confidenceFromSampleSize(errors.length),
    };
  }

  const requested = 1 + error;

  return {
    ...base,
    direction: error > 0 ? "systematic_underestimate" : "systematic_overestimate",
    suggestedCorrection: Math.min(policy.maxIncrease, Math.max(policy.maxDecrease, requested)),
    confidence: confidenceFromSampleSize(errors.length),
  };
}

/**
 * The correction to hand `estimateExecutionEconomics` for a cohort.
 *
 * Exactly 1 for a cohort nothing is known about, which is every cohort today.
 * Returning something else for an unknown cohort would apply one kind of work's
 * error to another, which is worse than not correcting at all.
 */
export function correctionForCohort(
  biases: readonly CohortBias[],
  cohort: PredictionCohort,
): number {
  const key = cohortKey(cohort);
  return biases.find((bias) => cohortKey(bias.cohort) === key)?.suggestedCorrection ?? 1;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
