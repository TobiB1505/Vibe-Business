import type {
  BusinessConclusion,
  BusinessLensAssessment,
  BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";

/**
 * Binding a Move to the audit judgment underneath it (CORE-2b §5, §7, §37).
 *
 * ## Why this has to be deterministic
 *
 * The plan claims to solve a specific business problem, and §37 requires that
 * chain to hold:
 *
 * ```
 * Root Business Problem → Next Move → Action Plan → Steps
 * ```
 *
 * The link between the Move and the audit conclusion it came from was never
 * persisted — the Opportunity Engine reads the audit and produces a ranked list
 * without recording which conclusion each entry answers. So it is recovered
 * here, from **structured fields only**: shared evidence ids and shared
 * dimensions. Never from titles or prose, for the same reason capability
 * matching never reads them (Rule 57's neighbour: model wording is not a
 * machine API).
 *
 * ## Why a miss is not an error
 *
 * `conclusion` may be null — an audit written before the synthesis contract
 * carries none, and a Move can genuinely sit across several. A plan without a
 * resolved conclusion still records its audit and its Move, and still plans the
 * Move. What it loses is the internal root problem, and the planner is told
 * plainly that it does not have one rather than being handed a guess.
 */

export type PlannerSource = {
  opportunity: BusinessOpportunity;
  /** The conclusion this Move most closely answers, when one resolves. */
  conclusion: BusinessConclusion | null;
  /** The lens assessments behind that conclusion, in the audit's own order. */
  lenses: BusinessLensAssessment[];
  /**
   * Every evidence id the source judgment rested on.
   *
   * The union of the Move's citations, the conclusion's, and those of the
   * lenses behind it — which is exactly what the planner's evidence selection
   * keeps beyond the product profile (`evidence.ts`).
   */
  citedEvidenceIds: string[];
};

/**
 * How closely a conclusion matches a Move.
 *
 * Evidence overlap is weighted above dimension overlap, and by a margin that
 * cannot be closed by dimensions alone. Two conclusions routinely touch the
 * same dimension — that is what a dimension is for — while citing the same
 * observed fact is a much stronger statement that they are about the same
 * thing.
 */
function affinity(conclusion: BusinessConclusion, opportunity: BusinessOpportunity): number {
  const cited = new Set(opportunity.evidenceIds);
  const evidenceOverlap = conclusion.evidenceIds.filter((id) => cited.has(id)).length;

  const dimensions = new Set([opportunity.primaryDimension, ...opportunity.secondaryDimensions]);
  const dimensionOverlap = conclusion.dimensions.filter((id) => dimensions.has(id)).length;

  return evidenceOverlap * 10 + dimensionOverlap;
}

export function resolvePlannerSource(
  audit: BusinessReadinessAudit,
  opportunity: BusinessOpportunity,
): PlannerSource {
  const synthesis = audit.synthesis;

  /*
   * Blockers before strengths, and in the audit's own order.
   *
   * A Move exists to address something holding the business back, so a blocker
   * is what it almost always answers. Strengths are still searched, because a
   * Move can be "press the advantage you already have" — but only after every
   * blocker has been considered, and ties resolve to the audit's ordering,
   * which is its own priority statement (CORE-2a.3.2).
   */
  const candidates = synthesis ? [...synthesis.blockers, ...synthesis.strengths] : [];

  let conclusion: BusinessConclusion | null = null;
  let best = 0;
  for (const candidate of candidates) {
    const score = affinity(candidate, opportunity);
    if (score > best) {
      best = score;
      conclusion = candidate;
    }
  }

  // No overlap at all means the recovery failed, not that the first blocker is
  // the answer. Guessing here would put a root problem on a plan that does not
  // address it, which is precisely the fidelity claim §37 makes.
  if (best === 0) conclusion = null;

  const lensIds = new Set(conclusion?.lenses ?? []);
  const lenses = (synthesis?.lenses ?? []).filter((lens) => lensIds.has(lens.lens));

  const citedEvidenceIds = [
    ...new Set([
      ...opportunity.evidenceIds,
      ...(conclusion?.evidenceIds ?? []),
      ...lenses.flatMap((lens) => lens.evidenceIds),
    ]),
  ];

  return { opportunity, conclusion, lenses, citedEvidenceIds };
}

/**
 * The Move a plan is built for, when the caller has not chosen one (§6, §83).
 *
 * Rank 1. Not "the one Vibe could most easily execute" — that trade is exactly
 * what §83 forbids, and making it here would mean the product quietly plans the
 * easy work while telling the founder it planned the important work.
 */
export function defaultPlannedOpportunity(
  opportunities: readonly BusinessOpportunity[],
): BusinessOpportunity | null {
  return [...opportunities].sort((a, b) => a.rank - b.rank)[0] ?? null;
}
