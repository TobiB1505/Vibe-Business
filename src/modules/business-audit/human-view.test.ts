import { describe, expect, it } from "vitest";
import {
  auditScoresComparable,
  blindSpotsFrom,
  blockersFrom,
  buildHumanAuditView,
  conclusionFor,
  MAX_ITEMS_PER_GROUP,
  MAX_PRIMARY_GROUPS,
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

/** Every finding across both halves of a section, in display order. */
function texts(section: { primary: { items: { text: string }[] }[]; secondary: { items: { text: string }[] }[] }) {
  return [...section.primary, ...section.secondary].flatMap((group) =>
    group.items.map((item) => item.text),
  );
}

describe("what's already working", () => {
  it("groups by dimension, strongest first", () => {
    const section = strengthsFrom(
      audit([
        dimension({ id: "monetization", score: 30, strengths: ["Weak but real"] }),
        dimension({ id: "product", score: 90, strengths: ["Clear value"] }),
      ]),
    );

    expect(section.primary.map((group) => group.dimension)).toEqual(["product", "monetization"]);
    expect(section.primary[0]!.items.map((item) => item.text)).toEqual(["Clear value"]);
  });

  it("states each dimension's question once, on the group", () => {
    const section = strengthsFrom(audit([dimension({ id: "conversion", strengths: ["a", "b"] })]));

    expect(section.primary[0]!.question).toBe("Do visitors become customers?");
    // The question lives on the group, not on every item — the repetition the
    // first dogfood showed is structurally impossible now.
    expect(Object.keys(section.primary[0]!.items[0]!)).toEqual(["text", "evidenceIds"]);
  });

  it("is empty rather than padded when nothing was established", () => {
    const section = strengthsFrom(audit([dimension()]));
    expect(section.primary).toEqual([]);
    expect(section.totalItems).toBe(0);
  });
});

/**
 * The volume defect the first dogfood showed.
 *
 * The real audit produced 10 strengths and 15 gaps across five dimensions — and
 * that is not a v3 regression: the v1 audit produced exactly the same 10 and 15.
 * What made it read as a scan report was flattening all 25 into two lists.
 */
describe("bounding what a founder meets first", () => {
  const wide = audit([
    dimension({ id: "monetization", score: 10, gaps: ["m1", "m2", "m3", "m4"] }),
    dimension({ id: "distribution", score: 38, gaps: ["d1", "d2", "d3"] }),
    dimension({ id: "retention", score: 45, gaps: ["r1", "r2"] }),
    dimension({ id: "conversion", score: 55, gaps: ["c1", "c2", "c3"] }),
    dimension({ id: "product", score: 68, gaps: ["p1", "p2", "p3"] }),
  ]);

  it("shows at most two dimension groups by default", () => {
    expect(blockersFrom(wide).primary).toHaveLength(MAX_PRIMARY_GROUPS);
  });

  it("shows at most three findings per group", () => {
    for (const group of blockersFrom(wide).primary) {
      expect(group.items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_GROUP);
    }
  });

  it("leads with the weakest dimensions", () => {
    expect(blockersFrom(wide).primary.map((group) => group.dimension)).toEqual([
      "monetization",
      "distribution",
    ]);
  });

  /**
   * The property that makes the cap honest: it changes what is met first, never
   * what Vibe is willing to show.
   */
  it("discards nothing — every finding is still reachable", () => {
    const section = blockersFrom(wide);
    const all = texts(section);

    expect(section.totalItems).toBe(15);
    expect(all).toHaveLength(15);
    expect(new Set(all).size).toBe(15);
  });

  it("keeps a truncated group's remainder rather than dropping it", () => {
    const section = blockersFrom(wide);

    // monetization has four gaps; three are primary, the fourth must survive.
    expect(section.primary[0]!.items.map((item) => item.text)).toEqual(["m1", "m2", "m3"]);
    expect(texts(section)).toContain("m4");
  });
});

describe("what's holding you back", () => {
  it("groups gaps weakest dimension first — the ordering is the prioritization", () => {
    const section = blockersFrom(
      audit([
        dimension({ id: "product", score: 80, gaps: ["Minor wording issue"] }),
        dimension({ id: "monetization", score: 20, gaps: ["No way to pay"] }),
      ]),
    );

    expect(texts(section)).toEqual(["No way to pay", "Minor wording issue"]);
  });

  /**
   * CLAUDE.md rule 44 and CORE-2 §11, as a property of the code.
   *
   * An unassessed dimension has no score, so a naive sort would place it first
   * and a founder would read "Vibe could not tell whether people come back" as
   * the single biggest thing holding their business back.
   */
  it("excludes an unassessed dimension entirely, however its gaps are phrased", () => {
    const section = blockersFrom(
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

    expect(texts(section)).toEqual(["Minor wording issue"]);
    expect(JSON.stringify(section)).not.toContain("returning users");
  });

  it("never counts a missing score as zero", () => {
    const section = blockersFrom(
      audit([
        dimension({ id: "retention", score: null, assessmentStatus: "insufficient_evidence", gaps: ["x"] }),
        dimension({ id: "product", score: 10, gaps: ["Real problem"] }),
      ]),
    );

    expect(texts(section)).toEqual(["Real problem"]);
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

    expect(view.working.primary[0]!.items[0]!.text).toBe("A strength");
    expect(view.blockers.primary[0]!.items[0]!.text).toBe("A gap");
    expect(view.whyItMatters[0]!.finding).toBe("A finding");
    // The ids are not lost — they remain on the item for the "Why?" disclosure.
    expect(view.whyItMatters[0]!.evidenceIds).toEqual(["live.surface.pricing"]);
  });
});

/**
 * Score comparability (CORE-2a.2 §30).
 *
 * Vibe Business scored 39, then 43, then 45 across two days while the rubric
 * changed twice. The business did not improve by six points.
 */
describe("auditScoresComparable", () => {
  it("compares two audits from the same contract", () => {
    expect(
      auditScoresComparable({ contractVersion: "v2" }, { contractVersion: "v2" }),
    ).toBe(true);
  });

  it("refuses to compare across a contract change", () => {
    expect(
      auditScoresComparable({ contractVersion: "v1" }, { contractVersion: "v2" }),
    ).toBe(false);
  });

  /** Absence is not a match: nothing establishes that two unversioned audits agree. */
  it.each([
    [undefined, undefined],
    [undefined, "v2"],
    ["v2", undefined],
  ])("refuses when a contract version is missing (%p, %p)", (left, right) => {
    expect(
      auditScoresComparable({ contractVersion: left }, { contractVersion: right }),
    ).toBe(false);
  });
});
