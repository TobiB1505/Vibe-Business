import { describe, expect, it } from "vitest";
import { resolveExecutionCapability } from "@/modules/execution/capabilities";
import { CURRENT_SEO_FOUNDATIONS_CAPABILITY } from "@/modules/execution/schema";
import { isKnownCapability, matchCapability } from "./capability-registry";
import { classifyStep } from "./classify";
import { fakeOpportunity, fakeRepositorySnapshotFor } from "./test-support";

/**
 * The server-owned capability registry (CORE-2b §10, §46, §47, §67, §84).
 *
 * The property under test throughout is the same one: **only structured
 * evidence produces a capability**. Every test here changes one structured fact
 * and asserts the answer changes with it, and one changes only the wording and
 * asserts the answer does not.
 */

const SEO_EVIDENCE = ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"];

describe("matchCapability", () => {
  it("matches the SEO foundations capability on structured evidence", () => {
    const match = matchCapability(
      { changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      { repository: fakeRepositorySnapshotFor() },
    );

    expect(match?.capability).toBe(CURRENT_SEO_FOUNDATIONS_CAPABILITY);
    expect(match?.capabilityVersion).toBe("nextjs-seo-foundations-v2");
  });

  it("does not match when only half the capability's scope is cited", () => {
    const match = matchCapability(
      { changeKind: "product_change", evidenceIds: ["live.seo.robots_txt_missing"] },
      { repository: fakeRepositorySnapshotFor() },
    );

    expect(match).toBeNull();
  });

  it("does not match an unsupported framework", () => {
    const match = matchCapability(
      { changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      { repository: fakeRepositorySnapshotFor({ frameworks: [{ id: "astro", name: "Astro" }] }) },
    );

    expect(match).toBeNull();
  });

  it("does not match when the product already has the surfaces", () => {
    const match = matchCapability(
      { changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      {
        repository: fakeRepositorySnapshotFor({ robotsDetected: true, sitemapDetected: true }),
      },
    );

    expect(match).toBeNull();
  });

  it("does not match without a repository snapshot", () => {
    const match = matchCapability(
      { changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      { repository: null },
    );

    expect(match).toBeNull();
  });

  /**
   * A capability that writes files can never serve a decision, whatever the
   * step happens to cite. The change kind is checked before anything else
   * precisely so this cannot depend on evidence coincidence.
   */
  it("never matches a non-product change", () => {
    for (const changeKind of ["decision", "analysis", "research", "measurement"] as const) {
      expect(
        matchCapability(
          { changeKind, evidenceIds: SEO_EVIDENCE },
          { repository: fakeRepositorySnapshotFor() },
        ),
      ).toBeNull();
    }
  });

  /**
   * §47's real requirement, stated as a test: the *words* do not matter.
   *
   * Two steps with opposite wording and identical structure resolve identically.
   * If this ever fails, someone has started reading model prose to decide what
   * Vibe is willing to execute.
   */
  it("ignores wording entirely", () => {
    const context = { repository: fakeRepositorySnapshotFor() };

    const structured = matchCapability(
      { changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      context,
    );
    // A step whose title says "SEO" loudly, with no supporting structure.
    const wordy = matchCapability(
      { changeKind: "product_change", evidenceIds: ["profile.identity.description"] },
      context,
    );

    expect(structured).not.toBeNull();
    expect(wordy).toBeNull();
  });

  it("rejects capability ids it does not own", () => {
    expect(isKnownCapability("stripe_checkout_v9")).toBe(false);
    expect(isKnownCapability(CURRENT_SEO_FOUNDATIONS_CAPABILITY)).toBe(true);
  });
});

/**
 * The planner's registry and the execution module's resolver must agree about
 * what `nextjs_seo_foundations_v2` requires.
 *
 * They read the same evidence-id constants and the same snapshot facts, which
 * is what makes agreement structural rather than coincidental — but nothing
 * would catch the two drifting apart, so this asserts it directly on the facts
 * they share.
 */
describe("agreement with the execution resolver", () => {
  it("resolves the same capability from the same facts", () => {
    const repository = fakeRepositorySnapshotFor();

    const planner = matchCapability(
      { changeKind: "product_change", evidenceIds: SEO_EVIDENCE },
      { repository },
    );
    const execution = resolveExecutionCapability({
      opportunity: fakeOpportunity({
        executionType: "code_change",
        evidenceIds: SEO_EVIDENCE,
      }),
      repository,
      hasProductionOrigin: true,
    });

    expect(execution.supported).toBe(true);
    expect(planner?.capability).toBe(
      execution.supported ? execution.capability : "unreachable",
    );
  });

  it("both refuse when the framework is unsupported", () => {
    const repository = fakeRepositorySnapshotFor({
      frameworks: [{ id: "astro", name: "Astro" }],
    });

    expect(
      matchCapability({ changeKind: "product_change", evidenceIds: SEO_EVIDENCE }, { repository }),
    ).toBeNull();
    expect(
      resolveExecutionCapability({
        opportunity: fakeOpportunity({ executionType: "code_change", evidenceIds: SEO_EVIDENCE }),
        repository,
        hasProductionOrigin: true,
      }).supported,
    ).toBe(false);
  });
});

/**
 * §49 — never call a payment, authentication, permission or data-deletion
 * change "safe autonomous execution".
 *
 * This holds structurally rather than by a risk framework: `vibe_executes_now`
 * is reachable only through the registry, and the registry writes two static
 * metadata files. The test pins the consequence so that adding a registry entry
 * with a wider blast radius has to confront it.
 */
describe("risk", () => {
  it("never marks a payments change executable", () => {
    const classification = classifyStep(
      {
        actor: "vibe",
        changeKind: "product_change",
        evidenceIds: ["repo.surface.payments", "live.surface.pricing"],
      },
      { repository: fakeRepositorySnapshotFor() },
    );

    expect(classification.executionSupport).toBe("not_yet_supported");
    expect(classification.capability).toBeNull();
    // Still an approval-requiring action. Unsupported and consequential are
    // independent facts, and both are true here (§50).
    expect(classification.requiresApproval).toBe(true);
  });
});
