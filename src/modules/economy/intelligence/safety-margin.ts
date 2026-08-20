import type { ConfidenceLevel } from "./confidence";
import type { SafetyMarginPolicy } from "./model-version";
import type { ExecutionEconomicsEstimate } from "./pre-execution-estimate";

/**
 * What Vibe plans against, given how unsure it is (Sprint 0054, PART N').
 *
 * ## Why "protected" and not "safe"
 *
 * `safeInternalCost` was the first name and it is the wrong one. "Safe" claims
 * a certainty that does not exist — nothing here makes a run cost less than it
 * costs. What this produces is the figure Vibe should plan against *because* it
 * is unsure, which is a different and much weaker claim:
 *
 *     estimate $0.30, confidence LOW, buffer 30% -> protected $0.39
 *
 * does not say "the run costs $0.39". It says "Vibe plans against $0.39 of
 * risk". A reader who confuses those two ships a margin that evaporates the
 * first time a prediction is low.
 *
 * ## Why the buffer comes from confidence and not from the amount
 *
 * A large estimate is not an uncertain one. Vibe's most expensive observed run
 * is also one of its best-understood. What deserves a buffer is the estimate
 * nothing stands behind — a new project, an unmeasured repository, a class
 * never executed. So the buffer is a function of `confidence.overall`, and it
 * shrinks to almost nothing as evidence accumulates.
 *
 * ## Why this is internal, and stays internal
 *
 * The buffer exists because Vibe is unsure. Charging a customer for Vibe's
 * uncertainty is a pricing decision nobody has made, so `quote-simulation.ts`
 * does not read this module and a source scan in the sprint safety test asserts
 * it never starts to.
 */

export type SafetyMargin = {
  /** The estimate this buffers. Null when the estimate itself is unknown. */
  expectedNanoUsd: number | null;
  /** From the policy, by the estimate's overall confidence. */
  riskBufferFraction: number;
  /**
   * `expected * (1 + buffer)`. Null when there is no expectation — a buffer
   * applied to nothing is a number invented out of an absence, which is the one
   * thing this layer never does.
   */
  protectedCostNanoUsd: number | null;
  basis: ConfidenceLevel;
  /** True when the policy's ceiling bound the buffer rather than the confidence table. */
  clamped: boolean;
};

export function deriveSafetyMargin(
  estimate: ExecutionEconomicsEstimate,
  policy: SafetyMarginPolicy,
): SafetyMargin {
  const basis = estimate.confidence.overall;
  const requested = policy.bufferByConfidence[basis];
  const riskBufferFraction = Math.min(requested, policy.maxBufferFraction);

  const expectedNanoUsd = estimate.estimatedCost.known ? estimate.estimatedCost.nanoUsd : null;

  return {
    expectedNanoUsd,
    riskBufferFraction,
    protectedCostNanoUsd:
      expectedNanoUsd === null ? null : Math.round(expectedNanoUsd * (1 + riskBufferFraction)),
    basis,
    clamped: requested > policy.maxBufferFraction,
  };
}
