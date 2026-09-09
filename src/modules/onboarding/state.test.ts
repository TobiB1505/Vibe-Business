import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STATES,
  deriveOnboardingState,
  onboardingPhase,
  onboardingSteps,
  type OnboardingFacts,
} from "./state";

const ready: OnboardingFacts = {
  hasProductSource: true,
  liveSiteStatus: "provided",
  hasRepositorySnapshot: true,
  understandingRunning: false,
  hasProductProfile: true,
  productConfirmed: true,
  hasSignedInProduct: true,
  signedInProductOfferable: true,
  signedInProductDeclined: false,
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
    [
      { ...ready, hasSignedInProduct: false, hasAudit: false, auditRevealed: false },
      "add_signed_in_product",
    ],
    [{ ...ready, auditNeedsUser: true, hasAudit: false }, "audit_needs_user"],
    [{ ...ready, auditRunning: true, auditAnalyzing: false, hasAudit: false }, "audit_preparing"],
    [{ ...ready, auditRunning: true, auditAnalyzing: true, hasAudit: false }, "audit_running"],
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

  /**
   * The signed-in step, and the three ways past it.
   *
   * It sits after the confirmation and before the audit because that is where
   * it is both true and useful: the code and the public pages have been read,
   * so Vibe can say what it has *not* seen, and the audit — which records the
   * absence of a signed-in read as a gap in its own evidence — has not run yet.
   *
   * There is no fourth way past it. A founder who declines is past it, a
   * founder who scans is past it, and a project with nothing to sign in to
   * never reaches it. What must never happen is the state persisting after a
   * scan succeeds, because the only thing on that screen would be an offer to
   * do the thing that was just done.
   */
  describe("the signed-in read", () => {
    const asked: OnboardingFacts = {
      ...ready,
      hasSignedInProduct: false,
      signedInProductDeclined: false,
      hasAudit: false,
      auditRevealed: false,
    };

    it("is offered once the product is confirmed and before the audit", () => {
      expect(deriveOnboardingState(asked)).toBe("add_signed_in_product");
    });

    it("is behind us the moment a scan has read the product from the inside", () => {
      expect(deriveOnboardingState({ ...asked, hasSignedInProduct: true })).toBe("audit_preparing");
    });

    it("is behind us when the founder said not now", () => {
      expect(deriveOnboardingState({ ...asked, signedInProductDeclined: true })).toBe(
        "audit_preparing",
      );
    });

    /*
     * A product with no live address has no origin to open, and the Deep Scan
     * domain refuses it outright. Asking anyway would be a question whose only
     * available answer is no.
     */
    it("is never offered when there is nothing to sign in to", () => {
      expect(
        deriveOnboardingState({ ...asked, signedInProductOfferable: false }),
      ).toBe("audit_preparing");
    });

    /*
     * The cascade's own guarantee, stated where it matters most: this step is
     * not a gate in front of work that is already running. An audit in flight
     * outranks nothing here — it is *below* this in the cascade — so the
     * ordering is asserted rather than assumed.
     */
    it("does not interrupt an audit that is already running", () => {
      expect(
        deriveOnboardingState({ ...asked, hasSignedInProduct: true, auditRunning: true }),
      ).toBe("audit_preparing");
    });
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
    ["add_signed_in_product", "understand"],
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

/**
 * Setup as the rail draws it.
 *
 * The list is four rows and its whole claim is *where we are and how much is
 * left*, so what is worth testing is the shape of that claim rather than the
 * words: one step is current, everything before it is carried out, everything
 * after is waiting, and a finished setup has nothing still ringed.
 */
describe("setup, as an ordered list", () => {
  it("marks exactly one step as the one being worked on", () => {
    for (const state of ONBOARDING_STATES) {
      const here = onboardingSteps(state).filter((step) => step.state === "here");
      /* `complete` is the exception, and the only one: nothing is current
         because nothing is left. */
      expect(here, state).toHaveLength(state === "complete" ? 0 : 1);
    }
  });

  it("never leaves a carried-out step after a waiting one", () => {
    for (const state of ONBOARDING_STATES) {
      const marks = onboardingSteps(state).map((step) => step.state);
      const lastDone = marks.lastIndexOf("done");
      const firstWaiting = marks.indexOf("waiting");

      /*
       * The order is the claim. A filled square below a hollow one would say
       * setup ran out of sequence, which `deriveOnboardingState` cannot
       * produce — it is a cascade, and being at a state is what makes every
       * earlier one true.
       */
      if (lastDone !== -1 && firstWaiting !== -1) {
        expect(lastDone, state).toBeLessThan(firstWaiting);
      }
    }
  });

  it("finishes the list when setup is finished", () => {
    expect(onboardingSteps("complete").map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("starts with nothing behind it", () => {
    expect(onboardingSteps("connect_source").map((step) => step.state)).toEqual([
      "here",
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  /* The row a founder is on is the phase the rest of the product agrees they
     are in, rather than a second reading of the same state. */
  it("rings the phase `onboardingPhase` names", () => {
    for (const state of ONBOARDING_STATES) {
      if (state === "complete") continue;
      const here = onboardingSteps(state).find((step) => step.state === "here");
      expect(here?.id, state).toBe(onboardingPhase(state));
    }
  });

  it("carries no fraction of any kind", () => {
    for (const state of ONBOARDING_STATES) {
      for (const step of onboardingSteps(state)) {
        expect(step.label, state).not.toMatch(/\d/);
      }
    }
  });
});
