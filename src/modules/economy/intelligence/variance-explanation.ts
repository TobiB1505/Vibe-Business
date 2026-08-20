import type { ValidationDepth } from "@/modules/validation/depth";
import type { ConfidenceLevel } from "./confidence";
import type { ContextPressure } from "./context-pressure";
import type { CohortBias } from "./prediction-bias";
import type { EconomicsComparison } from "./reconciliation";
import type { RepositoryDriftSignal } from "./repository-drift";

/**
 * Why a run cost what it cost (Sprint 0054).
 *
 * ## The sentence this replaces
 *
 * > "Your agent run was more expensive than expected."
 *
 * with
 *
 * > "This run cost 42% more than expected, because the repository grew 35 files
 * > since the last execution, the relevant context no longer fit the brief, and
 * > validation ran deeper than predicted."
 *
 * The second one is checkable. Every reason it gives names the signal it came
 * from, and every signal is one Vibe measured — so a founder can disagree with
 * it, which is the property that makes it trustworthy rather than reassuring.
 *
 * ## Why `unexplainedShare` exists
 *
 * Because the tempting failure is to attribute a variance to the
 * nearest-looking cause. A run that cost 40% more than expected against a
 * repository that did not move and a brief that was not clipped has *no*
 * explanation in these signals, and the honest output says so: no reasons, and
 * an unexplained share of 1.
 *
 * A layer that always produces an explanation is a layer whose explanations
 * mean nothing.
 *
 * ## Why nothing here is model output
 *
 * Every reason is a member of a closed vocabulary chosen by deterministic code
 * from measured signals. No prose is generated, and none is interpolated from
 * repository or website content (rules 25 and 36).
 */

export const VARIANCE_REASONS = [
  "repository_grew",
  "context_pressure_increased",
  "cohort_underestimates",
  "cohort_overestimates",
  "validation_deeper_than_expected",
  "validation_shallower_than_expected",
  "provider_pricing_changed",
  "prediction_had_no_historical_basis",
  "actual_cost_incomplete",
] as const;
export type VarianceReason = (typeof VARIANCE_REASONS)[number];

export const VARIANCE_DIRECTIONS = ["over", "under", "on_target", "incomparable"] as const;
export type VarianceDirection = (typeof VARIANCE_DIRECTIONS)[number];

export type AttributedReason = {
  reason: VarianceReason;
  /** A short deterministic label naming the measured signal. Never generated prose. */
  evidence: string;
  confidence: ConfidenceLevel;
  /** How much of the variance this reason plausibly accounts for, as a fraction of the whole. */
  share: number;
};

export type VarianceExplanation = {
  direction: VarianceDirection;
  relativeError: number | null;
  reasons: readonly AttributedReason[];
  /**
   * What the named reasons do not account for. 1 means nothing was explained.
   * Null when there is no variance to explain.
   */
  unexplainedShare: number | null;
};

/** Below this the prediction did its job and there is nothing to explain. */
const ON_TARGET_BAND = 0.05;

export type ExplainVarianceInput = {
  comparison: EconomicsComparison;
  drift: RepositoryDriftSignal;
  pressureAtPrediction: ContextPressure;
  pressureAtExecution: ContextPressure;
  bias: CohortBias | null;
  expectedValidationDepth: ValidationDepth | null;
  actualValidationDepth: ValidationDepth | null;
  predictedPricingVersion: string | null;
  actualPricingVersion: string | null;
  /** True when the estimate was made with no comparable runs behind it. */
  predictionHadNoHistory: boolean;
};

export function explainVariance(input: ExplainVarianceInput): VarianceExplanation {
  const { comparison } = input;

  if (!comparison.comparable) {
    return {
      direction: "incomparable",
      relativeError: comparison.relativeError,
      reasons: incomparableReasons(input),
      unexplainedShare: null,
    };
  }

  const error = comparison.relativeError ?? 0;

  if (Math.abs(error) < ON_TARGET_BAND) {
    return { direction: "on_target", relativeError: error, reasons: [], unexplainedShare: null };
  }

  const direction: VarianceDirection = error > 0 ? "over" : "under";
  const reasons = attribute(input, direction);
  const explained = reasons.reduce((sum, reason) => sum + reason.share, 0);

  return {
    direction,
    relativeError: error,
    reasons,
    unexplainedShare: Math.max(0, 1 - explained),
  };
}

