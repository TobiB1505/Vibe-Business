import { LENS_LABELS } from "@/modules/business-audit/map-view";
import {
  EXECUTION_READINESS_LABELS,
  type BusinessOpportunity,
  type ExecutionReadiness,
} from "./schema";
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

/* ---------------------------------------------------------------------------
 * The Action Plan workspace's derived reading (ACTION PLAN UI-2)
 *
 * Everything below is a *reading* of a Move that already exists. No new field,
 * no new read, no estimate. The rule the whole block obeys: if the domain did
 * not produce it, this file does not invent it — which is why there is no
 * duration here, and why `moveLensLabel` returns null rather than a placeholder
 * when a legacy Move carries no lens.
 * ------------------------------------------------------------------------ */

/**
 * When a Move sits in the plan — the engine's own order, read out loud.
 *
 * Rank is already unique and contiguous within a set (`schema.ts` §12), so this
 * is a rename of a number the founder can see anyway, never a second ordering.
 * Nothing here re-ranks: `moveBand` cannot move a Move, only label where it
 * already is.
 */
export type MoveBand = "now" | "next" | "later";

export const MOVE_BAND_LABELS: Record<MoveBand, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
};

export function moveBand(rank: number): MoveBand {
  if (rank <= 1) return "now";
  if (rank === 2) return "next";
  return "later";
}

/**
 * The one status a Move card leads with.
 *
 * Readiness is the headline, because it is what decides what a founder can do.
 * The exception is a low-impact Move: "Ready for Vibe" on the last card of the
 * list reads as an invitation to start with the least valuable thing on it, so
 * a low-impact Move says what it is instead. Readiness has not changed and is
 * still stated on the card's own action row — this is which of two true things
 * leads, not a substitution.
 *
 * `kind` rather than a colour: the design system's tones belong to the
 * component, exactly as `RESPONSIBILITY_TONE` does for plan steps.
 */
export type MoveHeadlineKind = "ready" | "needs_input" | "not_automated" | "low_priority";

export type MoveHeadline = { kind: MoveHeadlineKind; label: string };

const READINESS_HEADLINE_KIND: Record<ExecutionReadiness, MoveHeadlineKind> = {
  ready: "ready",
  needs_user_input: "needs_input",
  not_supported_yet: "not_automated",
};

export function moveHeadline(opportunity: BusinessOpportunity): MoveHeadline {
  if (opportunity.impact === "low") return { kind: "low_priority", label: "Low priority" };

  const kind = READINESS_HEADLINE_KIND[opportunity.executionReadiness];
  return { kind, label: EXECUTION_READINESS_LABELS[opportunity.executionReadiness] };
}

/**
 * Which part of the business this Move belongs to, in the audit's vocabulary.
 *
 * One secondary lens at most. A Move may carry several, and listing all of them
 * turns an orientation line into a taxonomy dump — the rest stay in the domain
 * and are simply not drawn, the same choice §14 made for the category chip.
 *
 * Null for a Move stored before `business-opportunity.v3`, which was attributed
 * to a retired dimension. Absent attribution is absent, never "Other".
 */
export function moveLensLabel(opportunity: BusinessOpportunity): string | null {
  if (opportunity.primaryLens === null) return null;

  const primary = LENS_LABELS[opportunity.primaryLens];
  const secondary = opportunity.secondaryLenses[0];
  return secondary ? `${primary} & ${LENS_LABELS[secondary]}` : primary;
}

/**
 * The three numbers above the plan.
 *
 * Counted from the set that is on screen, so the leading number and the list
 * below it can never disagree. `readyForVibe` counts the model's readiness
 * claim, which is a claim about a category of work — never a promise that a
 * button exists (§54, ADR 0014). The screen says "Vibe can start now"; whether
 * it can is still decided per Move by a real executor.
 */
export type MoveSummaryCounts = {
  total: number;
  readyForVibe: number;
  needsInput: number;
};

export function moveSummaryCounts(opportunities: BusinessOpportunity[]): MoveSummaryCounts {
  return {
    total: opportunities.length,
    readyForVibe: opportunities.filter((move) => move.executionReadiness === "ready").length,
    needsInput: opportunities.filter((move) => move.executionReadiness === "needs_user_input")
      .length,
  };
}
