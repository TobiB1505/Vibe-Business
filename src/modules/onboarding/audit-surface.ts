import type { LiveSiteStatus, OnboardingState } from "./state";

/**
 * What the audit step of onboarding should show, and whether onboarding may end
 * (UI-S1 §9–§12).
 *
 * ## The contradiction this exists to remove
 *
 * A founder could answer "I don't have a live site yet", have their product
 * understood from code alone — and then reach an audit step that demanded a
 * live URL, offered no way past it, and could not be completed. Their answer
 * stopped being true one screen after they gave it, and the only exits were
 * the back button and closing the tab.
 *
 * ## Why this is a surfacing decision and not a new state
 *
 * The canonical records already contain the answer. `live_site_status` records
 * what the founder said, and the live-product snapshot records what Vibe
 * actually managed to read. "Parked" is what those two facts mean together — it
 * is derived, never stored, so nothing here can drift out of step with the
 * records or contradict the reconciliation in `store.ts` (§11).
 *
 * Both the screen and the completion action read this same function, which is
 * what makes "the button is offered" and "the action allows it" one decision
 * rather than two that can disagree.
 */

export type OnboardingAuditSurface =
  /** A durable audit operation is live. Watch it; offer nothing. */
  | "running"
  /** Every prerequisite is met. The founder starts it. */
  | "ready_to_start"
  /** The founder has a live product; Vibe has not managed to read it yet. */
  | "awaiting_live_product"
  /**
   * The founder has said there is no live product yet.
   *
   * Not a failure and not a refusal: the audit compares what is built with what
   * customers can reach, and one half of that genuinely does not exist. It is
   * set aside, honestly, and becomes available when the product goes live.
   */
  | "parked_no_live_product";

export type AuditSurfaceFacts = {
  /** A queued or running business-audit operation exists. */
  auditOperationActive: boolean;
  /** What the founder said about having a live product. */
  liveSiteStatus: LiveSiteStatus;
  /** Whether Vibe holds a successful reading of the live product. */
  hasLiveProductIntelligence: boolean;
};

export function auditSurface(facts: AuditSurfaceFacts): OnboardingAuditSurface {
  if (facts.auditOperationActive) return "running";
  if (facts.hasLiveProductIntelligence) return "ready_to_start";
  // `scan_failed` is deliberately *not* parked: the founder said they have a
  // live product and Vibe could not reach it, which is a thing to fix rather
  // than a thing to set aside. They can still choose to park it explicitly.
  if (facts.liveSiteStatus === "no_live_site_yet") return "parked_no_live_product";
  return "awaiting_live_product";
}

/**
 * Whether onboarding may finish from where it is.
 *
 * Two terminal paths, and the second is the point of this sprint:
 *
 * - the founder saw their first Move, or
 * - the audit is parked because there is no live product to audit against.
 *
 * A parked audit is never recorded as having run. Completing here means "setup
 * is done and the workspace is yours", not "your audit is complete" — the
 * screen says so, and no audit row is created.
 */
export function canCompleteOnboarding(facts: {
  state: OnboardingState;
  firstMoveViewed: boolean;
  /** Null when the audit step is not the current step. */
  surface: OnboardingAuditSurface | null;
}): boolean {
  if (facts.state === "complete") return true;
  if (facts.state === "first_move") return facts.firstMoveViewed;
  if (facts.state === "audit_preparing") return facts.surface === "parked_no_live_product";
  return false;
}