function incomparableReasons(input: ExplainVarianceInput): readonly AttributedReason[] {
  const reason = input.comparison.incomparableReason;

  if (reason === "actual_incomplete") {
    return [
      {
        reason: "actual_cost_incomplete",
        evidence: "at least one cost component was never measured, so the total is a floor",
        confidence: "high",
        share: 0,
      },
    ];
  }

  if (reason === "prediction_unknown") {
    return [
      {
        reason: "prediction_had_no_historical_basis",
        evidence: "no comparable run existed when the estimate was made",
        confidence: "high",
        share: 0,
      },
    ];
  }

  return [];
}

/**
 * Attributes the variance to signals that moved in the same direction as it.
 *
 * A repository that grew explains a run costing *more*; it explains nothing
 * about a run costing less. Attributing it anyway is how an explanation layer
 * turns into a horoscope.
 */
function attribute(input: ExplainVarianceInput, direction: VarianceDirection): AttributedReason[] {
  const reasons: AttributedReason[] = [];
  const expensive = direction === "over";

  if (expensive && input.drift.driftLevel === "high_change") {
    reasons.push({
      reason: "repository_grew",
      evidence: driftEvidence(input.drift),
      confidence: "high",
      share: 0.4,
    });
  } else if (expensive && input.drift.driftLevel === "changed") {
    reasons.push({
      reason: "repository_grew",
      evidence: driftEvidence(input.drift),
      confidence: "medium",
      share: 0.2,
    });
  }

  const pressureRose =
    (input.pressureAtExecution.candidatePressure ?? 0) > (input.pressureAtPrediction.candidatePressure ?? 0);

  if (expensive && pressureRose && input.pressureAtExecution.clipped === true) {
    reasons.push({
      reason: "context_pressure_increased",
      evidence: `context pressure ${input.pressureAtExecution.signal}: the brief could not carry every relevant candidate`,
      confidence: "medium",
      share: 0.25,
    });
  }

  if (input.bias && input.bias.direction !== "none") {
    const matchesDirection =
      (expensive && input.bias.direction === "systematic_underestimate") ||
      (!expensive && input.bias.direction === "systematic_overestimate");

    if (matchesDirection) {
      reasons.push({
        reason: expensive ? "cohort_underestimates" : "cohort_overestimates",
        evidence: `this class of work is mispredicted by ${formatPercent(input.bias.medianRelativeError ?? 0)} across ${input.bias.sampleSize} runs`,
        confidence: input.bias.confidence,
        share: 0.3,
      });
    }
  }

  const depthChanged =
    input.expectedValidationDepth !== null &&
    input.actualValidationDepth !== null &&
    input.expectedValidationDepth !== input.actualValidationDepth;

  if (depthChanged) {
    const deeper = depthRank(input.actualValidationDepth) > depthRank(input.expectedValidationDepth);
    if (deeper === expensive) {
      reasons.push({
        reason: deeper ? "validation_deeper_than_expected" : "validation_shallower_than_expected",
        evidence: `validated at ${input.actualValidationDepth}, predicted ${input.expectedValidationDepth}`,
        confidence: "high",
        share: 0.15,
      });
    }
  }

  if (
    input.predictedPricingVersion !== null &&
    input.actualPricingVersion !== null &&
    input.predictedPricingVersion !== input.actualPricingVersion
  ) {
    reasons.push({
      reason: "provider_pricing_changed",
      evidence: `priced at ${input.predictedPricingVersion}, billed at ${input.actualPricingVersion}`,
      confidence: "high",
      share: 0.2,
    });
  }

  if (input.predictionHadNoHistory) {
    reasons.push({
      reason: "prediction_had_no_historical_basis",
      evidence: "the estimate rested on no comparable run",
      confidence: "high",
      share: 0.3,
    });
  }

  return reasons;
}

function driftEvidence(drift: RepositoryDriftSignal): string {
  const parts: string[] = [];

  if (drift.changedFilesSinceLastExecution !== null) {
    parts.push(`${drift.changedFilesSinceLastExecution} files`);
  }
  if (drift.newRelevantCandidates !== null) {
    parts.push(`${drift.newRelevantCandidates} relevant candidates`);
  }
  if (drift.changedRoutes !== null) {
    parts.push(`${drift.changedRoutes} routes`);
  }

  return parts.length === 0
    ? "the repository moved since the last execution"
    : `the repository moved by ${parts.join(", ")} since the last execution`;
}

function depthRank(depth: ValidationDepth | null): number {
  return depth === "deep" ? 3 : depth === "standard" ? 2 : depth === "fast" ? 1 : 0;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
