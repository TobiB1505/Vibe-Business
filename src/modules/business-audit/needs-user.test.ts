import { describe, expect, it } from "vitest";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import type { ProductProfile } from "@/modules/product-understanding/schema";
import { EMPTY_FOUNDER_INTENT, type FounderIntent } from "@/modules/projects/founder-intent";
import {
  MAX_INTERRUPTIONS_PER_AUDIT,
  isFounderOnly,
  selectBlockingQuestion,
  type InterruptionInput,
} from "./needs-user";
import { FOUNDER_QUESTION_INTENTS, type FounderQuestionIntent } from "./founder-questions";
import type { BusinessLens, BusinessLensAssessment, LensMateriality } from "./schema";

/**
 * The "Vibe needs u" gate (CORE-2a.4 §42–§50).
 *
 * ## What these are guarding
 *
 * Almost every test here asserts that Vibe **does not** ask. That is the point
 * of the sprint: the audit already knows which facts only the founder holds,
 * and turning all of them into questions would rebuild the onboarding form
 * CORE-2 deleted — just with better copy and a progress bar.
 *
 * The two cases worth stopping for are the interesting ones; the other seven
 * are the product.
 */

const COMPLETE_INTENT: FounderIntent = {
  stage: "active_users",
  monetizationModel: "subscription",
  primaryGoal: "grow_revenue",
};

function lens(
  id: BusinessLens,
  materiality: LensMateriality,
  health: "weak" | "adequate" | "unclear" | "blocked_by_missing_context" = "weak",
): BusinessLensAssessment {
  return {
    lens: id,
    health,
    materiality,
    summary: `Internal reasoning for ${id}.`,
    evidenceIds: [],
    missingContext: ["Something only the founder knows"],
  };
}

/** A profile whose audience was inferred rather than confirmed by the founder. */
function inferredAudience(value: string | null = "Software founders and builders"): ProductProfile {
  const profile = fakeProductProfile();
  return {
    ...profile,
    audience: {
      ...profile.audience,
      primaryAudience: {
        value,
        confidence: value === null ? "not_found" : "unclear",
        sources: ["ai_inferred"],
        evidence: [],
      },
    },
  };
}

function decide(overrides: Partial<InterruptionInput> = {}) {
  return selectBlockingQuestion({
    profile: overrides.profile ?? fakeProductProfile(),
    intent: overrides.intent ?? COMPLETE_INTENT,
    lenses: overrides.lenses ?? [],
    lensesReflectCurrentFacts: overrides.lensesReflectCurrentFacts ?? true,
    askedIntents: overrides.askedIntents ?? [],
  });
}

describe("a zero-question audit is the normal outcome (§10, §20, §42)", () => {
  it("does not stop when intent is current and the profile is confident", () => {
    const decision = decide();

    expect(decision.ask).toBe(false);
    if (decision.ask) return;
    expect(decision.reason).toBe("nothing_unresolved");
  });

  /**
   * The failure mode this guards against is theatre: manufacturing a moment so
   * the feature has something to show. An audit that already knows enough must
   * run start to finish untouched.
   */
  it("stays silent even when every lens reports missing context", () => {
    const decision = decide({
      lenses: [
        lens("audience", "now", "blocked_by_missing_context"),
        lens("revenue_economics", "now", "blocked_by_missing_context"),
        lens("scalability", "now", "blocked_by_missing_context"),
      ],
    });

    expect(decision.ask).toBe(false);
  });
});

