import { describe, expect, it } from "vitest";
import type { AuditReading } from "./dashboard";
import { buildScoreSeries, type AuditContract } from "./score-series";

/**
 * What a Business Signal trend is allowed to claim (CORE-6).
 *
 * Every test here is one shape of the same rule: the chart may draw what was
 * measured under one unchanged audit contract, and may not draw a line across
 * anything else. That rule is one `points.flat()` away from being lost by
 * someone making the sparkline look smoother.
 */

const CONTRACT: AuditContract = {
  schemaVersion: "1",
  auditVersion: "audit-v3",
  evidencePackVersion: "pack-v2",
  promptVersion: "prompt-v4",
  rubricVersion: "rubric-v2",
  provider: "anthropic",
  model: "claude-opus-5",
};

function reading(
  score: number | null,
  recordedAt: string,
  contract: Partial<AuditContract> = {},
): AuditReading {
  return { score, recordedAt, contract: { ...CONTRACT, ...contract } };
}

describe("a series is only as long as the contract behind it", () => {
  it("joins readings produced under the same seven versions", () => {
    const series = buildScoreSeries([
      reading(39, "2026-08-01T00:00:00Z"),
      reading(43, "2026-08-02T00:00:00Z"),
      reading(45, "2026-08-03T00:00:00Z"),
    ]);

    expect(series.segments).toHaveLength(1);
    expect(series.segments[0].points.map((point) => point.score)).toEqual([39, 43, 45]);
    expect(series.breakCount).toBe(0);
  });

  /**
   * The measured case this module was written for: 39, 43, 45 in two days,
   * with two rubric bumps in between. One line through those three points
   * would say the business improved by six. It did not; the ruler changed.
   */
  it("breaks the line where the rubric changed rather than joining across it", () => {
    const series = buildScoreSeries([
      reading(39, "2026-08-01T00:00:00Z", { rubricVersion: "rubric-v1" }),
      reading(43, "2026-08-02T00:00:00Z", { rubricVersion: "rubric-v2" }),
      reading(45, "2026-08-03T00:00:00Z", { rubricVersion: "rubric-v3" }),
    ]);

    expect(series.segments.map((segment) => segment.points.map((point) => point.score))).toEqual([
      [39],
      [43],
      [45],
    ]);
    expect(series.breakCount).toBe(2);
  });

  it.each([
    ["schemaVersion", { schemaVersion: "2" }],
    ["auditVersion", { auditVersion: "audit-v4" }],
    ["evidencePackVersion", { evidencePackVersion: "pack-v3" }],
    ["promptVersion", { promptVersion: "prompt-v5" }],
    ["rubricVersion", { rubricVersion: "rubric-v3" }],
    ["provider", { provider: "someone-else" }],
    ["model", { model: "claude-sonnet-5" }],
  ])("treats a change of %s as a break, not a difference of degree", (_field, changed) => {
    const series = buildScoreSeries([
      reading(50, "2026-08-01T00:00:00Z"),
      reading(60, "2026-08-02T00:00:00Z", changed),
    ]);

    expect(series.breakCount).toBe(1);
    expect(series.delta).toBeNull();
  });

  it("reconnects when a later audit returns to an earlier contract's versions", () => {
    // Not a hypothetical: a prompt can be rolled back. Comparability is a
    // property of the versions, not of position in the list.
    const series = buildScoreSeries([
      reading(50, "2026-08-01T00:00:00Z"),
      reading(55, "2026-08-02T00:00:00Z", { promptVersion: "prompt-v5" }),
      reading(58, "2026-08-03T00:00:00Z"),
      reading(61, "2026-08-04T00:00:00Z"),
    ]);

    expect(series.segments.map((segment) => segment.points.length)).toEqual([1, 1, 2]);
    expect(series.delta).toBe(3);
  });
});

describe("an unscored audit is a gap, never a zero", () => {
  /**
   * Rule 44. A completed audit with too little coverage stores a null
   * `overall_score` deliberately: "we looked and could not say". Plotting that
   * at the bottom of the axis would be the chart inventing the worst possible
   * reading of someone's business.
   */
  it("keeps the reading, with no number attached", () => {
    const series = buildScoreSeries([
      reading(70, "2026-08-01T00:00:00Z"),
      reading(null, "2026-08-02T00:00:00Z"),
      reading(72, "2026-08-03T00:00:00Z"),
    ]);

    expect(series.segments).toHaveLength(1);
    expect(series.segments[0].points.map((point) => point.score)).toEqual([70, null, 72]);
    expect(series.segments[0].points.map((point) => point.score)).not.toContain(0);
  });

  it("reports no latest score when the newest audit could not be scored", () => {
    const series = buildScoreSeries([
      reading(70, "2026-08-01T00:00:00Z"),
      reading(null, "2026-08-02T00:00:00Z"),
    ]);

    expect(series.latest).toBeNull();
    expect(series.delta).toBeNull();
  });
});

describe("a delta needs two comparable readings", () => {
  it("subtracts the previous reading when both are scored under one contract", () => {
    const series = buildScoreSeries([
      reading(61, "2026-08-01T00:00:00Z"),
      reading(68, "2026-08-02T00:00:00Z"),
    ]);

    expect(series.delta).toBe(7);
    expect(series.latest).toBe(68);
  });

  it("reports nothing for a single reading", () => {
    const series = buildScoreSeries([reading(61, "2026-08-01T00:00:00Z")]);

    expect(series.delta).toBeNull();
    expect(series.latest).toBe(61);
    expect(series.readingCount).toBe(1);
  });

  it("does not reach past a gap for a pair", () => {
    // 70 and 72 are comparable with each other, but 72's predecessor is the
    // unscored audit. "+2 since the reading before last" is not a sentence
    // anyone asked for, and it is not the one the chart would appear to make.
    const series = buildScoreSeries([
      reading(70, "2026-08-01T00:00:00Z"),
      reading(null, "2026-08-02T00:00:00Z"),
      reading(72, "2026-08-03T00:00:00Z"),
    ]);

    expect(series.delta).toBeNull();
  });

  it("does not reach across a break for a pair", () => {
    const series = buildScoreSeries([
      reading(39, "2026-08-01T00:00:00Z", { rubricVersion: "rubric-v1" }),
      reading(45, "2026-08-02T00:00:00Z"),
    ]);

    expect(series.latest).toBe(45);
    expect(series.delta).toBeNull();
  });
});

describe("the input is not trusted to be ordered", () => {
  /**
   * The dashboard reads audits newest-first across every project, so the rows
   * for one product arrive reversed. A builder that trusted the caller would
   * draw every trend backwards and still pass a test written the same way.
   */
  it("sorts chronologically before deciding anything", () => {
    const series = buildScoreSeries([
      reading(45, "2026-08-03T00:00:00Z"),
      reading(43, "2026-08-02T00:00:00Z"),
      reading(39, "2026-08-01T00:00:00Z"),
    ]);

    expect(series.segments[0].points.map((point) => point.score)).toEqual([39, 43, 45]);
    expect(series.latest).toBe(45);
    expect(series.delta).toBe(2);
  });

  it("returns an empty series for a product that has never been audited", () => {
    const series = buildScoreSeries([]);

    expect(series.segments).toEqual([]);
    expect(series.latest).toBeNull();
    expect(series.delta).toBeNull();
    expect(series.readingCount).toBe(0);
    expect(series.breakCount).toBe(0);
  });
});
