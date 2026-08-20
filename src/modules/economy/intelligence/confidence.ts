/**
 * How much an economic answer is worth (Sprint 0054, PART N).
 *
 * ## The failure this prevents
 *
 * "This will cost about 400 Credits" and "based on 148 similar improvements,
 * this will cost about 400 Credits" are the same number and completely
 * different claims. The first is a promise Vibe cannot keep on a project it has
 * never executed against; the second is an observation, and stays true whether
 * or not the run lands on 400.
 *
 * So no cost in this layer is representable without its confidence.
 * `EstimateConfidence` is a required field of every shape that carries an
 * amount, which means "a number with no idea how good it is" does not typecheck
 * rather than merely being discouraged.
 *
 * ## Why the overall level is the weakest link and not an average
 *
 * Averaging is how a prediction with no historical basis becomes "medium
 * confidence" on the strength of two axes that were never in doubt — Vibe knows
 * its provider prices exactly, and always will. That confidence is real and
 * says nothing about whether the estimate is any good. The binding constraint
 * is the axis that is weakest, so that is the one reported.
 */

export const CONFIDENCE_LEVELS = ["none", "low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** The weakest of the levels given. `none` when given nothing, because no evidence is not high confidence. */
export function weakestConfidence(levels: readonly ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce<ConfidenceLevel>(
    (weakest, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[weakest] ? level : weakest),
    "high",
  );
}

/** Ordering helper, so callers compare levels without re-deriving the rank. */
export function isAtLeast(level: ConfidenceLevel, floor: ConfidenceLevel): boolean {
  return CONFIDENCE_RANK[level] >= CONFIDENCE_RANK[floor];
}

/** Caps a level, used where a source is known to be weak regardless of how much of it there is. */
export function capConfidence(level: ConfidenceLevel, ceiling: ConfidenceLevel): ConfidenceLevel {
  return CONFIDENCE_RANK[level] > CONFIDENCE_RANK[ceiling] ? ceiling : level;
}

/**
 * How many comparable observations buy how much confidence.
 *
 * Deliberately conservative, and deliberately not reachable by today's dataset:
 * seven runs against one repository is `low`, and saying so is the point.
 */
export const SAMPLE_SIZE_THRESHOLDS = { low: 1, medium: 10, high: 30 } as const;

export function confidenceFromSampleSize(sampleSize: number): ConfidenceLevel {
  if (sampleSize >= SAMPLE_SIZE_THRESHOLDS.high) return "high";
  if (sampleSize >= SAMPLE_SIZE_THRESHOLDS.medium) return "medium";
  if (sampleSize >= SAMPLE_SIZE_THRESHOLDS.low) return "low";
  return "none";
}

export type EstimateConfidence = {
  /** How many comparable runs stand behind the historical component. */
  historicalData: ConfidenceLevel;
  /** Whether the repository was measured at all. */
  repositorySignal: ConfidenceLevel;
  /** Whether a rate exists for the model this execution would use. */
  providerPricing: ConfidenceLevel;
  /** The weakest of the three. Never an average. */
  overall: ConfidenceLevel;
  /**
   * The count behind `historicalData`, carried so a reader can say "based on N
   * similar improvements" rather than only "medium".
   */
  sampleSize: number;
};

export function combineConfidence(parts: {
  historicalData: ConfidenceLevel;
  repositorySignal: ConfidenceLevel;
  providerPricing: ConfidenceLevel;
  sampleSize: number;
}): EstimateConfidence {
  return {
    ...parts,
    overall: weakestConfidence([parts.historicalData, parts.repositorySignal, parts.providerPricing]),
  };
}
