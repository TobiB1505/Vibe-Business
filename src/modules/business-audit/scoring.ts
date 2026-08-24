import { BUSINESS_LENSES, type BusinessLensAssessment, type OverallReadiness } from "./schema";

/**
 * Deterministic overall readiness — [ADR 0050](../../../docs/decisions/0050-lenses-are-the-audit.md).
 *
 * The model never produces a headline number. It assesses lenses; the
 * application computes the overall score. That split exists because a single
 * number is the most quoted and least verifiable part of an audit — keeping it
 * deterministic means it can be recomputed, explained, and trusted to follow
 * the same rule every time. Both principles of the retired dimension rule
 * (Sprint 4 §7) carry over unchanged: equal weighting, and unscored-is-never-
 * zero (rule 44). What changed is the population they run over.
 *
 * ## Materiality is not a lever on the score
 *
 * A `not_material` lens leaves the eligibility denominator — a one-off product
 * genuinely has nothing to retain, and demanding a retention score from it
 * would make the threshold unreachable. But a not_material lens that *was*
 * scored stays in the mean: if declaring a weak lens immaterial removed it
 * from the average, the priority judgment would become a way to launder a bad
 * number out of the headline — the same leak the health/materiality split
 * (CORE-2a.3.1 §29) closed, pointed the other way.
 *
 * An absent lens counts as eligible. Silence is not a claim of immateriality,
 * and neither is `materiality: "unknown"`.
 */

/**
 * The coverage threshold: a majority of the lenses that can apply, never
 * fewer than three.
 *
 * The floor is what stops the threshold collapsing with the denominator — a
 * model that declares seven lenses immaterial leaves two eligible, and a
 * headline number resting on two scores would imply a completeness the
 * evidence does not have.
 */
export function minimumScoredLenses(eligibleLenses: number): number {
  return Math.max(3, Math.ceil(eligibleLenses / 2));
}

export function computeOverallScore(lenses: BusinessLensAssessment[]): OverallReadiness {
  const eligibleLenses =
    BUSINESS_LENSES.length - lenses.filter((lens) => lens.materiality === "not_material").length;

  const scored = lenses.filter(
    (lens): lens is BusinessLensAssessment & { score: number } =>
      typeof lens.score === "number",
  );

  const threshold = minimumScoredLenses(eligibleLenses);

  if (scored.length < threshold) {
    return {
      score: null,
      scoredLenses: scored.length,
      eligibleLenses,
      insufficientCoverageReason: `Only ${scored.length} of ${eligibleLenses} applicable areas could be scored. At least ${threshold} are needed for an overall figure.`,
    };
  }

  const total = scored.reduce((sum, lens) => sum + lens.score, 0);

  return {
    score: Math.round(total / scored.length),
    scoredLenses: scored.length,
    eligibleLenses,
    insufficientCoverageReason: null,
  };
}
