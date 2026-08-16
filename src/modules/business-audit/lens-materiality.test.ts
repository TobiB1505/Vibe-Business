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

/**
 * The calibration rules (CORE-2a.3.1 §7, §8, §14–§18).
 *
 * These assert the rubric *states* each rule. That is a weaker claim than "the
 * model follows it", and deliberately so — the sprint's acceptance criterion is
 * the real audit, not this file. What a test can guarantee is that a rule we
 * believe we shipped is actually in the instructions, rather than in a sprint
 * document nobody sends to the model. The first nine-lens dogfood failed on
 * ordering while every rule about ordering was, in fact, absent from the rubric.
 */
describe("the rubric separates how bad something is from when it matters", () => {
  const flowed = BUSINESS_READINESS_RUBRIC.toLowerCase().replace(/\s+/g, " ");

  it("states the rule as a headline the model cannot miss", () => {
    expect(flowed).toContain("a weak area is not automatically an urgent area");
    expect(flowed).toContain("low health does not imply high materiality");
  });

  it("names both directions, so the rule is not read as 'weak means later'", () => {
    // Weak but not urgent.
    expect(flowed).toContain("`weak` and `later` at the same time");
    // Healthy but urgent — the audience case from the real dogfood.
    expect(flowed).toContain("`adequate` and `now`");
  });

  it("tells the model to say severity in health rather than in materiality", () => {
    expect(flowed).toContain("if you find yourself raising materiality because something is bad");
  });

  it("gives `weak` a meaning, so severity has somewhere to go", () => {
    expect(flowed).toContain("use `weak` when something is genuinely poor");
    expect(flowed).toContain("do not reach for `unclear` to soften it");
  });

  /** §7 — the question that replaces "what is missing from this business?". */
  it("states the milestone rule", () => {
    expect(flowed).toContain(
      "what currently prevents this founder from reaching their next meaningful business milestone",
    );
    expect(flowed).toContain("everything is missing from every early business");
  });

  /** §8 — with the prerequisite absent, the downstream work is premature. */
  it("states the prematurity rule and its examples", () => {
    expect(flowed).toContain("do not prioritize downstream work before the stage it belongs to");
    expect(flowed).toContain("no meaningful traffic → detailed funnel measurement is premature");
    expect(flowed).toContain("no decided revenue model → billing operations are premature");
  });

  /** §9 — reasoning, not a stage-to-priority lookup table. */
  it("forbids the static stage matrix it would be easy to build instead", () => {
    expect(flowed).toContain("never from a stage-to-priority table");
    expect(flowed).toContain("regulated fintech prototype");
  });
});

describe("the rubric calibrates the lenses that were miscalibrated (§14–§18)", () => {
  const flowed = BUSINESS_READINESS_RUBRIC.toLowerCase().replace(/\s+/g, " ");

  /** §14 — the lens that displaced two real business problems. */
  it("stops readiness becoming material merely because items are absent", () => {
    expect(flowed).toContain("do not make this material just because several expected items are absent");
    // And the counterweight, in the same paragraph, so it cannot be read as
    // "legal never matters".
    expect(flowed).toContain("the identical gap can be `now`");
    expect(flowed).toContain("same gap, different materiality");
  });

  /** §15 — measuring noise is not a top-three problem. */
  it("ties measurement to there being something worth measuring", () => {
    expect(flowed).toContain("whether there is yet anything meaningful to measure");
    expect(flowed).toContain("never treat having analytics installed as a proxy for business maturity");
  });

  /** §16 — a one-off product is not failing at retention. */
  it("ties retention to the business model rather than the calendar", () => {
    expect(flowed).toContain("depends on the business model, not on the calendar");
  });

  /** §17 — cuts both ways, which is the part usually lost. */
  it("keeps acquisition able to be the binding constraint", () => {
    expect(flowed).toContain("do not reflexively downgrade this just because a founder is early");
    expect(flowed).toContain("the audience question comes first");
  });

  /** §18 — the lens that must not collapse back to a pricing page. */
  it("pushes revenue past pricing surfaces into economics", () => {
    expect(flowed).toContain("this is not a question about pricing pages");
    expect(flowed).toContain("what it costs to deliver each use");
    expect(flowed).toContain("has an economics question even before it has a price");
  });
});

