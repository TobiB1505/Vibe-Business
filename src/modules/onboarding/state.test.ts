import { describe, expect, it } from "vitest";
import { deriveOnboardingState, onboardingPhase, type OnboardingFacts } from "./state";

const ready: OnboardingFacts = {
  hasProductSource: true,
  liveSiteStatus: "provided",
  hasRepositorySnapshot: true,
  understandingRunning: false,
  hasProductProfile: true,
  productConfirmed: true,
  auditNeedsUser: false,
  auditRunning: false,
  auditAnalyzing: false,
  hasAudit: true,
  auditRevealed: true,
  completed: false,
};

describe("project onboarding reconciliation", () => {
  it.each([
    [{ ...ready, hasProductSource: false }, "connect_source"],
    [{ ...ready, liveSiteStatus: "undecided" }, "add_live_product"],
    [{ ...ready, liveSiteStatus: "scan_failed" }, "add_live_product"],
    [{ ...ready, hasRepositorySnapshot: false }, "product_scanning"],
    [{ ...ready, understandingRunning: true }, "product_scanning"],
    [{ ...ready, hasProductProfile: false }, "product_scanning"],
    [{ ...ready, productConfirmed: false }, "product_reveal"],
    [{ ...ready, auditNeedsUser: true, hasAudit: false }, "audit_needs_user"],
    [
      { ...ready, auditRunning: true, auditAnalyzing: false, hasAudit: false },
      "audit_preparing",
    ],
    [
      { ...ready, auditRunning: true, auditAnalyzing: true, hasAudit: false },
      "audit_running",
    ],
    [{ ...ready, hasAudit: false }, "audit_preparing"],
    [{ ...ready, auditRevealed: false }, "audit_reveal"],
    [ready, "first_move"],
    [{ ...ready, completed: true }, "complete"],
  ] as const)("resolves canonical facts to %s", (facts, expected) => {
    expect(deriveOnboardingState(facts)).toBe(expected);
  });

  it("uses canonical facts instead of trusting a stale persisted screen", () => {
    expect(deriveOnboardingState({ ...ready, hasAudit: false, auditRevealed: false })).toBe(
      "audit_preparing",
    );
    expect(deriveOnboardingState({ ...ready, auditNeedsUser: true, hasAudit: false })).toBe(
      "audit_needs_user",
    );
    expect(deriveOnboardingState(ready)).toBe("first_move");
  });

  it("treats the explicit no-live-site choice as enough to continue understanding", () => {
    expect(
      deriveOnboardingState({
        ...ready,
        liveSiteStatus: "no_live_site_yet",
        hasRepositorySnapshot: false,
        hasProductProfile: false,
        productConfirmed: false,
        hasAudit: false,
        auditRevealed: false,
      }),
    ).toBe("product_scanning");
  });

  it("does not replay completed onboarding", () => {
    expect(deriveOnboardingState({ ...ready, completed: true })).toBe("complete");
    expect(onboardingPhase("complete")).toBe("first_move");
  });

  it.each([
    ["connect_source", "connect"],
    ["add_live_product", "connect"],
    ["product_scanning", "understand"],
    ["product_reveal", "understand"],
    ["audit_preparing", "audit"],
    ["audit_needs_user", "audit"],
    ["audit_running", "audit"],
    ["audit_reveal", "audit"],
    ["first_move", "first_move"],
    ["complete", "first_move"],
  ] as const)("maps %s to the public %s phase", (state, phase) => {
    expect(onboardingPhase(state)).toBe(phase);
  });
});
