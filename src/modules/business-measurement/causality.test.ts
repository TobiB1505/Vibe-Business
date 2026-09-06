import { describe, expect, it } from "vitest";

import {
  CAUSAL_PHRASES,
  OBSERVED_CHANGE_DISCLAIMER,
  findCausalClaims,
  hasCausalEvidence,
} from "./causality";

/**
 * The guard's own tests, which it did not have.
 *
 * `findCausalClaims` is asserted *through* seventeen other files — Nova's
 * language rules, the measurement panels, the Command Center sweeps — and by
 * none of its own. Every one of those calls it the same way: give it honest
 * copy, expect an empty array. An empty array is also what a broken detector
 * returns, so a false negative in it is invisible from every consumer at once.
 *
 * That is how the sentence-spanning negation survived: the docblock said "a
 * negation within the same clause", the code used a sixty-character lookback,
 * and nothing compared the two.
 */

describe("the product has no causal evidence, and says so in code", () => {
  it("is a function so the day an experiment exists is a compile error", () => {
    expect(hasCausalEvidence()).toBe(false);
  });
});

describe("an unevidenced causal claim is reported", () => {
  it.each([...CAUSAL_PHRASES])("finds %s", (phrase) => {
    expect(findCausalClaims(`The redesign ${phrase} a better week for the business.`)).toContain(
      phrase,
    );
  });

  it("names the phrase rather than returning a boolean", () => {
    expect(findCausalClaims("Signups rose, driven by the new checkout.")).toEqual(["driven by"]);
  });

  it("ignores case and collapsed whitespace", () => {
    expect(findCausalClaims("This\n  change   CAUSED   a rise.")).toEqual(["caused"]);
  });

  it("says nothing about copy that only observes", () => {
    expect(findCausalClaims("Signups were 12% higher during the measurement window.")).toEqual([]);
  });
});

describe("a denial is not a claim", () => {
  /** The sentence the whole module exists to keep sayable. */
  it("lets the disclaimer through", () => {
    expect(findCausalClaims(OBSERVED_CHANGE_DISCLAIMER)).toEqual([]);
  });

  it.each([
    "It does not prove that this change caused the difference.",
    "We cannot say the redesign caused the rise.",
    "There is no evidence that the change caused anything.",
    "There is no evidence of a result attributable to the change.",
  ])("reads %s as a denial", (copy) => {
    expect(findCausalClaims(copy)).toEqual([]);
  });

  /**
   * A comma is deliberately not a clause boundary. The disclaimer's own
   * strongest phrasing puts one between the negation and the verb, and cutting
   * there would flag the sentence that keeps the product honest.
   */
  it("keeps a negation across a comma", () => {
    expect(
      findCausalClaims("It does not, by itself, prove that this change caused the difference."),
    ).toEqual([]);
  });
});

/**
 * The false negative, and the bound that closes it.
 *
 * Each case pairs the sentence that must be reported with the near-identical
 * one that must not, so a fix that simply stopped negating anything would fail
 * the second half.
 */
describe("a negation governs its own clause and no further", () => {
  it("reports a claim whose negation belongs to the previous sentence", () => {
    const copy = "We cannot measure the checkout yet. Pricing caused signups to rise.";

    expect(findCausalClaims(copy)).toEqual(["caused"]);
  });

  it.each([
    ["a full stop", "We cannot measure this yet. The change caused a rise."],
    ["a question mark", "Can we not measure this? The change caused a rise."],
    ["an exclamation", "We cannot measure this! The change caused a rise."],
    ["a semicolon", "We cannot measure this; the change caused a rise."],
    ["a colon", "One thing we cannot do: say the change caused a rise in isolation from"],
  ])("treats %s as the end of the negation's reach", (_label, copy) => {
    expect(findCausalClaims(copy)).toEqual(["caused"]);
  });

  /** The same negation, now in the clause it actually governs. */
  it("still suppresses when the negation is in the phrase's own clause", () => {
    const copy = "We measured the checkout. We cannot say pricing caused signups to rise.";

    expect(findCausalClaims(copy)).toEqual([]);
  });

  /**
   * A decimal is not a sentence. The copy is whitespace-collapsed before this
   * runs, so a real terminator always carries a following space and `9.8` never
   * does — without that rule the negation below would be cut off mid-number and
   * an honest sentence would be reported.
   */
  it("does not mistake a decimal point for a boundary", () => {
    expect(
      findCausalClaims("It does not prove that the 9.8% rise was caused by this change."),
    ).toEqual([]);
  });

  /**
   * The known false positive, asserted rather than left to be discovered. An
   * abbreviation ends in a full stop and a space, so it reads as a boundary and
   * the negation before it stops governing. Left unpatched deliberately: it
   * errs toward reporting, and the cost is rewording one sentence.
   */
  it("does read an abbreviation as a boundary, and that is the safe direction", () => {
    expect(
      findCausalClaims("This does not, e.g. in a seasonal week, prove the change caused it."),
    ).toEqual(["caused"]);
  });
});

/**
 * The reason the window stayed. Removing it in favour of the clause alone would
 * make one unpunctuated line *more* permissive than it is today, which is the
 * wrong direction for a guard.
 */
describe("a distant negation in one long clause does not reach", () => {
  it("still reports a verb sixty characters downstream of a stray negation", () => {
    const copy =
      "there is no pricing page on the site at the moment and the recent redesign of the checkout flow caused signups to rise";

    expect(findCausalClaims(copy)).toEqual(["caused"]);
  });
});

/**
 * One unnegated occurrence is enough. A paragraph that denies causation once
 * and then asserts it is asserting it.
 */
describe("a denial elsewhere does not license a claim", () => {
  it("reports the unnegated occurrence", () => {
    const copy =
      "It does not prove that this change caused the difference. The change caused a 9% rise.";

    expect(findCausalClaims(copy)).toEqual(["caused"]);
  });
});
