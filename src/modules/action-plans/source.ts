import {
  findConclusionByKey,
  identifiedConclusions,
  type IdentifiedConclusion,
} from "@/modules/business-audit/conclusions";
import type {
  BusinessConclusion,
  BusinessLensAssessment,
  BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";

/**
 * Resolving the audit judgment a Move came from (CORE-2b §5, §37; FIX §1–§9).
 *
 * ## The canonical chain
 *
 * ```
 * Business Audit → Business Conclusion → Next Move → Action Plan → Plan Steps
 * ```
 *
 * Every link in it is now **stated** rather than inferred, for Moves created since
 * `business-opportunity.v2`: the Opportunity Engine records the conclusion key it
 * reasoned from, and this module reads it. Nothing reconstructs a relationship the
 * system already knows.
 *
 * ## Why reconstruction still exists, and why it is conservative
 *
 * Moves written before v2 carry no key. For those, and only those, the evidence-overlap
 * reconciliation below runs — as a **compatibility path**, not as the contract.
 *
 * It is deliberately willing to fail. The earlier version returned the highest-scoring
 * candidate whenever any overlap existed, which is a best guess dressed as a fact: a Move
 * that plausibly answers two conclusions would silently get one of them, and every
 * downstream claim about "the business problem this plan solves" would inherit a coin
 * flip. So a tie, or a match resting on nothing but a shared dimension, now resolves to
 * **unresolved** (§5, §21).
 *
 * ## Why resolution is a discriminated result rather than a nullable field
 *
 * `PlannerSource.conclusion` is non-nullable, and that is the enforcement mechanism for
 * §7–§9: a planner source cannot be *constructed* without a conclusion, so
 * `runActionPlanning` cannot be called without one, so no provider call can happen
 * without one. The guarantee is a type, not an ordering convention someone has to
 * remember — which is the same move the capability boundary makes.
 */

/** How the source conclusion was established. Recorded on the plan (§24). */
export const CONCLUSION_LINEAGES = [
  /** Stated by the Opportunity Engine at Move creation. The contract (§1). */
  "direct",
  /** Recovered by bounded reconstruction for a pre-v2 Move. Compatibility only (§4). */
  "legacy_reconciled",
] as const;
export type ConclusionLineage = (typeof CONCLUSION_LINEAGES)[number];

export type PlannerSource = {
  opportunity: BusinessOpportunity;
  /**
   * The conclusion this plan exists to move. **Never null** — see the file header.
   */
  conclusion: BusinessConclusion;
  /** Its key within the audit. Stored on the plan so the chain stays queryable (§24). */
  conclusionKey: string;
  lineage: ConclusionLineage;
  /** The lens assessments behind that conclusion, in the audit's own order. */
  lenses: BusinessLensAssessment[];
  /**
   * Every evidence id the source judgment rested on.
   *
   * The union of the Move's citations, the conclusion's, and those of the lenses behind
   * it — which is exactly what the planner's evidence selection keeps beyond the product
   * profile (`evidence.ts`).
   */
  citedEvidenceIds: string[];
};

/**
 * Why a Move's source conclusion could not be established.
 *
 * A closed set, because each maps to a different thing being true about the project and
 * a different thing to say about it. "We could not tell which of two problems this
 * addresses" and "this audit has no conclusions at all" are not the same situation.
 */
export const SOURCE_UNRESOLVED_REASONS = [
  /** The audit predates the synthesis contract; it has no conclusions to point at. */
  "audit_has_no_conclusions",
  /** The Move names a conclusion key this audit does not contain. */
  "conclusion_not_in_audit",
  /** A legacy Move whose evidence matches nothing in the audit. */
  "no_legacy_match",
  /** A legacy Move that plausibly answers more than one conclusion (§5, §21). */
  "ambiguous_legacy_match",
] as const;
export type SourceUnresolvedReason = (typeof SOURCE_UNRESOLVED_REASONS)[number];

export type PlannerSourceResolution =
  | { resolved: true; source: PlannerSource }
  | { resolved: false; reason: SourceUnresolvedReason };

/**
 * How closely a conclusion matches a Move, for legacy reconstruction only.
 *
 * Evidence overlap is weighted above dimension overlap, and by a margin dimensions
 * cannot close. Two conclusions routinely touch the same dimension — that is what a
 * dimension is for — while citing the same observed fact is a much stronger statement
 * that they are about the same thing.
 */
function affinity(conclusion: BusinessConclusion, opportunity: BusinessOpportunity): number {
  const cited = new Set(opportunity.evidenceIds);
  const evidenceOverlap = conclusion.evidenceIds.filter((id) => cited.has(id)).length;

  const dimensions = new Set([opportunity.primaryDimension, ...opportunity.secondaryDimensions]);
  const dimensionOverlap = conclusion.dimensions.filter((id) => dimensions.has(id)).length;

  return evidenceOverlap * 10 + dimensionOverlap;
}

/** True when a score could only have come from shared evidence, not shared dimensions. */
function restsOnSharedEvidence(score: number): boolean {
  return score >= 10;
}

/**
 * Bounded legacy reconciliation (§4, §5).
 *
 * Resolves only when the answer is unambiguous on the existing deterministic rules:
 *
 *  1. the best candidate must rest on **shared evidence**, not merely a shared
 *     dimension — a dimension in common is what two unrelated conclusions have;
 *  2. no other candidate may tie it.
 *
 * Anything else is unresolved. "Highest score wins" is explicitly not the rule (§5): a
 * ranking is only a decision when the gap means something.
 */
function reconcileLegacy(
  candidates: IdentifiedConclusion[],
  opportunity: BusinessOpportunity,
): { resolved: true; match: IdentifiedConclusion } | { resolved: false; reason: SourceUnresolvedReason } {
  const scored = candidates
    .map((entry) => ({ entry, score: affinity(entry.conclusion, opportunity) }))
    .filter((entry) => restsOnSharedEvidence(entry.score))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { resolved: false, reason: "no_legacy_match" };
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { resolved: false, reason: "ambiguous_legacy_match" };
  }

  return { resolved: true, match: scored[0].entry };
}

