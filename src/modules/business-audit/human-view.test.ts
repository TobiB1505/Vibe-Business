import { describe, expect, it } from "vitest";
import {
  blindSpotsFrom,
  blockersFrom,
  buildHumanAuditView,
  conclusionFor,
  strengthsFrom,
  withoutInlineEvidenceIds,
} from "./human-view";
import type { BusinessReadinessAudit, DimensionAssessment } from "./schema";

/**
 * The human-first audit reading (CORE-2 §14).
 *
 * The load-bearing test in this file is the one about unassessed dimensions.
 * Everything else is ordering; that one is the difference between "Vibe
 * couldn't see whether people come back" being read as a limit on the analysis
 * or as a verdict on the product.
 */

function dimension(overrides: Partial<DimensionAssessment> = {}): DimensionAssessment {
  return {
    id: "product",
    label: "Product",
    assessmentStatus: "assessable",
    score: 70,
    confidence: "medium",
    summary: "A summary.",
    strengths: [],
    gaps: [],
    unknowns: [],
    evidenceIds: [],
    ...overrides,
  };
}

function audit(dimensions: DimensionAssessment[], overrides: Partial<BusinessReadinessAudit> = {}) {
  const assessed = dimensions.filter(
    (entry) => entry.score !== null && entry.assessmentStatus !== "insufficient_evidence",
  ).length;

  return {
    schemaVersion: "business-readiness-audit.v1",
    auditVersion: "business-audit-v1",
    evidencePackVersion: "business-evidence.v3",
    promptVersion: "p",
    rubricVersion: "r",
    provider: "fake",
    model: "m",
    dimensions,
    overall: {
      score: assessed === 0 ? null : 60,
      assessedDimensions: assessed,
      totalDimensions: dimensions.length,
      insufficientCoverageReason: assessed === 0 ? "Not enough evidence." : null,
    },
    keyFindings: [],
    limitations: [],
    validationNotes: [],
    generatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as BusinessReadinessAudit;
}

describe("what's already working", () => {
  it("collects strengths, strongest dimension first", () => {
    const result = strengthsFrom(
      audit([
        dimension({ id: "monetization", score: 30, strengths: ["Weak but real"] }),
        dimension({ id: "product", score: 90, strengths: ["Clear value"] }),
      ]),
    );

    expect(result.map((entry) => entry.text)).toEqual(["Clear value", "Weak but real"]);
  });

  it("phrases each entry with the question its dimension answers", () => {
    const result = strengthsFrom(audit([dimension({ id: "conversion", strengths: ["Good CTA"] })]));
    expect(result[0]!.question).toBe("Do visitors become customers?");
  });

  it("is empty rather than padded when nothing was established", () => {
    expect(strengthsFrom(audit([dimension()]))).toEqual([]);
  });
});

describe("what's holding you back", () => {
  it("collects gaps, weakest dimension first — the ordering is the prioritization", () => {
    const result = blockersFrom(
      audit([
        dimension({ id: "product", score: 80, gaps: ["Minor wording issue"] }),
        dimension({ id: "monetization", score: 20, gaps: ["No way to pay"] }),
      ]),
    );

    expect(result.map((entry) => entry.text)).toEqual(["No way to pay", "Minor wording issue"]);
  });

  /**
   * CLAUDE.md rule 44 and CORE-2 §11, as a property of the code.
   *
   * An unassessed dimension has no score, so a naive sort would place it first
   * and a founder would read "Vibe could not tell whether people come back" as
   * the single biggest thing holding their business back.
   */
  it("excludes an unassessed dimension entirely, however its gaps are phrased", () => {
    const result = blockersFrom(
      audit([
        dimension({ id: "product", score: 80, gaps: ["Minor wording issue"] }),
        dimension({
          id: "retention",
          score: null,
          assessmentStatus: "insufficient_evidence",
          gaps: ["Nothing observed about returning users"],
        }),
      ]),
    );

    expect(result.map((entry) => entry.text)).toEqual(["Minor wording issue"]);
    expect(JSON.stringify(result)).not.toContain("returning users");
  });

  it("never counts a missing score as zero", () => {
    const result = blockersFrom(
      audit([
        dimension({ id: "retention", score: null, assessmentStatus: "insufficient_evidence", gaps: ["x"] }),
        dimension({ id: "product", score: 10, gaps: ["Real problem"] }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("Real problem");
  });
});

describe("what Vibe could not see", () => {
  it("reports unassessed dimensions as unanswered questions, not as failings", () => {
    const spots = blindSpotsFrom(
      audit([
        dimension({ id: "product", score: 70 }),
        dimension({ id: "retention", score: null, assessmentStatus: "insufficient_evidence" }),
      ]),
    );

    expect(spots.unansweredQuestions).toEqual(["Do people come back?"]);
  });

  it("carries the audit's own limitations through unchanged", () => {
    const spots = blindSpotsFrom(
      audit([dimension()], { limitations: ["No traffic data is available."] }),
    );
    expect(spots.limitations).toEqual(["No traffic data is available."]);
  });
});

describe("the conclusion", () => {
  it("names the strongest and weakest assessed dimensions", () => {
    const text = conclusionFor(
      audit([
        dimension({ id: "product", score: 85 }),
        dimension({ id: "monetization", score: 25 }),
      ]),
    );

    expect(text).toContain("explaining what you built");
    expect(text).toContain("making money from it");
  });

  /**
   * The defect the first dogfood found, and the reason `DIMENSION_TOPICS`
   * exists. Interpolating `DIMENSION_QUESTIONS` produced "Where you're
   * strongest: do people understand what you built? Where you're weakest: can
   * you make money from it?" — a question mark mid-clause, in the single
   * sentence a founder reads first.
   *
   * The old assertion checked for that exact string, so the test enforced the
   * bug. This one checks the property instead: a sentence, not a quiz.
   */
  it("reads as a sentence rather than as interpolated questions", () => {
    const text = conclusionFor(
      audit([
        dimension({ id: "product", score: 85 }),
        dimension({ id: "monetization", score: 25 }),
      ]),
    );

    expect(text).not.toContain("?");
    expect(text.trim()).toMatch(/\.$/);
  });

  it("reads as a sentence when only one dimension was assessed", () => {
    const text = conclusionFor(
      audit([
        dimension({ id: "monetization", score: 25 }),
        dimension({ id: "retention", score: null, assessmentStatus: "insufficient_evidence" }),
      ]),
    );

    expect(text).not.toContain("?");
    expect(text.trim()).toMatch(/\.$/);
  });

  it("says there is not enough evidence rather than manufacturing a verdict", () => {
    const text = conclusionFor(
      audit([dimension({ score: null, assessmentStatus: "insufficient_evidence" })]),
    );

    expect(text).toContain("isn't enough evidence");
  });

  it("does not claim a comparison when only one dimension was assessed", () => {
    const text = conclusionFor(
      audit([
        dimension({ id: "product", score: 70 }),
        dimension({ id: "retention", score: null, assessmentStatus: "insufficient_evidence" }),
      ]),
    );

    expect(text).not.toContain("You're strongest at");
  });
});

describe("buildHumanAuditView", () => {
  it("keeps the score visible rather than hiding it", () => {
    // CORE-2 §14 makes the score secondary, not absent. Hiding a number the
    // product computed would be its own kind of dishonesty.
    const view = buildHumanAuditView(audit([dimension({ score: 70 })]));

    expect(view.score).toBe(60);
    expect(view.assessedDimensions).toBe(1);
    expect(view.totalDimensions).toBe(1);
  });

  /**
   * CORE-2 §18: next moves come from the Opportunity Engine. If this view ever
   * grew a "recommendations" field it would be the second recommendation engine
   * that section forbids.
   */
  it("produces no recommendations of its own", () => {
    const view = buildHumanAuditView(audit([dimension({ score: 40, gaps: ["No pricing"] })]));

    expect(Object.keys(view)).not.toContain("recommendations");
    expect(Object.keys(view)).not.toContain("nextMoves");
    expect(Object.keys(view)).not.toContain("actions");
  });

  it("passes key findings through as the 'why it matters' section", () => {
    const view = buildHumanAuditView(
      audit([dimension()], {
        keyFindings: [{ finding: "Understandable but not monetized.", evidenceIds: ["a"] }],
      }),
    );

    expect(view.whyItMatters).toEqual([
      { finding: "Understandable but not monetized.", evidenceIds: ["a"] },
    ]);
  });
});

/**
 * Model prose that cites its own evidence ids inline (CORE-2 §14).
 *
 * The strings here are verbatim from the first real audit, which is the point:
 * this rule was written against what the model actually produced, not against
 * what it was asked to produce.
 */
describe("inline evidence citations", () => {
  it("strips a trailing id-only parenthetical", () => {
    expect(
      withoutInlineEvidenceIds(
        "Authenticated area reached with Dashboard, Integrations, and Project workspace surfaces present (auth.area.reached, auth.surface.dashboard, auth.surface.integrations, auth.surface.project_workspace)",
      ),
    ).toBe(
      "Authenticated area reached with Dashboard, Integrations, and Project workspace surfaces present",
    );
  });

  it("strips a single id too", () => {
    expect(withoutInlineEvidenceIds("No pricing page exists (live.surface.pricing)")).toBe(
      "No pricing page exists",
    );
  });

  /**
   * Conservative on purpose. A parenthetical containing a real clause is the
   * model saying something, not citing — removing it would delete content.
   */
  it("leaves a parenthetical that is actually prose alone", () => {
    const text = "There is no pricing page (and no payment provider was detected)";
    expect(withoutInlineEvidenceIds(text)).toBe(text);
  });

  it("leaves a sentence with no parenthetical untouched", () => {
    expect(withoutInlineEvidenceIds("Nothing brings a signed-up user back.")).toBe(
      "Nothing brings a signed-up user back.",
    );
  });

  it("does not strip a mid-sentence citation, which would leave broken grammar", () => {
    const text = "The homepage (live.site.title) is clear enough";
    expect(withoutInlineEvidenceIds(text)).toBe(text);
  });

  it("applies to strengths, gaps and key findings alike", () => {
    const view = buildHumanAuditView(
      audit([dimension({ score: 40, strengths: ["A strength (live.site.title)"], gaps: ["A gap (repo.surface.payments)"] })], {
        keyFindings: [{ finding: "A finding (live.surface.pricing)", evidenceIds: ["live.surface.pricing"] }],
      }),
    );

    expect(view.working[0]!.text).toBe("A strength");
    expect(view.blockers[0]!.text).toBe("A gap");
    expect(view.whyItMatters[0]!.finding).toBe("A finding");
    // The ids are not lost — they remain on the item for the "Why?" disclosure.
    expect(view.whyItMatters[0]!.evidenceIds).toEqual(["live.surface.pricing"]);
  });
});
