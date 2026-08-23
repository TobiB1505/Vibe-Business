import { describe, expect, it } from "vitest";
import { fakeAudit } from "@/modules/opportunities/test-support";
import { fakeSeoOpportunity } from "@/modules/execution/test-support";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import {
  AUDIT_SYNTHESIS_VERSION,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import { buildHomeView } from "./command-center";

/**
 * Home's view model (CORE-5).
 *
 * Home is the first screen after opening a project, so it is the screen with
 * the most to gain from a confident sentence and the most to lose from a false
 * one. Every test here is about a state where the truthful answer is "Vibe
 * doesn't know", and about keeping that distinguishable from "the answer is
 * bad".
 */

function conclusion(overrides: Partial<BusinessConclusion> = {}): BusinessConclusion {
  return {
    rootProblem: "The business has not decided how value becomes revenue.",
    headline: "People still don't have a clear way to pay you.",
    explanation: "Vibe couldn't find prices or anything to buy.",
    whyItMatters: "Without a way to pay, nothing else you improve can turn into revenue.",
    evidenceIds: ["live.surface.pricing"],
    dimensions: ["monetization"],
    lenses: ["revenue_economics"],
    tone: "critical",
    confidence: "high",
    ...overrides,
  };
}

function synthesis(overrides: Partial<AuditSynthesis> = {}): AuditSynthesis {
  return {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses: [],
    overall: "You have a real product, but nobody can pay for it.",
    strengths: [],
    blockers: [conclusion()],
    ...overrides,
  };
}

function auditWithScore(
  score: number | null,
  overrides: Partial<BusinessReadinessAudit> = {},
): BusinessReadinessAudit {
  const base = fakeAudit({ synthesis: synthesis(), ...overrides });
  return {
    ...base,
    overall: {
      ...base.overall,
      score,
      insufficientCoverageReason:
        score === null ? "Not enough evidence to assess three of five areas." : null,
    },
  };
}

describe("what Home says about the product", () => {
  it("names the product and its purpose from the profile", () => {
    const view = buildHomeView({
      profile: fakeProductProfile(),
      audit: null,
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.identity.productName).toBe("Acme");
    expect(view.identity.purpose).toContain("web application for small product teams");
  });

  it("claims nothing about a product Vibe has not understood yet", () => {
    const view = buildHomeView({
      profile: null,
      audit: null,
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.identity.productName).toBeNull();
    expect(view.identity.purpose).toBeNull();
  });
});

describe("what Home says about business health", () => {
  it("shows a real score as a score", () => {
    const view = buildHomeView({
      profile: null,
      audit: auditWithScore(64),
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.health).toMatchObject({ kind: "scored", score: 64 });
  });

  /**
   * The rule this whole module exists for (CLAUDE.md rule 44). A project that
   * has never been audited has no score. It does not have a score of zero, and
   * a Home screen that rendered one would be telling a founder their business
   * scored nothing when Vibe simply never looked.
   */
  it("has no score at all before an audit has run", () => {
    const view = buildHomeView({
      profile: fakeProductProfile(),
      audit: null,
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.health).toEqual({ kind: "not_analyzed" });
    expect(JSON.stringify(view.health)).not.toContain("0");
  });

  /**
   * And the state that is neither: an audit that ran and could not assess
   * enough to produce an overall figure. That is a statement about the
   * evidence, so it keeps the audit's own reason rather than becoming a zero
   * or collapsing into "not analyzed".
   */
  it("separates 'could not be scored' from 'never analyzed'", () => {
    const view = buildHomeView({
      profile: null,
      audit: auditWithScore(null),
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.health.kind).toBe("unscored");
    expect(view.health).toHaveProperty("reason", expect.stringContaining("Not enough evidence"));
    expect(view.health).not.toHaveProperty("score");
  });

  it("never rewords the audit's own conclusion", () => {
    const audit = auditWithScore(64);
    const conclusion = audit.synthesis?.overall ?? null;

    const view = buildHomeView({
      profile: null,
      audit,
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.health).toMatchObject({ conclusion });
  });
});

describe("the finding Home leads with", () => {
  it("is the audit's own first blocker, unchanged", () => {
    const audit = auditWithScore(40);
    const blocker = audit.synthesis?.blockers?.[0];

    const view = buildHomeView({
      profile: null,
      audit,
      opportunities: null,
      preparedCount: 0,
    });

    expect(blocker).toBeDefined();
    expect(view.finding).toEqual({
      headline: blocker!.headline,
      whyItMatters: blocker!.whyItMatters,
    });
  });

  it("shows no finding when the audit found no blockers", () => {
    const base = auditWithScore(88);
    const audit = {
      ...base,
      synthesis: base.synthesis ? { ...base.synthesis, blockers: [] } : null,
    };

    const view = buildHomeView({
      profile: null,
      audit,
      opportunities: null,
      preparedCount: 0,
    });

    expect(view.finding).toBeNull();
  });
});

describe("the next move Home recommends", () => {
  it("takes the highest-ranked Move, not the first in the array", () => {
    const third = fakeSeoOpportunity({ id: "c", rank: 3, title: "Third" });
    const first = fakeSeoOpportunity({ id: "a", rank: 1, title: "First" });

    const view = buildHomeView({
      profile: null,
      audit: null,
      // Deliberately out of order: rank is the contract, position is not.
      opportunities: [third, first],
      preparedCount: 0,
    });

    expect(view.nextMove).toMatchObject({ kind: "move", title: "First" });
  });

  it("carries the Move's own problem and impact, unrated by this module", () => {
    const move = fakeSeoOpportunity({ rank: 1, impact: "high" });

    const view = buildHomeView({
      profile: null,
      audit: null,
      opportunities: [move],
      preparedCount: 0,
    });

    expect(view.nextMove).toEqual({
      kind: "move",
      title: move.title,
      problem: move.problem,
      impact: "high",
    });
  });

  /**
   * "Vibe has not looked for moves yet" and "Vibe looked and found none" are
   * different sentences to read on your own dashboard, and only one of them
   * suggests there is nothing worth doing. Collapsing them into one empty
   * state is the failure this pair pins.
   */
  it("distinguishes never having looked from having found nothing", () => {
    const neverRan = buildHomeView({
      profile: null,
      audit: null,
      opportunities: null,
      preparedCount: 0,
    });
    const ranAndFoundNothing = buildHomeView({
      profile: null,
      audit: null,
      opportunities: [],
      preparedCount: 0,
    });

    expect(neverRan.nextMove).toEqual({ kind: "not_identified" });
    expect(ranAndFoundNothing.nextMove).toEqual({ kind: "none_found" });
  });
});

describe("prepared changes", () => {
  it("passes the count through, zero included", () => {
    // Unlike a score, zero prepared changes is a fact Vibe genuinely knows:
    // the query succeeded and there are none. It is shown as such.
    expect(
      buildHomeView({ profile: null, audit: null, opportunities: null, preparedCount: 0 })
        .preparedCount,
    ).toBe(0);
    expect(
      buildHomeView({ profile: null, audit: null, opportunities: null, preparedCount: 3 })
        .preparedCount,
    ).toBe(3);
  });
});
