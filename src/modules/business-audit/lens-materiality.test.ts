import { describe, expect, it } from "vitest";
import { BUSINESS_READINESS_RUBRIC } from "./rubric";
import { buildSystemPrompt } from "./prompt";
import { buildEvidencePackV3, renderEvidencePackV3 } from "./evidence-v3";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import type { ProductProfile } from "@/modules/product-understanding/schema";
import { fakeFounderIntent, fakeLiveSnapshot, fakeRepositorySnapshot } from "./test-support";
import type { FounderIntent } from "@/modules/projects/founder-intent";

/**
 * Materiality adaptation (CORE-2a.3 §43, §55, §67–§73).
 *
 * ## What a test can and cannot prove here
 *
 * It cannot prove the model reasons well — that is the dogfood's job, and this
 * sprint's acceptance criterion is explicitly the real audit rather than the
 * suite. What it *can* prove is that the instructions and the inputs make good
 * reasoning possible: that the rubric states the adaptation rules, and that the
 * facts those rules depend on actually reach the model.
 *
 * A rule the model is never told, or told about data it never receives, is a
 * comment in a prompt file rather than a contract.
 */

function packFor(profile: ProductProfile, intent: FounderIntent): string {
  return renderEvidencePackV3(
    buildEvidencePackV3({
      productProfile: profile,
      founderIntent: intent,
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
      authenticatedProduct: null,
    }),
  );
}

describe("the rubric states the adaptation rules (§43, §55)", () => {
  const rubric = BUSINESS_READINESS_RUBRIC.toLowerCase().replace(/\s+/g, " ");

  it("tells the model materiality is not fixed", () => {
    expect(rubric).toContain("materiality is not fixed");
  });

  /** §70: a one-off product must not be marked down for having nothing to retain. */
  it("names the one-off product case explicitly", () => {
    expect(rubric).toContain("one-off");
    expect(rubric).toContain("not_material");
  });

  /** §71: the same gap is irrelevant pre-launch and serious with real traffic. */
  it("names the stage case explicitly", () => {
    expect(rubric).toContain("pre-launch prototype");
    expect(rubric).toContain("once real traffic exists");
  });

  /** §72: the same evidence should yield different priorities for different goals. */
  it("tells the model the founder's goal changes what matters", () => {
    expect(rubric).toContain("the founder's goal changes what matters");
  });

  /** §73: intent is a guide, not an override. */
  it("permits the audit to challenge a stated goal", () => {
    expect(rubric).toContain("does not override reality");
  });

  /** §42: one framework, no per-product-type engines. */
  it("handles a marketplace through the existing lenses rather than a tenth", () => {
    expect(rubric).toContain("rather than inventing a tenth lens");
  });
});

describe("the rubric separates a missing price from a missing revenue model (§17, §68, §69)", () => {
  const rubric = BUSINESS_READINESS_RUBRIC.toLowerCase();
  // The rubric is wrapped prose, so a phrase can straddle a line break.
  const flowed = rubric.replace(/\s+/g, " ");

  it("states both halves of the distinction", () => {
    // Undecided → the revenue model is the open question.
    expect(flowed).toContain("the **revenue model** is the open question".toLowerCase());
    // Decided but unbuyable → the buying path is the problem.
    expect(flowed).toContain("the **buying path** is the problem".toLowerCase());
  });

  it("warns against promoting technical gaps by default", () => {
    expect(flowed).toContain("not by default because they are easy to detect");
  });
});

