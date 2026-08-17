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
  auditNeedsUser: boolean;
  auditRunning: boolean;
  auditAnalyzing: boolean;
  hasAudit: boolean;
  auditRevealed: boolean;
  completed: boolean;
};

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
  if (facts.auditNeedsUser) return "audit_needs_user";
  if (facts.auditRunning) return facts.auditAnalyzing ? "audit_running" : "audit_preparing";
  if (!facts.hasAudit) return "audit_preparing";
  if (!facts.auditRevealed) return "audit_reveal";
  return "first_move";
}

export function onboardingPhase(state: OnboardingState): OnboardingPhase {
  if (state === "connect_source" || state === "add_live_product") return "connect";
  if (state === "product_scanning" || state === "product_reveal") return "understand";
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
