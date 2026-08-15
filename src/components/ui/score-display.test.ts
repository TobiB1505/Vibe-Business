import { describe, expect, it } from "vitest";
import { scoreDisplay } from "./score-display";

/**
 * The one invariant worth a test at this layer: a missing score and a zero
 * score must not look the same. Everything else here is arithmetic.
 */
describe("scoreDisplay", () => {
  it("renders an absent score as n/a with an empty track, not as zero", () => {
    for (const absent of [null, undefined, Number.NaN]) {
      const display = scoreDisplay(absent);
      expect(display.unscored).toBe(true);
      expect(display.text).toBe("n/a");
      expect(display.fillPercent).toBe(0);
      expect(display.tone).toBe("unscored");
    }
  });

  it("keeps a real zero a real zero", () => {
    const display = scoreDisplay(0);
    expect(display.unscored).toBe(false);
    expect(display.text).toBe("0");
    expect(display.fillPercent).toBe(0);
    // A measured zero is a weak score, which is a different statement from
    // "not measurable" — and it is the statement the evidence supports.
    expect(display.tone).toBe("weak");
  });

  it("fills the track in proportion to the maximum", () => {
    expect(scoreDisplay(54).fillPercent).toBe(54);
    expect(scoreDisplay(3, { max: 4 }).fillPercent).toBe(75);
  });

  it("clamps out-of-range values instead of overflowing the track", () => {
    expect(scoreDisplay(140).fillPercent).toBe(100);
    expect(scoreDisplay(-20).fillPercent).toBe(0);
  });

  it("prints the value it was given, not the clamped one", () => {
    // The meter is a summary; the number is the fact. Silently rewriting an
    // out-of-range score would hide a domain bug rather than surface it.
    expect(scoreDisplay(140).text).toBe("140");
  });

  it("bands scores into tones", () => {
    expect(scoreDisplay(72).tone).toBe("strong");
    expect(scoreDisplay(41).tone).toBe("partial");
    expect(scoreDisplay(18).tone).toBe("weak");
  });

  it("lets the caller name what absence means in its own screen", () => {
    expect(scoreDisplay(null, { unscoredText: "not scored" }).text).toBe("not scored");
  });
});
