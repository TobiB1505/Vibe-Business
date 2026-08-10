import { describe, expect, it } from "vitest";
import { computeOverallReadiness, MINIMUM_SCORED_DIMENSIONS } from "./scoring";
import { AUDIT_DIMENSIONS, DIMENSION_LABELS, type AuditDimensionId, type DimensionAssessment } from "./schema";

function dimension(id: AuditDimensionId, score: number | null): DimensionAssessment {
  return {
    id,
    label: DIMENSION_LABELS[id],
    assessmentStatus: score === null ? "insufficient_evidence" : "assessable",
    score,
    confidence: "medium",
    summary: "s",
    strengths: [],
    gaps: [],
    unknowns: [],
    evidenceIds: score === null ? [] : ["business.product_summary"],
  };
}

describe("computeOverallReadiness", () => {
  it("averages scored dimensions with equal weighting", () => {
    const overall = computeOverallReadiness([
      dimension("product", 80),
      dimension("monetization", 40),
      dimension("distribution", 60),
      dimension("conversion", 60),
      dimension("retention", 60),
    ]);

    expect(overall.score).toBe(60);
    expect(overall.assessedDimensions).toBe(5);
    expect(overall.totalDimensions).toBe(5);
    expect(overall.insufficientCoverageReason).toBeNull();
  });

  it("excludes unscored dimensions instead of counting them as zero", () => {
    // The core "unknown is not bad" rule (Sprint 4 §6). Counting the two
    // nulls as 0 would give 48 instead of 80 — punishing the product for
    // the limits of our own evidence gathering.
    const overall = computeOverallReadiness([
      dimension("product", 80),
      dimension("monetization", 80),
      dimension("distribution", 80),
      dimension("conversion", null),
      dimension("retention", null),
    ]);

    expect(overall.score).toBe(80);
    expect(overall.assessedDimensions).toBe(3);
    expect(overall.totalDimensions).toBe(5);
  });

  it("reports coverage so a partial audit cannot look complete", () => {
    const overall = computeOverallReadiness([
      dimension("product", 70),
      dimension("monetization", 50),
      dimension("distribution", null),
      dimension("conversion", 60),
      dimension("retention", null),
    ]);

    expect(overall.assessedDimensions).toBe(3);
    expect(overall.totalDimensions).toBe(5);
    expect(overall.score).toBe(60);
  });

  it("returns a null overall score below the minimum coverage threshold", () => {
    const overall = computeOverallReadiness([
      dimension("product", 90),
      dimension("monetization", 90),
      dimension("distribution", null),
      dimension("conversion", null),
      dimension("retention", null),
    ]);

    expect(overall.score).toBeNull();
    expect(overall.assessedDimensions).toBe(2);
    expect(overall.insufficientCoverageReason).toContain(`At least ${MINIMUM_SCORED_DIMENSIONS}`);
  });

  it("returns null when nothing could be scored", () => {
    const overall = computeOverallReadiness(AUDIT_DIMENSIONS.map((id) => dimension(id, null)));
    expect(overall.score).toBeNull();
    expect(overall.assessedDimensions).toBe(0);
  });

  it("scores exactly at the coverage threshold", () => {
    const overall = computeOverallReadiness([
      dimension("product", 50),
      dimension("monetization", 60),
      dimension("distribution", 70),
      dimension("conversion", null),
      dimension("retention", null),
    ]);
    expect(overall.score).toBe(60);
  });

  it("rounds to a whole number", () => {
    const overall = computeOverallReadiness([
      dimension("product", 70),
      dimension("monetization", 71),
      dimension("distribution", 72),
      dimension("conversion", null),
      dimension("retention", null),
    ]);
    expect(overall.score).toBe(71);
  });

  it("handles a genuine zero distinctly from a null", () => {
    // 0 means "the evidence positively indicates absence" and must count;
    // null means "we could not tell" and must not.
    const withZero = computeOverallReadiness([
      dimension("product", 90),
      dimension("monetization", 0),
      dimension("distribution", 90),
      dimension("conversion", null),
      dimension("retention", null),
    ]);
    expect(withZero.score).toBe(60);
    expect(withZero.assessedDimensions).toBe(3);
  });
});
