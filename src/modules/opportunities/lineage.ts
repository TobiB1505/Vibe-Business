import { findConclusionByKey } from "@/modules/business-audit/conclusions";
import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import type { BusinessOpportunity } from "./schema";

/**
 * Which audit finding each Move exists to answer (UI-S2 §4, §6).
 *
 * ## What this is not
 *
 * It is not a new relationship. `sourceConclusionKey` has been the
 * authoritative link since `business-opportunity.v2` — the engine reads the
 * audit's conclusions, decides what to do about them, and records which one it
 * answered. This module only makes that relationship *legible*, and it does so
 * without adding a second way to compute it.
 *
 * ## Stable identity, never prose
 *
 * Resolution is `(source audit, conclusion key)` and nothing else. Titles,
 * headlines, dimension labels, rank and array position are all deliberately
 * unused: a headline is model prose written for a customer, two audits can
 * produce the same one, and a display string that becomes load-bearing is a
 * display string nobody can safely edit again (see `conclusions.ts`).
 *
 * ## The audit it resolves against
 *
 * The **set's own** audit, never the newest one (§7). A Move prioritized from
 * audit A keeps answering a conclusion of audit A after audit B exists. Passing
 * the current audit here for a stale set would silently rebind every Move to
 * whatever conclusion happens to sit at the same key — which is not a display
 * bug, it is the product asserting a causal link that was never made.
 *
 * When a key names nothing in the audit it was resolved against, the Move
 * simply has no lineage. It still renders; it just does not claim a source.
 * Fabricating one would be the same failure as fabricating an evidence id.
 */

export type MoveLineage = {
  /** Stable, internal. Used for routing and matching — never displayed (§5). */
  conclusionKey: string;
  /** The audit's own words for the finding. This is what a founder reads. */
  headline: string;
};

/** Lineage by opportunity id. A Move with no resolvable source is absent. */
export type MoveLineageMap = Record<string, MoveLineage>;

export function resolveMoveLineage(params: {
  /**
   * The audit the opportunity set was generated from — `set.businessAuditId`.
   * Null when it cannot be read, which yields no lineage rather than a guess.
   */
  sourceAudit: BusinessReadinessAudit | null;
  opportunities: BusinessOpportunity[];
}): MoveLineageMap {
  const { sourceAudit, opportunities } = params;
  if (!sourceAudit) return {};

  const lineage: MoveLineageMap = {};
  for (const opportunity of opportunities) {
    // Legacy sets carry null. Null means "unknown", never "none" — so it
    // produces no label rather than an empty one.
    if (opportunity.sourceConclusionKey === null) continue;

    const match = findConclusionByKey(sourceAudit, opportunity.sourceConclusionKey);
    if (!match) continue;

    lineage[opportunity.id] = {
      conclusionKey: match.key,
      headline: match.conclusion.headline,
    };
  }
  return lineage;
}

/** How many Moves address each conclusion. Drives whether the audit offers a link. */
export function movesPerConclusion(lineage: MoveLineageMap): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.values(lineage)) {
    counts[entry.conclusionKey] = (counts[entry.conclusionKey] ?? 0) + 1;
  }
  return counts;
}

/**
 * The Moves page entered from one audit finding (UI-S2 §9, §10, §31).
 *
 * `requested` is whatever arrived in the URL, and it is treated as untrusted
 * text. It becomes a context only by matching a key that the *loaded* set's own
 * Moves cite — which is why no separate authorization check is needed and why a
 * key from another project cannot resolve anything: the set was read under the
 * caller's RLS for one project, so the only keys that can match are that
 * project's own. Anything else degrades to the normal page.
 */
export type MovesContext = {
  conclusionKey: string;
  headline: string;
  /** Ids of the Moves addressing it, in the engine's persisted rank order. */
  moveIds: string[];
};

export function resolveMovesContext(params: {
  requested: string | null | undefined;
  lineage: MoveLineageMap;
  opportunities: BusinessOpportunity[];
}): MovesContext | null {
  const { requested, lineage, opportunities } = params;
  if (typeof requested !== "string" || requested.length === 0) return null;
  // Bounded before it is used for anything. A key is `blocker-3`-shaped; a
  // megabyte of text is not a typo, and it should not reach a comparison loop.
  if (requested.length > 64) return null;

  const addressing = byRank(opportunities).filter(
    (opportunity) => lineage[opportunity.id]?.conclusionKey === requested,
  );
  // A key nothing addresses is not a context. Rendering "0 ways Vibe can help"
  // under a finding would be a worse answer than the plain ranked list.
  if (addressing.length === 0) return null;

  return {
    conclusionKey: requested,
    headline: lineage[addressing[0].id].headline,
    moveIds: addressing.map((opportunity) => opportunity.id),
  };
}

/**
 * The list split for a contextual entry (§10, §44).
 *
 * **Elevation, not reranking.** Both groups come out in the engine's persisted
 * rank order and every Move keeps the rank it was given. Nothing here computes
 * a "context rank", and the number on a card is the same number it has on the
 * default page — otherwise the product would have two orderings and a founder
 * would have to work out which one to believe.
 */
export function partitionByContext(
  opportunities: BusinessOpportunity[],
  context: MovesContext | null,
): { addressing: BusinessOpportunity[]; others: BusinessOpportunity[] } {
  const ordered = byRank(opportunities);
  if (!context) return { addressing: [], others: ordered };

  const inContext = new Set(context.moveIds);
  return {
    addressing: ordered.filter((opportunity) => inContext.has(opportunity.id)),
    others: ordered.filter((opportunity) => !inContext.has(opportunity.id)),
  };
}

/** A copy, sorted by the engine's rank. Never mutates the caller's array. */
function byRank(opportunities: BusinessOpportunity[]): BusinessOpportunity[] {
  return [...opportunities].sort((a, b) => a.rank - b.rank);
}

/** The query parameter the audit hands to the Moves page. Internal, stable. */
export const MOVES_CONTEXT_PARAM = "from";

export function movesContextHref(movesHref: string, conclusionKey: string): string {
  return `${movesHref}?${MOVES_CONTEXT_PARAM}=${encodeURIComponent(conclusionKey)}`;
}
