import { describe, expect, it } from "vitest";
import {
  auditSurface,
  canCompleteOnboarding,
  type OnboardingAuditSurface,
} from "./audit-surface";
import type { LiveSiteStatus, OnboardingState } from "./state";

/**
 * The no-live-product contradiction, pinned (UI-S1 §9–§12, §29).
 *
 * These tests exist to fail loudly if the trap comes back. The trap was not a
 * missing button — it was a rule that made "I don't have a live site yet" and
 * "you may finish setting up" mutually exclusive. So the assertions are about
 * that rule, and they are written so that removing the parked path breaks them
 * rather than merely changing them.
 */

function facts(overrides: {
  auditOperationActive?: boolean;
  liveSiteStatus?: LiveSiteStatus;
  hasLiveProductIntelligence?: boolean;
}) {
  return {
    auditOperationActive: false,
    liveSiteStatus: "provided" as LiveSiteStatus,
    hasLiveProductIntelligence: false,
    ...overrides,
  };
}

describe("what the audit step should show", () => {
  it("parks the audit when the founder has said there is no live product", () => {
    expect(auditSurface(facts({ liveSiteStatus: "no_live_site_yet" }))).toBe(
      "parked_no_live_product",
    );
  });

  it("asks for the address when the founder said they have one", () => {
    expect(auditSurface(facts({ liveSiteStatus: "provided" }))).toBe("awaiting_live_product");
  });

  /**
   * A failed scan is not the same answer as "there is no live product".
   *
   * The founder said they have one and Vibe could not reach it. That is a thing
   * to fix, so the address is asked for again — parking it on their behalf
   * would be Vibe deciding their product is not live because it had a bad
   * minute.
   */
  it("does not park a live product Vibe merely failed to reach", () => {
    expect(auditSurface(facts({ liveSiteStatus: "scan_failed" }))).toBe("awaiting_live_product");
  });

  it("is ready once a live reading exists, whatever the founder first said", () => {
    for (const liveSiteStatus of ["provided", "no_live_site_yet", "scan_failed"] as const) {
      expect(
        auditSurface(facts({ liveSiteStatus, hasLiveProductIntelligence: true })),
        liveSiteStatus,
      ).toBe("ready_to_start");
    }
  });

  it("shows the running operation ahead of any prerequisite", () => {
    expect(
      auditSurface(
        facts({ auditOperationActive: true, liveSiteStatus: "no_live_site_yet" }),
      ),
    ).toBe("running");
  });
});

describe("whether onboarding may finish", () => {
  const parked: OnboardingAuditSurface = "parked_no_live_product";

  /** The regression this sprint exists to prevent: the founder trapped again. */
  it("lets a founder with no live product finish setup", () => {
    expect(
      canCompleteOnboarding({
        state: "audit_preparing",
        firstMoveViewed: false,
        surface: parked,
      }),
    ).toBe(true);
  });

  it("still refuses when the audit is merely waiting for an address", () => {
    expect(
      canCompleteOnboarding({
        state: "audit_preparing",
        firstMoveViewed: false,
        surface: "awaiting_live_product",
      }),
    ).toBe(false);
  });

  it("still refuses while the audit could actually be run", () => {
    expect(
      canCompleteOnboarding({
        state: "audit_preparing",
        firstMoveViewed: false,
        surface: "ready_to_start",
      }),
    ).toBe(false);
  });

  it("never finishes out from under a running audit", () => {
    expect(
      canCompleteOnboarding({ state: "audit_preparing", firstMoveViewed: false, surface: "running" }),
    ).toBe(false);
    expect(
      canCompleteOnboarding({ state: "audit_running", firstMoveViewed: false, surface: "running" }),
    ).toBe(false);
  });

  it("keeps the original path intact: the first Move, once seen", () => {
    expect(
      canCompleteOnboarding({ state: "first_move", firstMoveViewed: true, surface: null }),
    ).toBe(true);
    expect(
      canCompleteOnboarding({ state: "first_move", firstMoveViewed: false, surface: null }),
    ).toBe(false);
  });

  it("is idempotent for a founder who already finished", () => {
    expect(
      canCompleteOnboarding({ state: "complete", firstMoveViewed: false, surface: null }),
    ).toBe(true);
  });

  it("refuses from every earlier step, parked or not", () => {
    const earlier: OnboardingState[] = [
      "connect_source",
      "add_live_product",
      "product_scanning",
      "product_reveal",
      "audit_needs_user",
      "audit_reveal",
    ];
    for (const state of earlier) {
      expect(canCompleteOnboarding({ state, firstMoveViewed: true, surface: parked }), state).toBe(
        false,
      );
    }
  });
});
