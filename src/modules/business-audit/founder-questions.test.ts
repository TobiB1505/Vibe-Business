import { describe, expect, it } from "vitest";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import type { ProductProfile } from "@/modules/product-understanding/schema";
import { EMPTY_FOUNDER_INTENT, type FounderIntent } from "@/modules/projects/founder-intent";
import {
  MAX_FOUNDER_QUESTIONS,
  selectFounderQuestions,
  shouldAskBeforeAudit,
} from "./founder-questions";
import type { BusinessLensAssessment, BusinessLens, LensMateriality } from "./schema";

/**
 * Adaptive founder questions (CORE-2a.3 §22–§31, §74).
 *
 * The rule under test is "ask only when the answer could materially change the
 * audit" — which mostly means testing what Vibe *refuses* to ask. A system that
 * asks everything is a form, and CORE-2 deleted one of those already.
 */

const FULL_INTENT: FounderIntent = {
  stage: "active_users",
  monetizationModel: "subscription",
  primaryGoal: "grow_revenue",
};

function blocked(
  lens: BusinessLens,
  materiality: LensMateriality = "now",
): BusinessLensAssessment {
  return {
    lens,
    health: "blocked_by_missing_context",
    materiality,
    summary: "Could not assess.",
    evidenceIds: [],
    missingContext: ["Something only the founder knows"],
  };
}

function select(
  overrides: {
    profile?: ProductProfile;
    intent?: Partial<FounderIntent>;
    lenses?: BusinessLensAssessment[];
  } = {},
) {
  return selectFounderQuestions({
    profile: overrides.profile ?? fakeProductProfile(),
    intent: { ...FULL_INTENT, ...overrides.intent },
    lenses: overrides.lenses ?? [],
  });
}

const intentsOf = (qs: ReturnType<typeof select>) => qs.map((q) => q.intent);

describe("Vibe never asks what it already knows (§20, DoD 26)", () => {
  it("asks nothing when intent is complete and the profile is confident", () => {
    expect(select()).toEqual([]);
  });

  it.each([
    ["stage", { stage: null }, "current_stage"],
    ["goal", { primaryGoal: null }, "primary_goal"],
    ["monetization", { monetizationModel: null }, "monetization_intent"],
  ])("asks about %s only when it is missing", (_label, intent, expected) => {
    expect(intentsOf(select({ intent }))).toContain(expected);
    expect(intentsOf(select())).not.toContain(expected);
  });

  /**
   * The audience question is the one most likely to insult a founder by
   * repetition: they already corrected it, and a correction is the strongest
   * claim in the system.
   */
  it("never asks about the audience the founder already confirmed", () => {
    // The default fixture's audience is `user_confirmed`.
    expect(intentsOf(select({ lenses: [blocked("audience")] }))).not.toContain("first_customer");
  });

  it("asks about the first customer when the audience was only inferred", () => {
    const profile = fakeProductProfile();
    const inferred: ProductProfile = {
      ...profile,
      audience: {
        ...profile.audience,
        primaryAudience: {
          value: null,
          confidence: "not_found",
          sources: ["ai_inferred"],
          evidence: [],
        },
      },
    };

    expect(intentsOf(select({ profile: inferred }))).toContain("first_customer");
  });
});

describe("uncertainty x impact, not emptiness (§23)", () => {
  /**
   * The signal that separates a question from a form field: the audit itself
   * said it could not judge the business without this.
   */
  it("raises monetization above the goal question when economics is blocked", () => {
    const questions = select({
      intent: { monetizationModel: null, primaryGoal: null },
      lenses: [blocked("revenue_economics")],
    });

    // Stage is known here, so the ordering question is monetization vs goal.
    expect(intentsOf(questions)[0]).toBe("monetization_intent");
    expect(intentsOf(questions).indexOf("monetization_intent")).toBeLessThan(
      intentsOf(questions).indexOf("primary_goal"),
    );
  });

  it("leaves monetization below the goal question when economics is fine", () => {
    const questions = select({ intent: { monetizationModel: null, primaryGoal: null } });

    expect(intentsOf(questions).indexOf("primary_goal")).toBeLessThan(
      intentsOf(questions).indexOf("monetization_intent"),
    );
  });

  /**
   * A blocked lens the audit itself ranked as a later stage's problem is a
   * question worth asking eventually, not one worth interrupting for.
   */
  it("ignores a blocked lens that does not matter yet", () => {
    expect(intentsOf(select({ lenses: [blocked("audience", "later")] }))).not.toContain(
      "first_customer",
    );
    expect(intentsOf(select({ lenses: [blocked("audience", "not_material")] }))).not.toContain(
      "first_customer",
    );
  });

  /**
   * §26 — the field that would be "useful someday". Asked only when payment is
   * genuinely near, never by default.
   */
  it("does not ask about the operating market by default", () => {
    expect(intentsOf(select({ intent: {} }))).not.toContain("operating_market");
    expect(
      intentsOf(select({ lenses: [blocked("business_readiness")], intent: { monetizationModel: "none" } })),
    ).not.toContain("operating_market");
  });

  it("asks about the operating market once the founder intends to charge and readiness is blocked", () => {
    const questions = select({
      intent: { monetizationModel: "subscription" },
      lenses: [blocked("business_readiness")],
    });

    expect(intentsOf(questions)).toContain("operating_market");
  });
});

