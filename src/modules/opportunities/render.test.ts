import { describe, expect, it } from "vitest";
import { buildEvidencePackV3 } from "@/modules/business-audit/evidence-v3";
import {
  fakeFounderIntent,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import {
  AUDIT_SYNTHESIS_VERSION,
  BUSINESS_AUDIT_SCHEMA_VERSION,
  BUSINESS_AUDIT_VERSION,
  type BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import { renderOpportunityInput } from "./render";

/**
 * What the Next Moves model is actually shown (CORE-2a.3.2 §33).
 *
 * ## Why this file exists
 *
 * The audit's own ordering defect had a twin here, and it survived because both
 * orderings produce a perfectly valid prompt. `renderAudit` listed the five
 * scored dimensions — with their scores, and their gaps written as undetected
 * surfaces — before the business conclusions, while the comment directly above
 * the conclusions claimed they were "added *above* the dimension detail".
 *
 * The comment described CORE-2a.1's intent. The code did the opposite for two
 * sprints. Nothing failed, because nothing asserted it.
 *
 * These tests assert position, which is unusual and deliberate: the ordering is
 * load-bearing and looks like formatting, so it is exactly the kind of thing a
 * tidy-up would reverse.
 */

function auditWith(overrides: Partial<BusinessReadinessAudit> = {}): BusinessReadinessAudit {
  return {
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    contractVersion: "business-audit-contract-v8",
    evidencePackVersion: "business-evidence.v4",
    promptVersion: "business-audit-prompt-v5",
    rubricVersion: "business-readiness-rubric-v11",
    provider: "anthropic",
    model: "claude-sonnet-5",
    overall: {
      score: 46,
      scoredLenses: 5,
      eligibleLenses: 9,
      insufficientCoverageReason: null,
    },
    synthesis: {
      version: AUDIT_SYNTHESIS_VERSION,
      lenses: [
        {
          lens: "audience",
          health: "weak",
          materiality: "now",
          summary: "The stated audience is too broad to aim at.",
          evidenceIds: ["live.site.title"],
          missingContext: ["Who the first realistic customer segment is meant to be"],
        },
        {
          lens: "business_readiness",
          health: "weak",
          materiality: "later",
          summary: "No terms or privacy policy, but nothing is being sold yet.",
          evidenceIds: ["live.site.title"],
          missingContext: [],
        },
      ],
      overall: "A real product with two open business questions.",
      strengths: [],
      blockers: [
        {
          rootProblem: "The business has not chosen who it is for first.",
          headline: "It's still unclear who your first real customer is.",
          explanation: "The product is aimed broadly and nothing narrows it down.",
          whyItMatters: "It makes every other decision harder to focus.",
          evidenceIds: ["live.site.title"],
          lenses: ["audience"],
          tone: "critical",
          confidence: "high",
        },
      ],
    },
    keyFindings: [],
    limitations: [],
    validationNotes: [],
    generatedAt: "2026-08-16T15:55:18.220Z",
    ...overrides,
  };
}


/**
 * A stored v6/v7 audit as it sits in the database: the dimension payload is a
 * record inside the JSONB, invisible to the v8 domain type and read by the
 * renderer through its legacy guard (ADR 0050).
 */
function legacyAuditWith(overrides: Partial<BusinessReadinessAudit> = {}): BusinessReadinessAudit {
  return {
    ...auditWith(overrides),
    dimensions: [
      {
        id: "monetization",
        score: 10,
        assessmentStatus: "assessable",
        confidence: "high",
        summary: "No pricing is shown and no payment integration exists.",
        strengths: [],
        gaps: ["No pricing surface on the live site", "No checkout/billing surface detected"],
        unknowns: [],
        evidenceIds: ["live.site.title"],
      },
    ],
  } as BusinessReadinessAudit;
}

function render(audit: BusinessReadinessAudit): string {
  return renderOpportunityInput({
    audit,
    pack: buildEvidencePackV3({
      productProfile: fakeProductProfile(),
      founderIntent: fakeFounderIntent(),
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
      authenticatedProduct: null,
    }),
  });
}

describe("judgment reaches the engine before the scanner record", () => {
  // A stored legacy audit — the only kind that still has a technical breakdown.
  const rendered = render(legacyAuditWith());

  it("puts the business conclusions above the technical breakdown", () => {
    expect(rendered.indexOf("What the audit concluded about this business")).toBeGreaterThan(-1);
    expect(rendered.indexOf("What the audit concluded about this business")).toBeLessThan(
      rendered.indexOf("Technical breakdown"),
    );
  });

  it("puts the lens map above the technical breakdown too", () => {
    expect(rendered.indexOf("when it matters")).toBeLessThan(rendered.indexOf("Technical breakdown"));
  });

  /**
   * The specific inversion that was live: a 10/100 dimension score sitting
   * above the conclusion about what actually blocks this founder.
   */
  it("no longer leads with the worst dimension score", () => {
    expect(rendered.indexOf("10/100")).toBeGreaterThan(
      rendered.indexOf("It's still unclear who your first real customer is."),
    );
  });
});

describe("materiality reaches the engine at all (§33)", () => {
  const rendered = render(auditWith());

  /**
   * It did not before. Without it, "no analytics" and "the first customer is
   * undefined" arrived looking equally actionable, because the only ranking
   * signal available was a dimension score.
   */
  it("carries each lens with its health and when it matters", () => {
    expect(rendered).toContain("audience — weak, now");
    expect(rendered).toContain("business_readiness — weak, later");
  });

  it("explains the vocabulary rather than assuming the engine knows it", () => {
    expect(rendered).toContain("`now` blocks the next milestone");
    expect(rendered).toContain("`later` is real but premature");
  });

  /** §30 — a blocked lens is a question to ask, not work to generate. */
  it("carries what only the founder can answer", () => {
    expect(rendered).toContain(
      "Only the founder can answer: Who the first realistic customer segment is meant to be.",
    );
  });

  it("records which lenses each conclusion came from", () => {
    expect(rendered).toContain("(lenses: audience)");
  });
});

describe("nothing was removed to make room (§33, §5)", () => {
  const rendered = render(legacyAuditWith());

  it("still carries a stored audit's dimension scores, findings and citations", () => {
    expect(rendered).toContain("10/100");
    expect(rendered).toContain("No pricing surface on the live site");
    expect(rendered).toContain("Cited: live.site.title");
  });

  it("renders a v8 audit without a technical breakdown, because it has none", () => {
    expect(render(auditWith())).not.toContain("Technical breakdown");
  });

  it("still carries the overall readiness score", () => {
    expect(rendered).toContain("Overall business readiness: 46/100");
  });

  /**
   * Historical audits predate the lens map entirely. They must still render —
   * the engine is not allowed to stop working because an old audit is selected.
   */
  it("renders an audit that has no synthesis at all", () => {
    const rendered = render(legacyAuditWith({ synthesis: null }));

    expect(rendered).toContain("Technical breakdown");
    expect(rendered).toContain("10/100");
    expect(rendered).not.toContain("when it matters");
  });

  it("renders a synthesis that carries no lenses", () => {
    const audit = auditWith();
    const rendered = render({
      ...audit,
      synthesis: { ...audit.synthesis!, lenses: [] },
    });

    expect(rendered).toContain("What the audit concluded about this business");
    expect(rendered).not.toContain("when it matters");
  });
});

describe("the trust boundary is unchanged", () => {
  it("still fences the audit as untrusted model output, not measurement", () => {
    const rendered = render(auditWith());

    expect(rendered).toContain("<audit>");
    expect(rendered).toContain("UNTRUSTED");
    expect(rendered).toContain("<evidence>");
  });
});
