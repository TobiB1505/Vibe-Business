import type { ValidationDepth } from "@/modules/validation/depth";
import type { ConfidenceLevel } from "./confidence";

/**
 * Versioned economic assumptions (Sprint 0054, PART K).
 *
 * ## Why this is a version and not a constant
 *
 * `const STANDARD_PRICE = 300` is the shape this file exists to prevent. Every
 * number below is an *assumption about a market* — what a provider charges,
 * what margin Vibe targets, how much a larger repository costs to reason about.
 * Markets move: Anthropic's own price book already contains a step on
 * 2026-09-01, and `ai/pricing.ts` carries both sides of it because a price
 * change must never rewrite what past usage cost.
 *
 * The same rule has to hold one level up. An estimate produced in August under
 * August's assumptions must stay reproducible in December, or "why did Vibe
 * quote that?" becomes unanswerable. So versions accumulate and never mutate,
 * and an estimate carries the version that produced it.
 *
 * ## Why the intervals are half-open
 *
 * `[effectiveFrom, effectiveTo)`, matching `ai/pricing.ts` and
 * `credits/retail.ts` exactly. Three price layers with three different boundary
 * semantics is a bug that surfaces once a year, at midnight, in a number
 * somebody already sent to a customer.
 *
 * ## What this file is not
 *
 * Not a rate card, not a price, and not a decision anyone has approved. It
 * holds the *assumptions* a prediction is made under. `CREDIT_RATE_CARDS` in
 * `credits/rating.ts` stays empty; nothing here fills it.
 */

/** How repository complexity is allowed to move an estimate. */
export type RepositoryComplexityPolicy = {
  /**
   * Tree entries considered a "typical" repository. The index is a ratio
   * against this, never an absolute cost.
   */
  referenceTreeEntries: number;
  referenceRoutes: number;
  referenceCandidates: number;
  /** Bounds on the resulting multiplier. A signal may nudge; it may not dominate. */
  minMultiplier: number;
  maxMultiplier: number;
  /** How much a doubling of the complexity index moves the multiplier. */
  sensitivity: number;
};

/** What a validation depth is expected to cost in sandbox terms, before it runs. */
export type ValidationEffortAssumption = {
  /** Steps the depth runs, from `stepsForDepth` — copied here so the version is self-contained. */
  expectedSteps: number;
  /** Wall-clock the sandbox is expected to be alive for. A labelled assumption, never a measurement. */
  expectedWallMs: number;
  label: string;
};

/** Risk buffer applied to an estimate, by how much the estimate is trusted. */
export type SafetyMarginPolicy = {
  bufferByConfidence: Record<ConfidenceLevel, number>;
  /** Hard ceiling, so a very low confidence cannot invent an arbitrarily large internal cost. */
  maxBufferFraction: number;
};

/** How far one reconciliation round is allowed to move future estimates. */
export type AdjustmentPolicy = {
  maxIncrease: number;
  maxDecrease: number;
  /** Below this many comparable observations, the answer is "no adjustment", not a small one. */
  minSamples: number;
};

export type EconomyModelVersion = {
  version: string;
  /** Inclusive ISO instant. */
  effectiveFrom: string;
  /** Exclusive ISO instant; null means current. */
  effectiveTo: string | null;
  /**
   * The margin Vibe aims at, from CREDIT_PRICING_V1 §10. Recorded so a
   * prediction can be read against the target it was made under — never applied
   * to a customer, because no customer-facing Agent price exists.
   */
  marginTarget: number;
  /** Which `ai/pricing.ts` rows this version assumes. Documentation of dependency, not a copy of the rates. */
  providerPricingVersions: readonly string[];
  /** Which `infrastructure-rates.ts` card this version assumes. */
  infrastructurePricingVersion: string;
  repositoryPolicy: RepositoryComplexityPolicy;
  validationAssumptions: Record<ValidationDepth, ValidationEffortAssumption>;
  /**
   * Roughly how much of a delivered run's cost is validation.
   *
   * Needed because a depth change must scale the validation *share* of an
   * estimate, not the whole of it — the historical baseline already contains
   * whatever validation those runs did, and multiplying the entire figure by a
   * depth ratio would reprice the model spend along with it.
   */
  assumedValidationCostShare: number;
  adjustmentPolicy: AdjustmentPolicy;
  safetyPolicy: SafetyMarginPolicy;
};

