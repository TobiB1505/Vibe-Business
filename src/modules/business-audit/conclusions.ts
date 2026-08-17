import type { BusinessConclusion, BusinessReadinessAudit } from "./schema";

/**
 * Stable identity for a business conclusion (CORE-2b FIX §1, §3).
 *
 * ## Why conclusions have keys rather than rows
 *
 * A conclusion is not a database row. It lives inside `business_readiness_audits.result`,
 * which is a JSONB document written once and never updated — audits are immutable, and
 * re-running the audit produces a new row rather than editing an old one.
 *
 * So the canonical address of a conclusion is a **pair**:
 *
 * ```
 * (business_audit_id, conclusion_key)
 * ```
 *
 * The audit id is a real foreign key and already travels on every opportunity set and
 * every action plan. The key below addresses a conclusion *within* that audit, and it is
 * stable for exactly as long as the document is — which is forever.
 *
 * Normalizing conclusions into their own table would give a single-column FK and would
 * also mean rewriting how the audit persists its judgment, for a relationship that is
 * already unambiguous. That is a bigger change than this one buys, so it is not made
 * here; if conclusions ever become independently addressable, this function is the one
 * place that has to learn about it.
 *
 * ## Why position rather than content
 *
 * A content hash would be stable too, and would be worse: it would change if a stored
 * conclusion's prose were ever migrated, and it would be unreadable in a log. Position
 * within an immutable document is stable by construction, and `blocker-1` is
 * self-explanatory in an audit event, in a prompt, and in a database row.
 *
 * ## Why not the headline
 *
 * Explicitly ruled out (§1). A headline is model prose written for a customer to read;
 * two audits can produce the same one, one audit can change its wording between contract
 * versions, and using it as identity would make a display decision load-bearing.
 */

/** The conclusion this key addresses lives in one of two lists on the synthesis. */
export type ConclusionKind = "blocker" | "strength";

export type IdentifiedConclusion = {
  /** Stable within one stored audit. Never a headline (§1). */
  key: string;
  kind: ConclusionKind;
  conclusion: BusinessConclusion;
};

function key(kind: ConclusionKind, index: number): string {
  return `${kind}-${index + 1}`;
}

/**
 * Every conclusion in an audit, with its key.
 *
 * Blockers first, then strengths, in the audit's own order — which is its own priority
 * statement (CORE-2a.3.2) and the order the Opportunity Engine already reads them in.
 *
 * An audit with no synthesis returns an empty list. That is a real state: audits written
 * before the synthesis contract carry no conclusions at all, and the planner's readiness
 * check is what turns that into an honest refusal rather than a guess.
 */
export function identifiedConclusions(audit: BusinessReadinessAudit): IdentifiedConclusion[] {
  const synthesis = audit.synthesis;
  if (!synthesis) return [];

  return [
    ...synthesis.blockers.map((conclusion, index) => ({
      key: key("blocker", index),
      kind: "blocker" as const,
      conclusion,
    })),
    ...synthesis.strengths.map((conclusion, index) => ({
      key: key("strength", index),
      kind: "strength" as const,
      conclusion,
    })),
  ];
}

/** The conclusion a key addresses, or null when the key names nothing in this audit. */
export function findConclusionByKey(
  audit: BusinessReadinessAudit,
  conclusionKey: string,
): IdentifiedConclusion | null {
  return identifiedConclusions(audit).find((entry) => entry.key === conclusionKey) ?? null;
}

/** The keys this audit offers, for validating a cited one against reality. */
export function conclusionKeySet(audit: BusinessReadinessAudit): Set<string> {
  return new Set(identifiedConclusions(audit).map((entry) => entry.key));
}
