import type { OpportunityBlockReason } from "./service";

/**
 * What the Opportunities section offers when it cannot generate (Sprint 8 §34).
 *
 * ## Why generation stays blocked on a stale audit
 *
 * The open question was whether to block or to warn-and-allow, since blocking
 * forces two paid calls when evidence has moved. Blocking wins, and not for the
 * reason originally given.
 *
 * The engine sends the model an audit **and the evidence pack it rebuilds from
 * today's snapshots**. When the audit is current those agree. When it is stale
 * they do not: the model is asked to prioritize a diagnosis against evidence
 * that diagnosis never saw, and can cite ids the audit's own reasoning predates.
 * That is a correctness problem, not a preference about tone — no amount of UI
 * labelling makes the two inputs consistent again.
 *
 * ## But a block must never be a dead end
 *
 * This is the failure that hit Deep Scan twice: a heading, a sentence, a
 * disabled button, and nothing the user could do. So every blocked reason here
 * carries an action, and a test asserts that — the type cannot express a
 * blocked state without a way out of it.
 */

export type OpportunityBlockNotice = {
  reason: OpportunityBlockReason;
  /** What the user should do, in their words. */
  actionLabel: string;
  /** Where that action lives on the page. */
  anchor: string;
};

/** The anchor the audit section carries, so a block can point at it. */
export const BUSINESS_AUDIT_ANCHOR = "#business-audit";

export function buildOpportunityBlockNotice(
  reason: OpportunityBlockReason | null,
): OpportunityBlockNotice | null {
  if (reason === null) return null;

  const actionLabel =
    reason === "audit_missing" ? "Run a business audit" : "Update your business audit";

  return { reason, actionLabel, anchor: BUSINESS_AUDIT_ANCHOR };
}