export function resolvePlannerSource(
  audit: BusinessReadinessAudit,
  opportunity: BusinessOpportunity,
): PlannerSourceResolution {
  const candidates = identifiedConclusions(audit);
  if (candidates.length === 0) {
    return { resolved: false, reason: "audit_has_no_conclusions" };
  }

  let match: IdentifiedConclusion | null = null;
  let lineage: ConclusionLineage = "direct";

  if (opportunity.sourceConclusionKey !== null) {
    // The contract path. No reconstruction runs for a properly linked Move (§4).
    match = findConclusionByKey(audit, opportunity.sourceConclusionKey);
    if (!match) {
      // The Move names a conclusion this audit does not have — it was prioritized from a
      // different audit than the one now current. Reconstructing a substitute would be
      // guessing on top of a known mismatch, so it refuses instead.
      return { resolved: false, reason: "conclusion_not_in_audit" };
    }
  } else {
    const reconciled = reconcileLegacy(candidates, opportunity);
    if (!reconciled.resolved) return reconciled;
    match = reconciled.match;
    lineage = "legacy_reconciled";
  }

  const lensIds = new Set(match.conclusion.lenses);
  const lenses = (audit.synthesis?.lenses ?? []).filter((lens) => lensIds.has(lens.lens));

  return {
    resolved: true,
    source: {
      opportunity,
      conclusion: match.conclusion,
      conclusionKey: match.key,
      lineage,
      lenses,
      citedEvidenceIds: [
        ...new Set([
          ...opportunity.evidenceIds,
          ...match.conclusion.evidenceIds,
          ...lenses.flatMap((lens) => lens.evidenceIds),
        ]),
      ],
    },
  };
}

/**
 * The Move a plan is built for, when the caller has not chosen one (§6, §83).
 *
 * Rank 1. Not "the one Vibe could most easily execute" — that trade is exactly what §83
 * forbids, and making it here would mean the product quietly plans the easy work while
 * telling the founder it planned the important work.
 */
export function defaultPlannedOpportunity(
  opportunities: readonly BusinessOpportunity[],
): BusinessOpportunity | null {
  return [...opportunities].sort((a, b) => a.rank - b.rank)[0] ?? null;
}
