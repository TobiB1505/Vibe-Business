import { describe, expect, it } from "vitest";
import { computeOverallScore, minimumScoredLenses } from "./scoring";
import type { BusinessLensAssessment, BusinessLens, LensMateriality } from "./schema";

function lens(
  id: BusinessLens,
  score: number | null,
  materiality: LensMateriality = "now",
): BusinessLensAssessment {
  return {
    lens: id,
    health: score === null ? "unclear" : score >= 70 ? "strong" : score >= 50 ? "adequate" : "weak",
    score,
    materiality,
    summary: "s",
    evidenceIds: score === null ? [] : ["business.product_summary"],
    missingContext: [],
  };
}

describe("computeOverallScore — ADR 0050", () => {
  it("averages scored lenses with equal weighting, five of nine scored", () => {
    const overall = computeOverallScore([
      lens("offer", 80),
      lens("audience", 40),
      lens("revenue_economics", 60),
      lens("acquisition", 60),
      lens("conversion", 60),
      lens("retention", null),
      lens("measurement", null),
      lens("business_readiness", null),
      lens("scalability", null),
    ]);

    expect(overall.score).toBe(60);
    expect(overall.scoredLenses).toBe(5);
    expect(overall.eligibleLenses).toBe(9);
    expect(overall.insufficientCoverageReason).toBeNull();
  });

  it("refuses a headline number below five of nine when everything is material", () => {
    const overall = computeOverallScore([
      lens("offer", 90),
      lens("audience", 90),
      lens("revenue_economics", 90),
      lens("acquisition", 90),
    ]);

    expect(overall.score).toBeNull();
    expect(overall.scoredLenses).toBe(4);
    expect(overall.eligibleLenses).toBe(9);
    expect(overall.insufficientCoverageReason).toContain("4 of 9");
    expect(overall.insufficientCoverageReason).toContain("At least 5");
  });

  it("lowers the threshold when lenses are not material — four of seven suffices", () => {
    // A one-off product: retention and scalability are not_material, so the
    // majority is taken over the seven lenses that can apply.
    const overall = computeOverallScore([
      lens("offer", 70),
      lens("audience", 50),
      lens("revenue_economics", 60),
      lens("acquisition", 60),
      lens("retention", null, "not_material"),
      lens("scalability", null, "not_material"),
    ]);

    expect(overall.eligibleLenses).toBe(7);
    expect(overall.scoredLenses).toBe(4);
    expect(overall.score).toBe(60);
  });

  it("never lets the threshold fall below three, however immaterial the model claims the business is", () => {
    // Seven not_material lenses leave two eligible. ceil(2/2) = 1, and a
    // headline number resting on two scores would imply a completeness the
    // evidence does not have — the floor holds at three.
    const assessments: BusinessLensAssessment[] = [
      lens("offer", 90),
      lens("audience", 90),
      lens("revenue_economics", null, "not_material"),
      lens("acquisition", null, "not_material"),
      lens("conversion", null, "not_material"),
      lens("retention", null, "not_material"),
      lens("measurement", null, "not_material"),
      lens("business_readiness", null, "not_material"),
      lens("scalability", null, "not_material"),
    ];

    expect(minimumScoredLenses(2)).toBe(3);
    const overall = computeOverallScore(assessments);
    expect(overall.score).toBeNull();
    expect(overall.insufficientCoverageReason).toContain("At least 3");
  });

  it("counts a scored not_material lens in the mean, not in the denominator", () => {
    // Materiality must not become a lever on the score: re-labelling a weak
    // lens as immaterial removes it from the *eligibility* count but its
    // validated score still drags the average exactly as far as before.
    const overall = computeOverallScore([
      lens("offer", 80),
      lens("audience", 80),
      lens("revenue_economics", 80),
      lens("acquisition", 80),
      lens("retention", 20, "not_material"),
    ]);

    expect(overall.eligibleLenses).toBe(8);
    expect(overall.scoredLenses).toBe(5);
    // (80*4 + 20) / 5 = 68 — the weak lens is not laundered out.
    expect(overall.score).toBe(68);
  });

  it("treats an absent lens as eligible — silence is not immateriality", () => {
    const overall = computeOverallScore([lens("offer", 90)]);
    expect(overall.eligibleLenses).toBe(9);
  });

  it("treats materiality unknown as eligible", () => {
    const overall = computeOverallScore([
      lens("offer", 60),
      lens("audience", 60, "unknown"),
    ]);
    expect(overall.eligibleLenses).toBe(9);
  });

  it("excludes unscored lenses from the mean, never counting them as zero", () => {
    const overall = computeOverallScore([
      lens("offer", 90),
      lens("audience", 90),
      lens("revenue_economics", 90),
      lens("acquisition", 90),
      lens("conversion", 90),
      lens("retention", null),
    ]);

    expect(overall.score).toBe(90);
  });

  it("rounds the mean", () => {
    const overall = computeOverallScore([
      lens("offer", 61),
      lens("audience", 62),
      lens("revenue_economics", 62),
      lens("acquisition", 62),
      lens("conversion", 62),
    ]);

    expect(overall.score).toBe(62);
  });

  it("treats a legacy assessment without the score field as unscored", () => {
    const legacy = { ...lens("offer", 60) } as BusinessLensAssessment;
    delete legacy.score;

    const overall = computeOverallScore([
      legacy,
      lens("audience", 60),
      lens("revenue_economics", 60),
      lens("acquisition", 60),
      lens("conversion", 60),
      lens("retention", 60),
    ]);

    expect(overall.scoredLenses).toBe(5);
    expect(overall.score).toBe(60);
  });
});
