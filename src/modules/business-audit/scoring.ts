import { AUDIT_DIMENSIONS, type DimensionAssessment, type OverallReadiness } from "./schema";

/**
 * Deterministic overall readiness (Sprint 4 §7).
 *
 * The model never produces a headline number. It assesses dimensions; the
 * application computes the overall score. That split exists because a
 * single number is the most quoted and least verifiable part of an audit —
 * keeping it deterministic means it can be recomputed, explained, and
 * trusted to follow the same rule every time.
 *
 * Three rules define it:
 *
 *  1. **Equal weighting** across dimensions that carry a score. Weighting
 *     by importance would encode a product opinion nobody has validated
 *     yet.
 *  2. **Unscored dimensions are excluded, never counted as zero.** Treating
 *     "we could not assess retention" as 0/100 would systematically punish
 *     early-stage products for the limits of our own evidence gathering —
 *     the exact failure mode Sprint 4 §6 exists to prevent.
 *  3. **Below a minimum coverage the overall score is null.** An average of
 *     one or two dimensions is not a business readiness score, and printing
 *     one would imply a completeness the evidence does not have.
 */

/**
 * At least three of five dimensions must be scored before a headline number
 * is meaningful. Two scored dimensions can swing the average by 20+ points
 * on evidence that says nothing about the majority of the business.
 */
export const MINIMUM_SCORED_DIMENSIONS = 3;

export function computeOverallReadiness(dimensions: DimensionAssessment[]): OverallReadiness {
  const scored = dimensions.filter(
    (dimension): dimension is DimensionAssessment & { score: number } => dimension.score !== null,
  );

  const totalDimensions = AUDIT_DIMENSIONS.length;

  if (scored.length < MINIMUM_SCORED_DIMENSIONS) {
    return {
      score: null,
      assessedDimensions: scored.length,
      totalDimensions,
      insufficientCoverageReason: `Only ${scored.length} of ${totalDimensions} dimensions could be scored. At least ${MINIMUM_SCORED_DIMENSIONS} are needed for an overall figure.`,
    };
  }

  const total = scored.reduce((sum, dimension) => sum + dimension.score, 0);

  return {
    score: Math.round(total / scored.length),
    assessedDimensions: scored.length,
    totalDimensions,
    insufficientCoverageReason: null,
  };
}