describe("the rubric raises conclusions above the evidence under them (§19–§24)", () => {
  const flowed = BUSINESS_READINESS_RUBRIC.toLowerCase().replace(/\s+/g, " ");

  it("names the three layers and forbids mixing them", () => {
    expect(flowed).toContain("business conclusion, then the evidence for it");
    expect(flowed).toContain("what did the scanner fail to find");
  });

  /** The real rejected explanation, shown next to what it should have said. */
  it("shows the enumeration it is replacing, and the replacement", () => {
    expect(flowed).toContain("that is three findings, and the founder has to work out what they mean");
    expect(flowed).toContain("how usage turns into a price");
  });

  /** §22, §49 — context decides, so this never becomes a ban. */
  it("keeps a missing surface able to be the business problem itself", () => {
    expect(flowed).toContain("unless the absence itself is genuinely the business problem");
    expect(flowed).toContain("customers literally cannot complete a purchase");
  });

  /** §23, §24 — one root economic blocker rather than three symptoms. */
  it("asks whether several lenses describe one problem", () => {
    expect(flowed).toContain("are these separate problems, or symptoms of the same root business issue");
    expect(flowed).toContain("the economics of this business are not defined yet");
    // And the guard against over-merging, in the same section.
    expect(flowed).toContain("relatedness is not sameness");
  });

  /** §25 — selection follows materiality, and the model checks its own work. */
  it("tells the model to select for materiality and then verify it did", () => {
    expect(flowed).toContain("select for materiality, not for severity");
    expect(flowed).toContain("is any lens you marked `now` missing from all three blockers");
  });

  /** §36 — a `later` gap has to survive to rise in a future audit. */
  it("promises the deprioritized problems are kept rather than discarded", () => {
    expect(flowed).toContain("it will rise on its own once the problems ahead of it are solved");
  });
});

/**
 * The unification rules (CORE-2a.3.2 §13, §14, §17, §22).
 *
 * The prompt and schema carry the structural half of this sprint; these assert
 * the instructional half is actually present, for the same reason as above —
 * the v4 dogfood failed on ordering while every rule about ordering was missing
 * from the rubric it was supposedly following.
 */
describe("the rubric keeps conclusions above the scanner record (§13, §14)", () => {
  const flowed = BUSINESS_READINESS_RUBRIC.toLowerCase().replace(/\s+/g, " ");

  it("states which half of the rubric is the audit", () => {
    expect(flowed).toContain("the business reasoning is the audit");
    expect(flowed).toContain("the five scored dimensions are the technical record");
  });

  it("forbids building a conclusion out of a dimension's gaps", () => {
    expect(flowed).toContain("never build a conclusion out of a dimension's gaps");
    expect(flowed).toContain("a gap says what a scanner did not detect");
  });

  /** §12, §13 — the abstraction step gets its own field and its own moment. */
  it("asks for the root problem before the founder-facing sentence", () => {
    expect(flowed).toContain("name the root problem before you write to the founder");
    expect(flowed).toContain("not: \"pricing and payment are missing.\" that is the evidence again");
  });

  it("says what to do when a root problem cannot be stated without absences", () => {
    expect(flowed).toContain("you are probably looking at a symptom");
  });
});

describe("the rubric gives materiality real ordering semantics (§8, §9)", () => {
  const flowed = BUSINESS_READINESS_RUBRIC.toLowerCase().replace(/\s+/g, " ");

  it("says ordering follows materiality, not only membership", () => {
    expect(flowed).toContain("ordering follows materiality too, not just membership");
    expect(flowed).toContain("do not quietly reverse that when writing the list");
  });

  /** An override stays possible — this sprint constrains it, not bans it. */
  it("permits an override but requires the reason to be recorded", () => {
    expect(flowed).toContain("only for a reason you can state, and you must state it");
    expect(flowed).toContain("immediate financial, legal or security exposure");
  });

  /** §22 — the specific reasoning that produced the v4 ordering defect. */
  it("rules out severity and evidence volume as reasons", () => {
    expect(flowed).toContain('"it scores worse" and "there is more evidence for it" are not reasons');
    expect(flowed).toContain("how easy something was to detect");
  });
});

describe("the prompt orders the work before the model starts (§24)", () => {
  const prompt = buildSystemPrompt();
  const flowed = prompt.toLowerCase().replace(/\s+/g, " ");

  it("asks for the lenses first and the dimensions last", () => {
    expect(flowed).toContain("assess the nine business lenses. this is where the thinking happens");
    expect(flowed).toContain("only then record the technical breakdown");
  });

  it("explains why the order matters rather than just asserting it", () => {
    expect(flowed).toContain(
      "puts a list of undetected surfaces in front of you at the exact moment you should be naming a business problem",
    );
  });

  it("forbids a conclusion that paraphrases a dimension's gaps", () => {
    expect(flowed).toContain("never let a conclusion be a paraphrase of a dimension's gaps");
    expect(flowed).toContain("you have written the evidence instead of the judgment");
  });
});
