import { describe, expect, it } from "vitest";
import { SCORE_HISTORY_LIMIT, buildScoreHistory, scoreDeltaFrom } from "./dashboard";

/**
 * The score trend, and the one rule it exists to not break (UI-8).
 *
 * A completed audit that could not be scored stores `overall_score = null`.
 * Every case here is about that value staying out of the series: folded in as
 * `0` it draws a project falling off a cliff and recovering, which is a claim
 * about the business that the evidence never made. CLAUDE.md rule 44.
 *
 * `buildScoreHistory` takes rows newest-first — the order the read model's
 * query returns — and hands back oldest-first, the order a line is drawn in.
 * The inversion is half of what these assert.
 */

function rows(...scores: (number | null)[]) {
  return scores.map((overall_score) => ({ overall_score }));
}

describe("buildScoreHistory", () => {
  it("returns the scores oldest-first from rows given newest-first", () => {
    expect(buildScoreHistory(rows(80, 74, 61))).toEqual([61, 74, 80]);
  });

  it("skips an unscored audit instead of counting it as zero", () => {
    // The whole point. Two real scores either side of an audit that found too
    // little evidence: the line joins them, it does not dive to the axis.
    expect(buildScoreHistory(rows(78, null, 72))).toEqual([72, 78]);
  });

  it("keeps a genuine zero, which is a real score", () => {
    // Absence is what becomes nothing. A measured 0 is a measurement.
    expect(buildScoreHistory(rows(12, 0))).toEqual([0, 12]);
  });

  it("returns nothing when no audit was ever scored", () => {
    expect(buildScoreHistory(rows(null, null))).toEqual([]);
  });

  it("returns one point for one scored audit, and does not pad it", () => {
    expect(buildScoreHistory(rows(72))).toEqual([72]);
  });

  it("returns nothing at all for a project with no audits", () => {
    expect(buildScoreHistory([])).toEqual([]);
  });

  it("caps the series and keeps the newest end of it", () => {
    const many = Array.from({ length: SCORE_HISTORY_LIMIT + 5 }, (_, index) => 100 - index);

    const history = buildScoreHistory(rows(...many));

    expect(history).toHaveLength(SCORE_HISTORY_LIMIT);
    // Newest-first input, so `100` is the latest score and must survive the cap.
    expect(history[history.length - 1]).toBe(100);
  });

  it("counts the limit in scored audits, not in rows read", () => {
    // Unscored rows between them must not consume the budget, or a project
    // with patchy coverage would show a shorter trend than one without.
    const history = buildScoreHistory(rows(90, null, 85, null, 80), 3);

    expect(history).toEqual([80, 85, 90]);
  });
});

describe("scoreDeltaFrom", () => {
  it("is the latest score minus the one before it", () => {
    expect(scoreDeltaFrom([61, 74, 80])).toBe(6);
  });

  it("is negative when the score fell", () => {
    expect(scoreDeltaFrom([80, 74])).toBe(-6);
  });

  it("is zero — not null — when two audits agreed", () => {
    // "Measured twice, unchanged" is a fact. It is not the same fact as
    // "there is nothing to compare against", and the card says each of them
    // differently.
    expect(scoreDeltaFrom([68, 68])).toBe(0);
  });

  it("is null with fewer than two points", () => {
    expect(scoreDeltaFrom([72])).toBeNull();
    expect(scoreDeltaFrom([])).toBeNull();
  });
});
