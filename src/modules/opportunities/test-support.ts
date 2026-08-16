import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import type { WireOpportunity } from "./wire-schema";

/**
 * Fixtures for the Opportunity Engine (Sprint 8 §38, §39).
 *
 * The wire fixture is a *provider-shaped* object, because that is what the
 * pipeline actually receives — testing against the domain shape would skip the
 * normalizer and the validator, which are the two layers that decide whether a
 * billed response is usable.
 */

export function fakeWireOpportunity(overrides: Partial<WireOpportunity> = {}): WireOpportunity {
  return {
    rank: 1,
    title: "Clarify your monetization path",
    problem: "Your product is live and users can sign up, but no pricing or payment path is evidenced.",
    whyNow: "Acquisition has limited value until there is a defined way to capture revenue.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "monetization",
    primaryDimension: "monetization",
    secondaryDimensions: ["conversion"],
    evidenceIds: ["intent.monetization_model", "live.surface.pricing"],
    executionType: "business_decision",
    executionReadiness: "needs_user_input",
    dependencies: [],
    ...overrides,
  };
}

/** The evidence ids the fixtures cite, as a validated pack would expose them. */
export const FAKE_EVIDENCE_IDS = new Set([
  "intent.monetization_model",
  "profile.identity.description",
  "business.stage",
  "live.surface.pricing",
  "live.site.title",
  "live.conversion.primary_cta",
  "repo.surface.payments",
  "repo.analysis.completeness",
  "auth.surface.dashboard",
  "auth.area.reached",
]);

export function fakeAudit(overrides: Partial<BusinessReadinessAudit> = {}): BusinessReadinessAudit {
  return {
    schemaVersion: "business-readiness-audit.v1",
    auditVersion: "business-audit-v1",
    evidencePackVersion: "business-evidence.v2",
    promptVersion: "business-audit-prompt-v2",
    rubricVersion: "business-readiness-rubric-v1",
    provider: "fake",
    model: "claude-sonnet-5",
    dimensions: [
      {
        id: "product",
        label: "Product",
        assessmentStatus: "assessable",
        score: 55,
        confidence: "medium",
        summary: "A working authenticated area exists but the stated value proposition is unclear.",
        strengths: ["Authenticated app area reached"],
        gaps: ["Product description reads as placeholder"],
        unknowns: [],
        evidenceIds: ["auth.area.reached", "profile.identity.description"],
      },
      {
        id: "monetization",
        label: "Monetization",
        assessmentStatus: "assessable",
        score: 10,
        confidence: "high",
        summary: "No monetization model is stated and no pricing or payment path exists.",
        strengths: [],
        gaps: ["No pricing surface", "No payment integration"],
        unknowns: [],
        evidenceIds: ["intent.monetization_model", "live.surface.pricing", "repo.surface.payments"],
      },
      {
        id: "distribution",
        label: "Distribution",
        assessmentStatus: "partial",
        score: 32,
        confidence: "medium",
        summary: "On-page basics exist; structural discoverability does not.",
        strengths: ["Title and meta description present"],
        gaps: ["No sitemap or robots.txt"],
        unknowns: ["No traffic data"],
        evidenceIds: ["live.site.title"],
      },
      {
        id: "conversion",
        label: "Conversion",
        assessmentStatus: "assessable",
        score: 58,
        confidence: "medium",
        summary: "A single clear signup call to action exists.",
        strengths: ["Primary CTA identified"],
        gaps: ["No pricing path"],
        unknowns: [],
        evidenceIds: ["live.conversion.primary_cta"],
      },
      {
        id: "retention",
        label: "Retention",
        assessmentStatus: "partial",
        score: 45,
        confidence: "low",
        summary: "A signed-in area exists but nothing measures whether people return.",
        strengths: ["Authenticated surfaces observed"],
        gaps: ["No analytics instrumentation"],
        unknowns: ["No usage or cohort data"],
        evidenceIds: ["auth.surface.dashboard", "repo.surface.analytics"],
      },
    ],
    overall: { score: 40, assessedDimensions: 5, totalDimensions: 5, insufficientCoverageReason: null },
    keyFindings: [
      {
        finding: "Monetization is a stated non-goal and no revenue infrastructure exists.",
        evidenceIds: ["intent.monetization_model"],
      },
    ],
    limitations: ["No analytics, traffic or revenue data is available."],
    validationNotes: [],
    generatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}
