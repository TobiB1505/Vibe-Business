import type {
  BusinessConclusion,
  BusinessLensAssessment,
  BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { fakeAudit } from "@/modules/opportunities/test-support";
import type { PlannerSource } from "./source";
import type { WirePlan, WirePlanStep } from "./wire-schema";

/**
 * Fixtures for the Action Planner (CORE-2b §71–§85).
 *
 * The plan fixture is a **provider-shaped** object, because that is what the
 * pipeline actually receives. Testing against the domain shape would skip the
 * normalizer, the validator and the classifier — which are the three layers
 * that decide whether a billed response is usable and what Vibe is willing to
 * claim about it.
 */

export function fakeWirePlanStep(overrides: Partial<WirePlanStep> = {}): WirePlanStep {
  return {
    order: 1,
    title: "Derive the plausible first-customer segments",
    description:
      "Vibe reads the product profile and the audit evidence and produces two or three first-customer segments this product could credibly serve today, with the trade-offs of each.",
    purpose:
      "Turns an open question into a small set of real options, so the founder chooses between concrete alternatives rather than starting from a blank page.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria:
      "Two or three candidate segments exist, each with the product strengths that support it and what it would cost to pursue.",
    dependsOn: [],
    evidenceIds: ["profile.identity.description"],
    ...overrides,
  };
}

/** A credible audience plan: Vibe prepares, the founder chooses, work follows. */
export function fakeWirePlan(overrides: Partial<WirePlan> = {}): WirePlan {
  return {
    goal: "Narrow a broad founder audience into one first customer segment Vibe can position and acquire for.",
    whyNow:
      "Audience is the area the audit marked as blocking the next milestone; positioning and acquisition both depend on it being settled.",
    expectedOutcome:
      "One named first customer segment is confirmed, the product's main promise speaks to it, and one low-cost way to reach it is defined.",
    addressesRootProblem:
      "The root problem is that nobody can tell who this is for. At the end of this the business has a named first customer and a promise written for them.",
    assumptions: [
      "The founder is willing to narrow the audience rather than keep serving everyone.",
    ],
    steps: [
      fakeWirePlanStep(),
      fakeWirePlanStep({
        order: 2,
        title: "Choose which segment the business will pursue first",
        description:
          "The founder picks one of the candidate segments as the first customer the business will try to win.",
        purpose:
          "Only the founder knows which market they want to be in. Every downstream step depends on this being settled.",
        actor: "founder_decision",
        changeKind: "decision",
        completionCriteria:
          "One segment is explicitly chosen and recorded as the current intended audience.",
        dependsOn: [1],
        evidenceIds: [],
      }),
      fakeWirePlanStep({
        order: 3,
        title: "Rewrite the main promise for the chosen segment",
        description:
          "The homepage's primary promise is rewritten so the chosen segment recognises itself in the first sentence.",
        purpose:
          "A promise written for everyone reads as a promise for nobody. This makes the site legible to the people the business decided to serve.",
        actor: "vibe",
        changeKind: "product_change",
        completionCriteria:
          "The homepage's primary promise names the chosen segment's situation and matches what the product actually does.",
        dependsOn: [2],
        evidenceIds: ["live.site.title"],
      }),
      fakeWirePlanStep({
        order: 4,
        title: "Define the signal that says the choice worked",
        description:
          "One observable result is agreed that would support or reject the segment choice within a few weeks.",
        purpose:
          "Without an agreed signal the segment choice can never be confirmed or reversed, and the business keeps guessing.",
        actor: "vibe",
        changeKind: "measurement",
        completionCriteria:
          "One named signal and the threshold that would count as evidence for or against the chosen segment are written down.",
        dependsOn: [3],
        evidenceIds: [],
      }),
    ],
    ...overrides,
  };
}

export function fakeOpportunity(overrides: Partial<BusinessOpportunity> = {}): BusinessOpportunity {
  return {
    id: "1-positioning-narrow-your-first-customer",
    rank: 1,
    // Direct lineage, which is what every Move created since v2 carries (FIX §1).
    sourceConclusionKey: "blocker-1",
    title: "Narrow your first customer",
    problem: "The product describes a broad founder audience and no single first customer.",
    whyNow: "Positioning and acquisition both depend on knowing who this is for.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "positioning",
    primaryDimension: "product",
    secondaryDimensions: ["conversion"],
    evidenceIds: ["profile.identity.description", "live.site.title"],
    executionType: "business_decision",
    executionReadiness: "needs_user_input",
    dependencies: [],
    ...overrides,
  };
}

export function fakeConclusion(overrides: Partial<BusinessConclusion> = {}): BusinessConclusion {
  return {
    rootProblem: "The business has not decided who its first customer is.",
    headline: "Nobody can tell who this is for.",
    explanation:
      "The site speaks to founders in general, and the product profile describes a broad audience.",
    whyItMatters: "Positioning, pricing and acquisition all depend on a first customer being chosen.",
    evidenceIds: ["profile.identity.description", "live.site.title"],
    dimensions: ["product", "conversion"],
    lenses: ["audience", "offer"],
    tone: "critical",
    confidence: "high",
    ...overrides,
  };
}

export function fakeLens(
  overrides: Partial<BusinessLensAssessment> = {},
): BusinessLensAssessment {
  return {
    lens: "audience",
    health: "weak",
    materiality: "now",
    summary: "The audience is stated broadly and no first customer is identified.",
    evidenceIds: ["profile.identity.description"],
    missingContext: ["Which segment does the founder actually want to win first?"],
    ...overrides,
  };
}

/** An audit carrying a synthesis, which is what plan sourcing reads (§5). */
export function fakePlannedAudit(
  overrides: Partial<BusinessReadinessAudit> = {},
): BusinessReadinessAudit {
  return fakeAudit({
    synthesis: {
      version: "business-audit-synthesis-v6",
      lenses: [fakeLens(), fakeLens({ lens: "offer", health: "unclear", materiality: "soon" })],
      overall: "A working product without a defined first customer.",
      strengths: [],
      blockers: [fakeConclusion()],
    },
    ...overrides,
  });
}

export function fakePlannerSource(overrides: Partial<PlannerSource> = {}): PlannerSource {
  return {
    opportunity: fakeOpportunity(),
    conclusion: fakeConclusion(),
    conclusionKey: "blocker-1",
    lineage: "direct",
    lenses: [fakeLens()],
    citedEvidenceIds: ["profile.identity.description", "live.site.title"],
    ...overrides,
  };
}

/** The evidence ids the fixtures cite, as a validated pack would expose them. */
export const FAKE_PLAN_EVIDENCE_IDS = new Set([
  "profile.identity.description",
  "profile.identity.audience",
  "intent.monetization_model",
  "business.stage",
  "live.site.title",
  "live.surface.pricing",
  "live.seo.robots_txt_missing",
  "live.seo.sitemap_missing",
  "repo.surface.robots",
  "repo.surface.sitemap",
  "repo.surface.payments",
]);

/**
 * A repository snapshot the SEO capability can match against (§73).
 *
 * Deliberately the **execution module's own fixture**, re-exported rather than
 * rebuilt. The Action Planner's registry and `execution/capabilities.ts` must
 * agree about what `nextjs_seo_foundations_v2` requires, and a second snapshot
 * fixture shaped slightly differently is exactly how two tests can both pass
 * while the two resolvers disagree in production.
 */
export { fakeRepositorySnapshotFor } from "@/modules/execution/test-support";
