/**
 * Project onboarding is orchestration, not another copy of the product.
 *
 * The persisted state makes routing resumable. Reconciliation derives the
 * state again from canonical Product Profile, Audit and Opportunity records,
 * so an operation that completes while the founder is away cannot leave the
 * journey stranded on an obsolete screen.
 */

export const ONBOARDING_STATES = [
  "connect_source",
  "add_live_product",
  "product_scanning",
  "product_reveal",
  "add_signed_in_product",
  "audit_preparing",
  "audit_needs_user",
  "audit_running",
  "audit_reveal",
  "first_move",
  "complete",
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const LIVE_SITE_STATUSES = [
  "undecided",
  "provided",
  "no_live_site_yet",
  "scan_failed",
] as const;

export type LiveSiteStatus = (typeof LIVE_SITE_STATUSES)[number];
export type OnboardingPhase = "connect" | "understand" | "audit" | "first_move";

export type OnboardingFacts = {
  hasProductSource: boolean;
  liveSiteStatus: LiveSiteStatus;
  hasRepositorySnapshot: boolean;
  understandingRunning: boolean;
  hasProductProfile: boolean;
  productConfirmed: boolean;
  /**
   * A Deep Scan has already read this product from the inside.
   *
   * Existence of a completed snapshot, never a flag somebody sets — the same
   * authority `deep-scan/entitlement.ts` uses to decide whether the included
   * scan is spent.
   */
  hasSignedInProduct: boolean;
  /**
   * There is something to sign in to: a live address was given, so the origin
   * a Deep Scan would open exists. Without one the domain refuses the scan
   * outright (`production_origin_missing`), and a step that can only be
   * declined is not a step.
   */
  signedInProductOfferable: boolean;
  /** The founder was offered the signed-in read and said not now. */
  signedInProductDeclined: boolean;
  auditNeedsUser: boolean;
  auditRunning: boolean;
  auditAnalyzing: boolean;
  hasAudit: boolean;
  auditRevealed: boolean;
  completed: boolean;
};

/**
 * Whether the signed-in read is still an open question for this project.
 *
 * Exported because two screens need the answer and only one of them is the
 * step itself. The product reveal has to know it as well: its control bundles
 * the audit with the confirmation whenever the audit is free, and bundling is
 * wrong the moment something stands between the two. A second copy of this
 * predicate on the page would be free to disagree with the cascade below it,
 * one render later.
 *
 * It says nothing about *where* setup is — the cascade decides that, and a
 * project whose audit is already running is past this whatever this returns.
 */
export function signedInProductPending(
  facts: Pick<
    OnboardingFacts,
    "hasSignedInProduct" | "signedInProductOfferable" | "signedInProductDeclined"
  >,
): boolean {
  return (
    facts.signedInProductOfferable && !facts.hasSignedInProduct && !facts.signedInProductDeclined
  );
}

export function deriveOnboardingState(facts: OnboardingFacts): OnboardingState {
  if (facts.completed) return "complete";
  if (!facts.hasProductSource) return "connect_source";
  if (facts.liveSiteStatus === "undecided" || facts.liveSiteStatus === "scan_failed") {
    return "add_live_product";
  }
  if (!facts.hasRepositorySnapshot || facts.understandingRunning || !facts.hasProductProfile) {
    return "product_scanning";
  }
  if (!facts.productConfirmed) return "product_reveal";
  if (signedInProductPending(facts)) return "add_signed_in_product";
  if (facts.auditNeedsUser) return "audit_needs_user";
  if (facts.auditRunning) return facts.auditAnalyzing ? "audit_running" : "audit_preparing";
  if (!facts.hasAudit) return "audit_preparing";
  if (!facts.auditRevealed) return "audit_reveal";
  return "first_move";
}

export function onboardingPhase(state: OnboardingState): OnboardingPhase {
  if (state === "connect_source" || state === "add_live_product") return "connect";
  if (
    state === "product_scanning" ||
    state === "product_reveal" ||
    state === "add_signed_in_product"
  ) {
    return "understand";
  }
  if (
    state === "audit_preparing" ||
    state === "audit_needs_user" ||
    state === "audit_running" ||
    state === "audit_reveal"
  ) {
    return "audit";
  }
  return "first_move";
}

export const ONBOARDING_PHASES: { id: OnboardingPhase; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "understand", label: "Understand" },
  { id: "audit", label: "Audit" },
  { id: "first_move", label: "First move" },
];

export function phasePosition(phase: OnboardingPhase): number {
  return ONBOARDING_PHASES.findIndex((entry) => entry.id === phase);
}

/** Carried out, being worked on, or still ahead. The Action Plan's vocabulary. */
export type OnboardingStepState = "done" | "here" | "waiting";

export type OnboardingStep = {
  id: OnboardingPhase;
  label: string;
  state: OnboardingStepState;
};

/**
 * Setup as a short ordered list, for the rail.
 *
 * ## Why this exists again
 *
 * A four-phase progress rail used to sit in `OnboardingShell` and was removed
 * on the argument that it is "a to-do list about the *product's* process rather
 * than anything a founder decides". Half of that is right and it is the wrong
 * half to act on: it is indeed not a decision, and a founder in the middle of
 * setup still wants to know how much of it there is. Nova's sentence says
 * *where we are*; it cannot say *what is left* without repeating the whole plan
 * every load, which is exactly the thing the rail exists to hold.
 *
 * So it comes back where the other ordered list already lives — beside the
 * Action Plan's, in the same column, with the same three marks — rather than as
 * a second piece of chrome above the thread.
 *
 * ## Why "everything before here is done" is a fact and not an assumption
 *
 * Because `deriveOnboardingState` is a cascade over facts in priority order. A
 * project sitting at `audit_reveal` has a source, a decided live-site answer, a
 * snapshot and a confirmed profile — the earlier phases did not merely appear
 * to pass, they are the conditions of being here at all. That is what lets a
 * filled square mean carried out rather than skipped past.
 *
 * `complete` is the one state that is not its own phase: `onboardingPhase` maps
 * it to `first_move`, which would leave the last row ringed forever on a
 * project whose setup is behind it.
 *
 * ## What it deliberately never carries
 *
 * A fraction. No "two of four", no bar. `planMetaSummary` refuses one for the
 * same reason and this is the same shape of list — four steps of entirely
 * different sizes, where "half done" would be a number nobody measured.
 */
export function onboardingSteps(state: OnboardingState): OnboardingStep[] {
  const here = phasePosition(onboardingPhase(state));

  return ONBOARDING_PHASES.map((phase, index) => ({
    id: phase.id,
    label: phase.label,
    state:
      state === "complete" || index < here
        ? "done"
        : index === here
          ? "here"
          : ("waiting" as const),
  }));
}