describe("only founder-only facts can stop an audit (§14, §49, §61)", () => {
  it("classifies every question intent as founder-only", () => {
    for (const intent of FOUNDER_QUESTION_INTENTS) {
      expect(isFounderOnly(intent)).toBe(true);
    }
  });

  /**
   * The sharpest real case. A lens genuinely reported "only you can answer what
   * each audit run costs to deliver" — while `ai_usage_events` holds the exact
   * figure for every run ever made. Asking the founder for a number Vibe bills
   * itself would be the most embarrassing possible question, and it was one
   * lens assessment away from being asked.
   *
   * The structural defence is that the intent set contains nothing observable.
   * This asserts the enum has not quietly grown one.
   */
  it("has no intent that a scan or the ledger could answer", () => {
    const observable = [
      "audit_cost",
      "cost_to_serve",
      "traffic",
      "analytics_installed",
      "pricing_visible",
      "payment_provider",
      "acquisition_channel",
    ];

    for (const forbidden of observable) {
      expect(FOUNDER_QUESTION_INTENTS as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe("materiality decides whether it is worth stopping (§6, §47, §48)", () => {
  /** §43 — the case that should stop: unknown first customer, and it blocks now. */
  it("stops for an unresolved first customer when audience matters now", () => {
    const decision = decide({
      profile: inferredAudience(),
      lenses: [lens("audience", "now")],
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.intent).toBe("first_customer");
    expect(decision.question.materiality).toBe("now");
    expect(decision.question.affectedLenses).toContain("audience");
  });

  /** §47, §48 — a later-stage question must never interrupt. */
  it.each(["later", "not_material"] as const)(
    "does not stop when the affected areas are %s",
    (materiality) => {
      const decision = decide({
        profile: inferredAudience(),
        lenses: [
          lens("audience", materiality),
          lens("offer", materiality),
          lens("acquisition", materiality),
          lens("conversion", materiality),
        ],
      });

      expect(decision.ask).toBe(false);
      if (decision.ask) return;
      expect(decision.reason).toBe("not_material_yet");
    },
  );

  /**
   * §44 — a `soon` area may still stop the audit, because these answers change
   * how *this* run reads rather than only the next one.
   */
  it("stops for a soon area when the answer changes this audit", () => {
    const decision = decide({
      intent: { ...COMPLETE_INTENT, monetizationModel: null },
      lenses: [lens("revenue_economics", "soon")],
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.intent).toBe("monetization_intent");
    expect(decision.question.materiality).toBe("soon");
  });

  /**
   * The first-audit case. With no prior lens assessment, materiality cannot
   * argue either way, so the question stands on the profile and intent
   * evidence that produced it rather than being silently withheld.
   */
  it("still asks the highest-impact question when no prior audit exists", () => {
    const decision = decide({ intent: EMPTY_FOUNDER_INTENT, lenses: [] });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.intent).toBe("current_stage");
    expect(decision.question.materiality).toBeNull();
  });
});

describe("one question at a time, recalculated after each answer (§8, §18, §50)", () => {
  it("returns a single question rather than a list", () => {
    const decision = decide({ intent: EMPTY_FOUNDER_INTENT, profile: inferredAudience(null) });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.intent).toBeTruthy();
  });

  /**
   * §46, §50 — the dependency rule. Asking which market to operate in before
   * the founder has decided whether to charge at all would contradict the
   * audit's own reasoning, which already refuses to prioritize that work.
   */
  it("withholds a question whose prerequisite is itself still unanswered", () => {
    const decision = decide({
      intent: { stage: "prototype", monetizationModel: null, primaryGoal: "launch" },
      lenses: [lens("business_readiness", "now"), lens("revenue_economics", "later")],
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    // Never the market question while the charging decision is open.
    expect(decision.question.intent).not.toBe("operating_market");
  });

  /** A question already put to the founder in this run is never repeated (§17, §45). */
  it("does not ask the same thing twice in one audit", () => {
    const asked: FounderQuestionIntent[] = ["first_customer"];
    const decision = decide({
      profile: inferredAudience(),
      lenses: [lens("audience", "now")],
      askedIntents: asked,
    });

    expect(decision.ask).toBe(false);
    if (decision.ask) return;
    expect(decision.reason).toBe("already_asked");
  });

  /**
   * "I'm not sure yet" is recorded as an asked intent, so the honest answer
   * ends the question rather than looping — the founder said what they know.
   */
  it("treats an unsure answer as settled for this run", () => {
    const decision = decide({
      intent: { ...COMPLETE_INTENT, monetizationModel: null },
      lenses: [lens("revenue_economics", "now")],
      askedIntents: ["monetization_intent"],
    });

    expect(decision.ask).toBe(false);
  });
});

describe("the interruption budget holds (§9, §19)", () => {
  it("stops asking once the budget is spent", () => {
    const decision = decide({
      profile: inferredAudience(null),
      intent: EMPTY_FOUNDER_INTENT,
      lenses: [lens("audience", "now"), lens("revenue_economics", "now")],
      askedIntents: ["current_stage", "primary_goal", "monetization_intent"],
    });

    expect(decision.ask).toBe(false);
    if (decision.ask) return;
    expect(decision.reason).toBe("budget_spent");
  });

  it("keeps the budget small enough to stay an audit rather than a form", () => {
    expect(MAX_INTERRUPTIONS_PER_AUDIT).toBeLessThanOrEqual(3);
  });
});

describe("every interruption carries why it was worth it (§60)", () => {
  it("records the affected areas and the reason for stopping", () => {
    const decision = decide({
      profile: inferredAudience(),
      lenses: [lens("audience", "now")],
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.whyItMatters).toContain("blocking the next milestone");
    expect(decision.question.affectedLenses.length).toBeGreaterThan(1);
  });

  /**
   * §26 — an answer reaches further than the lens that raised it. Naming the
   * first customer changes who the offer is for and which channels are
   * plausible, not only the audience assessment.
   */
  it("names more than the one lens that raised the question", () => {
    const decision = decide({
      profile: inferredAudience(),
      lenses: [lens("audience", "now")],
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.affectedLenses).toEqual(
      expect.arrayContaining(["audience", "offer", "acquisition", "conversion"]),
    );
  });

  /** §12 — a premise Vibe cannot support is worse than no premise at all. */
  it("carries no invented context when the profile establishes nothing", () => {
    const bare = fakeProductProfile();
    const decision = decide({
      profile: {
        ...bare,
        identity: {
          ...bare.identity,
          understanding: { value: null, confidence: "not_found", sources: [], evidence: [] },
        },
      },
      intent: { ...COMPLETE_INTENT, stage: null },
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.intent).toBe("current_stage");
    expect(decision.question.context).toBeNull();
  });
});

/**
 * Previous lens data is a hint, not authority (CORE-2a.4, constraint 3).
 *
 * The lens assessments Vibe reasons from were produced against one specific
 * product profile and one specific set of founder answers — and this feature
 * exists to change both. An audit that paused, took an answer and resumed
 * would otherwise re-read a materiality that was decided before the answer
 * existed.
 *
 * Staleness is a fact here rather than a guess: every stored audit records the
 * `product_profile_id` and `founder_intent_hash` it reasoned from, so "do these
 * lenses still describe the current business?" has an exact answer.
 */
describe("current facts outrank the previous audit's lenses", () => {
  /**
   * The case that matters most, because it is the one this sprint creates: an
   * old audit said these areas were a later stage's problem, and the founder
   * has since changed the facts underneath it. That verdict cannot go on
   * silencing a question about the new situation.
   */
  it("stops treating a stale 'later' as a reason to withhold", () => {
    const staleLenses = [
      lens("audience", "later"),
      lens("offer", "later"),
      lens("acquisition", "later"),
      lens("conversion", "later"),
    ];

    const trusted = decide({ profile: inferredAudience(), lenses: staleLenses });
    const stale = decide({
      profile: inferredAudience(),
      lenses: staleLenses,
      lensesReflectCurrentFacts: false,
    });

    expect(trusted.ask).toBe(false);
    expect(stale.ask).toBe(true);
  });

  /** And symmetrically: a stale `now` must not promote a question either. */
  it("stops treating a stale 'now' as authority", () => {
    const decision = decide({
      profile: inferredAudience(),
      lenses: [lens("audience", "now")],
      lensesReflectCurrentFacts: false,
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    // Asked on the strength of the current profile, not of an old verdict.
    expect(decision.question.materiality).toBeNull();
  });

  /**
   * Precedence is not the same as pausing more. When the *current* profile and
   * intent already settle everything, stale lenses change nothing — there is
   * no question left for them to influence in either direction.
   */
  it("still asks nothing when current facts leave nothing unresolved", () => {
    const decision = decide({
      lenses: [lens("audience", "now"), lens("revenue_economics", "now")],
      lensesReflectCurrentFacts: false,
    });

    expect(decision.ask).toBe(false);
    if (decision.ask) return;
    expect(decision.reason).toBe("nothing_unresolved");
  });
});

/**
 * Onboarding is when the questions matter most (CORE-2a.4 follow-up).
 *
 * A smaller first-audit budget was tried and reverted. A new user has nothing
 * stored, which is precisely when stage and goal are worth asking: they change
 * materiality across every lens, and an audit reasoning without them reasons
 * worse. Suppressing the questions there buys a smoother first minute with a
 * weaker result.
 *
 * What made the first real run feel like a form was the wording, not the count
 * — which is asserted separately below.
 */
describe("a first audit may still ask its full budget", () => {
  const nothingKnown = {
    profile: inferredAudience(null),
    intent: EMPTY_FOUNDER_INTENT,
    lenses: [],
  };

  it("keeps asking while high-impact facts are unknown and unasked", () => {
    const first = decide(nothingKnown);
    expect(first.ask).toBe(true);
    if (!first.ask) return;

    const second = decide({ ...nothingKnown, askedIntents: [first.question.intent] });
    expect(second.ask).toBe(true);
  });

  it("asks the highest-impact unknown first", () => {
    const decision = decide(nothingKnown);

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.intent).toBe("current_stage");
  });

  /** The ceiling still holds — an onboarding is not an unbounded interview. */
  it("stops at the budget however much is unknown", () => {
    const decision = decide({
      ...nothingKnown,
      askedIntents: ["current_stage", "primary_goal", "monetization_intent"],
    });

    expect(decision.ask).toBe(false);
    if (decision.ask) return;
    expect(decision.reason).toBe("budget_spent");
  });
});

describe("a question shows what Vibe understood (§11, §62)", () => {
  const UNDERSTANDING =
    "You've built a vacation planning tool for hotel staff. It lets team members submit time-off requests.";

  function withUnderstanding() {
    const profile = fakeProductProfile();
    return {
      ...profile,
      identity: {
        ...profile.identity,
        name: { ...profile.identity.name, value: "Urlaubsplanung" },
        understanding: {
          value: UNDERSTANDING,
          confidence: "confirmed" as const,
          sources: ["ai_inferred" as const],
          evidence: [],
        },
      },
    };
  }

  /**
   * The failure this replaces: a founder whose profile said "a vacation
   * planning tool for hotel staff… instead of scattered emails or
   * spreadsheets" was told "Vibe can see what you've built". Vibe had the
   * sentence and described it instead of saying it.
   */
  it("quotes the understanding back rather than claiming to have one", () => {
    const decision = decide({
      profile: withUnderstanding(),
      intent: { ...COMPLETE_INTENT, stage: null },
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.context).toContain("vacation planning tool for hotel staff");
    expect(decision.question.context).not.toBe("Vibe can see what you've built, but not how far along it is with real people.");
  });

  /**
   * §62's test: could this have been shown to almost any startup? The goal
   * question used to answer yes twice over — a generic prompt and a context
   * line that explained Vibe's own process rather than the product.
   */
  it("names the product in the goal question instead of asking it of anyone", () => {
    const decision = decide({
      profile: withUnderstanding(),
      intent: { ...COMPLETE_INTENT, primaryGoal: null },
      lenses: [lens("audience", "now")],
    });

    expect(decision.ask).toBe(true);
    if (!decision.ask) return;
    expect(decision.question.prompt).toContain("Urlaubsplanung");
    expect(decision.question.context).toContain("vacation planning tool");
    expect(decision.question.context).not.toContain("Vibe puts first");
  });
});
