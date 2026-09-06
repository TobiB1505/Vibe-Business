import { describe, expect, it } from "vitest";

import { strongestAreas } from "./business-brain-view";

/**
 * What is working, taken rather than re-decided.
 *
 * The helper exists so no component reaches into the audit document to answer
 * this, which is how two surfaces come to disagree about what one audit said.
 * Its rules are small and all of them are about restraint.
 */

function strength(headline: string, whyItMatters: string | null = null) {
  return { headline, whyItMatters };
}

describe("the strongest areas", () => {
  it("has nothing to say without a synthesis", () => {
    expect(strongestAreas(null)).toEqual([]);
  });

  it("says nothing rather than something when the audit found no strengths", () => {
    expect(strongestAreas({ strengths: [] })).toEqual([]);
  });

  /**
   * The list arrives ordered by the model that wrote it. Re-ranking here would
   * be a second judgement about something already judged — and the two would
   * disagree the moment either changed.
   */
  it("preserves the order the audit gave them", () => {
    const result = strongestAreas({
      strengths: [strength("Offer is clear"), strength("Signup is short")],
    });

    expect(result.map((entry) => entry.headline)).toEqual(["Offer is clear", "Signup is short"]);
  });

  it("stops at two by default, and takes a different bound when asked", () => {
    const strengths = [strength("One"), strength("Two"), strength("Three")];

    expect(strongestAreas({ strengths })).toHaveLength(2);
    expect(strongestAreas({ strengths }, 3)).toHaveLength(3);
  });

  /** A strength with no sentence is a card with an empty line where its point goes. */
  it.each(["", "   ", "\n"])("skips a blank headline (%j)", (headline) => {
    const result = strongestAreas({ strengths: [strength(headline), strength("Real one")] });

    expect(result.map((entry) => entry.headline)).toEqual(["Real one"]);
  });

  /**
   * `whyItMatters` is usually absent on a strength — a strength needing a
   * paragraph of justification is usually not one — and an absent reason is
   * carried as null rather than filled in.
   */
  it("carries an absent reason as absent", () => {
    expect(strongestAreas({ strengths: [strength("Offer is clear")] })).toEqual([
      { headline: "Offer is clear", whyItMatters: null },
    ]);
  });

  it("keeps the reason when the audit gave one", () => {
    const result = strongestAreas({
      strengths: [strength("Offer is clear", "Visitors know what they get")],
    });

    expect(result[0].whyItMatters).toBe("Visitors know what they get");
  });
});