/**
 * Every version ever issued, oldest first. Append only.
 *
 * Editing an entry in place would silently reinterpret every estimate already
 * made under it, which is the exact failure `ai/pricing.ts` avoids by keeping
 * the superseded Sonnet row rather than overwriting it.
 */
export const ECONOMY_MODEL_VERSIONS: readonly EconomyModelVersion[] = [
  {
    version: "economy-model.v1",
    effectiveFrom: "2026-08-20T00:00:00Z",
    effectiveTo: null,
    marginTarget: 0.75,
    providerPricingVersions: ["claude-sonnet-5-introductory-2026", "claude-sonnet-5-standard-2026-09"],
    infrastructurePricingVersion: "vercel-sandbox-2026-08-20",
    repositoryPolicy: {
      // Vibe's own repository at the time of the dataset, which is the only
      // repository any delivered run has ever worked against.
      referenceTreeEntries: 1_200,
      referenceRoutes: 30,
      referenceCandidates: 12,
      minMultiplier: 0.75,
      maxMultiplier: 1.75,
      sensitivity: 0.25,
    },
    validationAssumptions: {
      // Step counts mirror `stepsForDepth`, and a test pins them against it so
      // this copy cannot drift — it already caught a draft that assumed `fast`
      // skipped the build. It does not: `fast` skips exactly one step, `test`,
      // because a run that never built cannot be recorded as passed and its
      // artifact is what a preview boots from.
      //
      // `deep` runs the same four steps as `standard` today. That is not an
      // error to be tidied away: the distinction is recorded on every run and
      // is the hook a genuinely deeper check will attach to. Assuming a longer
      // wall time for it would invent a cost difference that does not exist, so
      // the two assumptions are identical until the step lists diverge.
      //
      // The durations are labelled assumptions. No validation run has ever been
      // timed per depth.
      fast: { expectedSteps: 3, expectedWallMs: 150_000, label: "assumed: install + typecheck + build" },
      standard: { expectedSteps: 4, expectedWallMs: 210_000, label: "assumed: install + typecheck + test + build" },
      deep: { expectedSteps: 4, expectedWallMs: 210_000, label: "assumed: same four steps as standard, until deep grows one" },
    },
    // Derived from the dataset rather than picked: the floor-to-upper band on a
    // delivered run *is* the validation active-CPU component, and it averages
    // $0.0484 across the six validated runs against a mean floor of $0.3041 —
    // 15.9%. Rounded down to 0.15, and an under-estimate either way, because the
    // band captures validation's CPU uncertainty and not its memory or creation
    // cost. Run #4 is excluded from the average: it was never validated at all,
    // which is an absence rather than a zero.
    assumedValidationCostShare: 0.15,
    adjustmentPolicy: {
      // A learning loop that can raise its own cost expectation by 3x in one
      // round is not a learning loop, it is an outage.
      maxIncrease: 1.25,
      maxDecrease: 0.8,
      minSamples: 20,
    },
    safetyPolicy: {
      bufferByConfidence: { none: 0.5, low: 0.3, medium: 0.15, high: 0.05 },
      maxBufferFraction: 0.5,
    },
  },
];

export class UnversionedEconomyError extends Error {
  constructor(at: Date) {
    super(`No economy model version is effective at ${at.toISOString()}`);
    this.name = "UnversionedEconomyError";
  }
}

/**
 * The version effective at an instant.
 *
 * Throws rather than falling back to the newest. A silent fallback would let an
 * estimate be made under assumptions that did not exist when it was made, which
 * is the one thing versioning is for.
 */
export function resolveEconomyModel(at: Date): EconomyModelVersion {
  const instant = at.getTime();

  const match = ECONOMY_MODEL_VERSIONS.find((version) => {
    const from = Date.parse(version.effectiveFrom);
    const to = version.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(version.effectiveTo);
    return instant >= from && instant < to;
  });

  if (!match) throw new UnversionedEconomyError(at);
  return match;
}

/** A named version, for reproducing a past estimate. Null when the name is unknown. */
export function economyModelByVersion(version: string): EconomyModelVersion | null {
  return ECONOMY_MODEL_VERSIONS.find((entry) => entry.version === version) ?? null;
}
