import { describe, expect, it } from "vitest";
import { classifyStep, type ClassifyStepInput } from "./classify";
import { fakeRepositorySnapshotFor } from "./test-support";

/**
 * Server-side execution classification (CORE-2b §9, §10, §48, §50, §66).
 *
 * The tests are organised by the question each answer is supposed to settle,
 * because the whole point of a six-value enum is that six different things can
 * be said and none of them has to be a lie.
 */

const SEO_EVIDENCE = ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"];
const CONTEXT = { repository: fakeRepositorySnapshotFor() };

describe("classifyStep", () => {
  it("marks a registry-matched product change executable, with the capability named", () => {
    const result = classifyStep(
      { actor: "vibe", changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      CONTEXT,
    );

    expect(result.executionSupport).toBe("vibe_executes_now");
    expect(result.capability).toBe("nextjs_seo_foundations_v2");
    expect(result.requiresApproval).toBe(true);
  });

  /**
   * §74 — the Stripe case. A perfectly valid business step with no executor.
   *
   * It stays in the plan and it is not called executable. Both halves matter:
   * suppressing it would make the plan about Vibe rather than the business, and
   * marking it executable would make a future button lie.
   */
  it("keeps an unsupported product change honest", () => {
    const result = classifyStep(
      { actor: "vibe", changeKind: "product_change", evidenceIds: ["repo.surface.payments"] },
      CONTEXT,
    );

    expect(result.executionSupport).toBe("not_yet_supported");
    expect(result.capability).toBeNull();
  });

  /** §24, §25 — Vibe's own preparation work, which is not a button. */
  it("marks Vibe's analysis as preparation rather than execution", () => {
    const result = classifyStep({ actor: "vibe", changeKind: "analysis", evidenceIds: [] }, CONTEXT);

    expect(result.executionSupport).toBe("vibe_prepares");
    expect(result.capability).toBeNull();
    expect(result.requiresApproval).toBe(false);
  });

  it("treats defining a measurement as preparation", () => {
    expect(
      classifyStep({ actor: "vibe", changeKind: "measurement", evidenceIds: [] }, CONTEXT)
        .executionSupport,
    ).toBe("vibe_prepares");
  });

  /**
   * §22, §75 — a strategic decision. Vibe claims no authority over it, and
   * `classifyStep` cannot be talked into one because the actor decides.
   */
  it("gives a founder decision to the founder", () => {
    const result = classifyStep(
      { actor: "founder_decision", changeKind: "decision", evidenceIds: [] },
      CONTEXT,
    );

    expect(result.executionSupport).toBe("founder_decides");
    expect(result.capability).toBeNull();
  });

  /** §26, §76 — a decision and a manual action are different things. */
  it("distinguishes a manual founder action from a decision", () => {
    const result = classifyStep(
      { actor: "founder_action", changeKind: "research", evidenceIds: [] },
      CONTEXT,
    );

    expect(result.executionSupport).toBe("founder_acts");
    expect(result.executionSupport).not.toBe("founder_decides");
  });

  /** §27, §77 — waiting on the world is a state, not a failure. */
  it("represents an external dependency as itself", () => {
    const result = classifyStep(
      { actor: "external_party", changeKind: "external_setup", evidenceIds: [] },
      CONTEXT,
    );

    expect(result.executionSupport).toBe("external_dependency");
  });

  /**
   * §50 — approval and execution support are independent axes.
   *
   * The pair asserted here is the one that would be unrepresentable if
   * execution support were a boolean: this would need sign-off *and* Vibe
   * cannot do it.
   */
  it("can require approval for something it cannot execute", () => {
    const result = classifyStep(
      { actor: "founder_action", changeKind: "product_change", evidenceIds: [] },
      CONTEXT,
    );

    expect(result.requiresApproval).toBe(true);
    expect(result.executionSupport).toBe("founder_acts");
  });

  /**
   * §67 — the invariant the database also enforces. A capability exists on a
   * step if and only if that step is executable.
   */
  it("only ever attaches a capability to an executable step", () => {
    const cases: ClassifyStepInput[] = [
      { actor: "vibe", changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      { actor: "vibe", changeKind: "product_change", evidenceIds: [] },
      { actor: "vibe", changeKind: "analysis", evidenceIds: SEO_EVIDENCE },
      { actor: "founder_decision", changeKind: "decision", evidenceIds: SEO_EVIDENCE },
      { actor: "founder_action", changeKind: "research", evidenceIds: SEO_EVIDENCE },
      { actor: "external_party", changeKind: "external_setup", evidenceIds: SEO_EVIDENCE },
    ];

    for (const input of cases) {
      const result = classifyStep(input, CONTEXT);
      expect(result.capability !== null).toBe(result.executionSupport === "vibe_executes_now");
    }
  });
});

/**
 * `measurement` beyond "define a signal" (CORE-2b MINI VERIFICATION §2).
 *
 * The real dogfood produced a step meaning "sign in as staff and confirm the
 * path from homepage to dashboard works end to end", classified
 * `changeKind: measurement`, `actor: founder_action` — a verification, not a
 * metric definition. Traced through every place `changeKind` drives
 * behaviour (`classify.ts`, `capability-registry.ts`,
 * `validate.ts`'s `no_changed_state` check) before broadening the
 * documented meaning: `classifyStep` never reads `changeKind` at all for
 * `founder_action`/`founder_decision`/`external_party` steps, and no
 * registry capability lists `measurement` among the `changeKinds` it can
 * match — so nothing routed incorrectly. This pins that finding as a
 * regression: the exact real shape, reproduced.
 */
describe("measurement beyond 'define a signal'", () => {
  it("routes a founder-performed verification exactly like any other founder_action step", () => {
    const result = classifyStep(
      { actor: "founder_action", changeKind: "measurement", evidenceIds: [] },
      CONTEXT,
    );

    expect(result.executionSupport).toBe("founder_acts");
    expect(result.capability).toBeNull();
    // Confirming a built thing works is not itself a change with consequences
    // requiring sign-off — the founder doing the confirming is the check.
    expect(result.requiresApproval).toBe(false);
  });

  /**
   * The one thing that must never happen regardless of which reading of
   * `measurement` a model intends: it must never resolve to the SEO
   * capability, or any future one, by coincidence of enum value.
   */
  it("never lets a verification-shaped measurement step match a registry capability", () => {
    const result = classifyStep(
      {
        actor: "vibe",
        changeKind: "measurement",
        evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
      },
      CONTEXT,
    );

    expect(result.executionSupport).not.toBe("vibe_executes_now");
    expect(result.capability).toBeNull();
  });
});