describe("the question set stays small (§24)", () => {
  it("never exceeds the budget even when everything is unknown", () => {
    const profile = fakeProductProfile();
    const bare: ProductProfile = {
      ...profile,
      audience: {
        ...profile.audience,
        primaryAudience: { value: null, confidence: "not_found", sources: [], evidence: [] },
      },
    };

    const questions = selectFounderQuestions({
      profile: bare,
      intent: EMPTY_FOUNDER_INTENT,
      lenses: [blocked("revenue_economics"), blocked("audience"), blocked("business_readiness")],
    });

    expect(questions.length).toBeLessThanOrEqual(MAX_FOUNDER_QUESTIONS);
    expect(questions.length).toBeLessThanOrEqual(5);
  });

  it("orders by weight, most valuable first", () => {
    const questions = selectFounderQuestions({
      profile: fakeProductProfile(),
      intent: EMPTY_FOUNDER_INTENT,
      lenses: [],
    });

    const weights = questions.map((q) => q.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});

describe("every question is grounded (§29)", () => {
  it("only claims the audience Vibe actually holds", () => {
    const profile = fakeProductProfile();
    const inferred: ProductProfile = {
      ...profile,
      audience: {
        ...profile.audience,
        primaryAudience: {
          value: "Small restaurant owners",
          confidence: "unclear",
          sources: ["ai_inferred"],
          evidence: [],
        },
      },
    };

    const question = select({ profile: inferred }).find((q) => q.intent === "first_customer");
    expect(question?.prompt).toContain("small restaurant owners");
    expect(question?.context).toContain("worked that out from your product");
  });

  it("says nothing specific rather than inventing a premise", () => {
    const profile = fakeProductProfile();
    const bare: ProductProfile = {
      ...profile,
      identity: {
        ...profile.identity,
        understanding: { value: null, confidence: "not_found", sources: [], evidence: [] },
      },
    };

    const stage = select({ profile: bare, intent: { stage: null } }).find(
      (q) => q.intent === "current_stage",
    );
    expect(stage?.context).toBeNull();
  });

  /**
   * §28 — the question itself should show that Vibe understood the product.
   * When the audit says economics is unassessable, the question says why.
   */
  it("explains why it is asking when the audit could not judge the economics", () => {
    const question = select({
      intent: { monetizationModel: null },
      lenses: [blocked("revenue_economics")],
    }).find((q) => q.intent === "monetization_intent");

    expect(question?.context).toContain("can't infer from your product");
  });
});

describe("'I'm not sure' where it is honest (§48)", () => {
  it("allows uncertainty on strategy questions", () => {
    const questions = selectFounderQuestions({
      profile: fakeProductProfile(),
      intent: EMPTY_FOUNDER_INTENT,
      lenses: [],
    });

    expect(questions.find((q) => q.intent === "primary_goal")?.allowsUnsure).toBe(true);
    expect(questions.find((q) => q.intent === "monetization_intent")?.allowsUnsure).toBe(true);
  });

  /** Where they are today is a fact they know, not a strategy to invent. */
  it("does not offer uncertainty on the current stage", () => {
    const questions = selectFounderQuestions({
      profile: fakeProductProfile(),
      intent: EMPTY_FOUNDER_INTENT,
      lenses: [],
    });

    expect(questions.find((q) => q.intent === "current_stage")?.allowsUnsure).toBe(false);
  });
});

describe("shouldAskBeforeAudit (§45)", () => {
  it("interrupts for stage and goal, which change several lenses at once", () => {
    expect(shouldAskBeforeAudit(EMPTY_FOUNDER_INTENT)).toBe(true);
    expect(shouldAskBeforeAudit({ ...FULL_INTENT, stage: null })).toBe(true);
    expect(shouldAskBeforeAudit({ ...FULL_INTENT, primaryGoal: null })).toBe(true);
  });

  it("does not interrupt for monetization alone — that can wait for the audit", () => {
    expect(shouldAskBeforeAudit({ ...FULL_INTENT, monetizationModel: null })).toBe(false);
  });
});

/**
 * The contract the future Founder Questions UX depends on (CORE-2a.3.2 §30).
 *
 * That experience is deliberately not built in this sprint. What must hold now
 * is that the audit keeps *producing* what it will need: which fact is missing,
 * which area of the business is waiting on it, and how much that area matters
 * — so the UX can be built later without another audit contract change.
 *
 * Asserted here rather than left implicit because `missingContext` is the kind
 * of field that gets quietly dropped in a refactor when nothing reads it, and
 * nothing in production reads it yet.
 */
describe("the audit exposes what only the founder can answer (§30)", () => {
  it("carries the missing fact, its lens and its materiality together", () => {
    const assessment = blocked("revenue_economics", "now");

    expect(assessment.lens).toBe("revenue_economics");
    expect(assessment.materiality).toBe("now");
    expect(assessment.missingContext).not.toEqual([]);
  });

  /** All three are needed: the question, where it belongs, and whether to ask now. */
  it("raises a question only when the waiting area actually matters now", () => {
    const urgent = select({
      intent: { monetizationModel: null },
      lenses: [blocked("revenue_economics", "now")],
    });
    const premature = select({
      intent: { monetizationModel: null },
      lenses: [blocked("revenue_economics", "later")],
    });

    const urgentWeight = urgent.find((q) => q.intent === "monetization_intent")?.weight ?? 0;
    const prematureWeight = premature.find((q) => q.intent === "monetization_intent")?.weight ?? 0;

    // Both are asked — the field is empty either way — but the audit saying it
    // cannot judge the business without this is what makes it urgent.
    expect(urgentWeight).toBeGreaterThan(prematureWeight);
  });

  it("explains why the answer matters rather than just naming the field", () => {
    const question = select({
      intent: { monetizationModel: null },
      lenses: [blocked("revenue_economics", "now")],
    }).find((q) => q.intent === "monetization_intent");

    expect(question?.context).toContain("can't infer");
  });
});
