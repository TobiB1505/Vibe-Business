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
    sourceConclusionKey: "blocker-1",
    title: "Clarify your monetization path",
    problem: "Your product is live and users can sign up, but no pricing or payment path is evidenced.",
    whyNow: "Acquisition has limited value until there is a defined way to capture revenue.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "monetization",
    primaryDimension: "monetization",
    secondaryDimensions: ["conversion"],
    evidenceIds: ["intent.how_it_earns", "live.surface_absent.pricing"],
    executionType: "business_decision",
    executionReadiness: "needs_user_input",
    dependencies: [],
    ...overrides,
  };
}

/** The evidence ids the fixtures cite, as a validated pack would expose them. */
export const FAKE_EVIDENCE_IDS = new Set([
  "intent.how_it_earns",
  "profile.identity.description",
  "business.stage",
  "live.surface_absent.pricing",
  "live.site.title",
  "live.conversion.primary_cta",
  "repo.surface.payments",
  "repo.analysis.completeness",
  "auth.surface.dashboard",
  "auth.area.reached",
]);

export function fakeAudit(overrides: Partial<BusinessReadinessAudit> = {}): BusinessReadinessAudit {
  return {
    schemaVersion: "business-readiness-audit.v2",
    auditVersion: "business-audit-v3",
    contractVersion: "business-audit-contract-v8",
    evidencePackVersion: "business-evidence.v4",
    promptVersion: "business-audit-prompt-v5",
    rubricVersion: "business-readiness-rubric-v11",
    provider: "fake",
    model: "claude-sonnet-5",
    overall: { score: 40, scoredLenses: 5, eligibleLenses: 9, insufficientCoverageReason: null },
    keyFindings: [
      {
        finding: "Monetization is a stated non-goal and no revenue infrastructure exists.",
        evidenceIds: ["intent.monetization_model"],
      },
    ],
    synthesis: {
      version: "business-audit-synthesis-v7",
      lenses: [
        {
          lens: "offer",
          health: "adequate",
          score: 55,
          materiality: "soon",
          summary: "A working authenticated area exists but the stated value proposition is unclear.",
          evidenceIds: ["auth.area.reached", "profile.identity.description"],
          missingContext: [],
        },
        {
          lens: "revenue_economics",
          health: "weak",
          score: 10,
          materiality: "now",
          summary: "No monetization model is stated and no pricing or payment path exists.",
          evidenceIds: ["intent.monetization_model", "live.surface.pricing", "repo.surface.payments"],
          missingContext: [],
        },
        {
          lens: "acquisition",
          health: "weak",
          score: 32,
          materiality: "soon",
          summary: "On-page basics exist; structural discoverability does not.",
          evidenceIds: ["live.site.title"],
          missingContext: [],
        },
        {
          lens: "conversion",
          health: "adequate",
          score: 58,
          materiality: "soon",
          summary: "A single clear signup call to action exists.",
          evidenceIds: ["live.conversion.primary_cta"],
          missingContext: [],
        },
        {
          lens: "retention",
          health: "unclear",
          score: 45,
          materiality: "later",
          summary: "A signed-in area exists but nothing measures whether people return.",
          evidenceIds: ["auth.surface.dashboard", "repo.surface.analytics"],
          missingContext: [],
        },
      ],
      overall: "A real product whose path to revenue is still undecided.",
      strengths: [],
      blockers: [
        {
          rootProblem: "The business has not decided what customers pay for.",
          headline: "People still don't have a clear path to paying you.",
          explanation: "There is no way to see prices or buy anything.",
          whyItMatters: "Someone can like what you built and still leave.",
          evidenceIds: ["intent.monetization_model", "live.surface.pricing"],
          lenses: ["revenue_economics", "conversion"],
          tone: "critical",
          confidence: "high",
        },
      ],
    },
    limitations: ["No analytics, traffic or revenue data is available."],
    validationNotes: [],
    generatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}