describe("the facts those rules depend on reach the model", () => {
  /**
   * The stage rule is worthless if the model cannot tell what stage this is.
   * CORE-2a.2 made founder intent readable; this asserts it still arrives.
   */
  it.each([
    ["prototype", "early prototype"],
    ["paid_customers", "already paying"],
  ] as const)("carries stage %s as a sentence", (stage, expected) => {
    const rendered = packFor(fakeProductProfile(), fakeFounderIntent({ stage }));
    expect(rendered).toContain(expected);
  });

  it.each([
    ["monetize", "start earning money"],
    ["improve_retention", "get people coming back"],
  ] as const)("carries the goal %s as a sentence", (primaryGoal, expected) => {
    const rendered = packFor(fakeProductProfile(), fakeFounderIntent({ primaryGoal }));
    expect(rendered).toContain(expected);
  });

  /**
   * §69's fixture: the founder HAS decided. The distinction the rubric draws is
   * only reachable if that decision is in the pack.
   */
  it("carries a decided business model, so 'decided but unbuyable' is distinguishable", () => {
    const rendered = packFor(
      fakeProductProfile(),
      fakeFounderIntent({ monetizationModel: "subscription" }),
    );

    expect(rendered).toContain("intend to charge a recurring fee");
    expect(rendered).not.toContain("not decided how the product will make money");
  });

  it("carries an undecided model differently, so the two cases cannot be confused", () => {
    const rendered = packFor(fakeProductProfile(), fakeFounderIntent({ monetizationModel: "none" }));
    expect(rendered).toContain("not decided how the product will make money");
  });

  /**
   * §67: product type shapes interpretation. The category is what tells the
   * model whether it is looking at a portfolio or a marketplace.
   */
  it.each(["portfolio_or_personal_site", "marketplace", "ecommerce_store"] as const)(
    "carries the product category %s",
    (category) => {
      const profile = fakeProductProfile();
      const typed: ProductProfile = {
        ...profile,
        identity: {
          ...profile.identity,
          category: { value: category, confidence: "likely", sources: ["ai_inferred"], evidence: [] },
        },
      };

      expect(packFor(typed, fakeFounderIntent())).toContain(category.replace(/_/g, " "));
    },
  );
});

describe("the system prompt asks for reasoning before conclusions (§16, §37)", () => {
  const prompt = buildSystemPrompt();

  it("embeds the rubric, so the lenses are actually instructed", () => {
    expect(prompt).toContain(BUSINESS_READINESS_RUBRIC);
  });

  it("still forbids proposing actions — diagnosis stays separate from moves (§58)", () => {
    expect(prompt.toLowerCase()).toContain("do not recommend actions");
  });

  /** ADR 0011: the boundary that predates all of this and still holds. */
  it("still puts customer content outside the system prompt", () => {
    expect(prompt).toContain("UNTRUSTED DATA");
    expect(prompt).not.toContain("Solo founders who already launched");
  });
});

/**
 * Anti-priming (CORE-2a.3, after the first refresh was rejected by our own
 * language net).
 *
 * The first attempt cost $0.146 and failed with `customer_language_violation`.
 * The cause was this file's own doing: the nine lenses were written into the
 * rubric as prose headings — **CONVERSION**, **RETENTION**, **ACQUISITION** —
 * which the model read immediately before writing conclusions. That is exactly
 * the priming CORE-2a.2 removed when it deleted the forbidden-phrase list, and
 * it came straight back in at nine times the size.
 *
 * The rule: the model may see the keys as machine identifiers, never as
 * headings, and must be told in the same breath that they are ours.
 */
describe("the rubric does not prime the vocabulary it forbids", () => {
  const rubric = BUSINESS_READINESS_RUBRIC;

  it("does not shout the lens names as prose headings", () => {
    for (const shouted of ["**OFFER**", "**AUDIENCE**", "**CONVERSION**", "**RETENTION**", "**ACQUISITION**", "**SCALABILITY**"]) {
      expect(rubric).not.toContain(shouted);
    }
  });

  it("marks the keys as internal labels rather than words to reuse", () => {
    const flowed = rubric.replace(/\s+/g, " ");
    expect(flowed).toContain("which you use in the `lens` field");
    expect(flowed).toContain("and **nowhere else**");
  });

  /**
   * Naming the trap is worth more than forbidding it: the model is shown the
   * phrase it would otherwise build, and the sentence to write instead.
   */
  it("shows the founder-language replacement for each risky phrase", () => {
    const flowed = rubric.replace(/\s+/g, " ");
    expect(flowed).toContain("your conversion path");
    expect(flowed).toContain("retention capability");
    expect(flowed).toContain("acquisition approach");
    expect(flowed).toContain("people can't get from interested to actually paying you");
  });

  /**
   * Every replacement the rubric teaches must itself survive the net. A rubric
   * that suggests wording the validator then rejects would fail every audit.
   */
  it("suggests only wording that passes the language check", async () => {
    const { findInternalVocabulary } = await import("./customer-language");

    for (const suggestion of [
      "people can't get from interested to actually paying you.",
      "there's not much reason for anyone to come back next week.",
      "Vibe couldn't see how the right people would find you.",
    ]) {
      expect(findInternalVocabulary(suggestion)).toEqual([]);
    }
  });
});
