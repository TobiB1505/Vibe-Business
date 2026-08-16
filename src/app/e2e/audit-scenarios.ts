import { computeOverallReadiness } from "@/modules/business-audit/scoring";
import {
  AUDIT_DIMENSIONS,
  type BusinessReadinessAudit,
  type DimensionAssessment,
} from "@/modules/business-audit/schema";

/**
 * The human-first audit in a real browser (CORE-2 §14, §62, §63).
 *
 * ## Why this needs a browser
 *
 * CORE-2's claim about the audit is entirely about **reading order**: a founder
 * meets the conclusion first, the score second, and the dimension breakdown
 * only if they go looking. None of that is a property of a data structure.
 * `buildHumanAuditView` returning a conclusion string proves the sentence
 * exists; it does not prove it sits above the score on screen, that the
 * breakdown is collapsed, or that a phone does not scroll sideways.
 *
 * The load-bearing scenario is `partial` — an audit where two of five
 * dimensions could not be assessed. That is the case where the old screen was
 * most likely to read as a bad result, and where CLAUDE.md rule 44 has to hold
 * in pixels: an unassessed dimension must appear under "what Vibe couldn't
 * see" and nowhere near "what's holding you back".
 *
 * `overall` is computed by the **real** `computeOverallReadiness`, so a change
 * to scoring changes what the browser sees rather than letting a hand-written
 * fixture drift away from it.
 */

function dimension(
  id: (typeof AUDIT_DIMENSIONS)[number],
  overrides: Partial<DimensionAssessment> = {},
): DimensionAssessment {
  return {
    id,
    label: id,
    assessmentStatus: "assessable",
    score: 60,
    confidence: "medium",
    summary: `A plain summary of ${id}.`,
    strengths: [],
    gaps: [],
    unknowns: [],
    evidenceIds: ["live.site.title"],
    ...overrides,
  };
}

function audit(dimensions: DimensionAssessment[]): BusinessReadinessAudit {
  return {
    schemaVersion: "business-readiness-audit.v1",
    auditVersion: "business-audit-v1",
    evidencePackVersion: "business-evidence.v3",
    promptVersion: "business-audit-prompt-v1",
    rubricVersion: "business-readiness-rubric-v1",
    provider: "anthropic",
    model: "claude-sonnet-5",
    dimensions,
    overall: computeOverallReadiness(dimensions),
    keyFindings: [
      {
        finding: "People understand what you built, but there is no way to pay you for it.",
        evidenceIds: ["profile.identity.description", "profile.signal.pricing_surface"],
      },
    ],
    limitations: ["No traffic, revenue or usage data is available to Vibe."],
    validationNotes: [],
    generatedAt: "2026-08-16T09:00:00.000Z",
  };
}

export const E2E_AUDIT_SCENARIOS = {
  /**
   * Every dimension assessed, at the **real audit's volume**: 10 strengths and
   * 15 gaps across five dimensions.
   *
   * Those counts are taken from the live Vibe Business audit — and from the v1
   * audit before it, which produced exactly the same 10 and 15. The first
   * fixture here carried one finding per dimension, which is why the browser
   * suite was green while the real screen read as a scan report: a fixture
   * smaller than reality cannot show a volume problem.
   */
  "audit-complete": () =>
    audit([
      dimension("product", {
        score: 68,
        strengths: [
          "Consistent value proposition across live site and profile",
          "Authenticated dashboard, integrations, and project workspace surfaces observed",
          "Repository routes align with observed signed-in paths",
          "Multiple capabilities confirmed: sign in, connect integration, use dashboard",
        ],
        gaps: [
          "The product description reads as a placeholder",
          "No positioning line is stated anywhere",
          "The category is inferred rather than declared",
        ],
      }),
      dimension("monetization", {
        score: 10,
        strengths: [],
        gaps: [
          "Founder states no monetization model is intended",
          "No pricing surface on the live site",
          "No checkout/billing surface detected live, in repo, or in signed-in app",
          "No payment or subscription capability found in any source",
        ],
      }),
      dimension("distribution", {
        score: 38,
        strengths: ["Core SEO elements present: title, meta description, robots.txt, sitemap"],
        gaps: [
          "Canonical URL, Open Graph, structured data, and robots meta all absent",
          "No blog/content or docs surface detected live or in repo",
          "No stated acquisition approach found",
        ],
      }),
      dimension("conversion", {
        score: 55,
        strengths: [
          "Primary CTA is a clear signup action",
          "Signup and login forms present on the live site",
          "Journey progresses from arrival through signup to a signed-in experience",
        ],
        gaps: [
          "Onboarding surface not observed in signed-in app or repository",
          "No social proof or trust signals on the live site",
          "The journey has no pricing stage before signup",
        ],
      }),
      dimension("retention", {
        score: 45,
        strengths: [
          "Authenticated area with dashboard, integrations, and project workspace reached",
          "Retention capability signal: product has a signed-in area users can return to",
        ],
        gaps: [
          "No notification, digest or re-engagement mechanism found",
          "No analytics provider detected in any source",
        ],
      }),
    ]),

  /**
   * Two dimensions unassessable. The case rule 44 exists for: these must read
   * as a limit on the analysis, never as a finding about the product.
   */
  "audit-partial": () =>
    audit([
      dimension("product", {
        score: 84,
        strengths: ["The homepage says what the product does in one line."],
      }),
      dimension("monetization", {
        score: 22,
        gaps: ["There is no pricing page and no way to pay."],
      }),
      dimension("distribution", { score: 47, gaps: ["No sitemap and no robots.txt."] }),
      dimension("retention", {
        score: null,
        assessmentStatus: "insufficient_evidence",
        confidence: "low",
        summary: "Nothing could be observed about returning users.",
        gaps: ["Retention could not be observed at all."],
        unknowns: ["Whether anyone comes back."],
        evidenceIds: [],
      }),
      dimension("conversion", {
        score: null,
        assessmentStatus: "insufficient_evidence",
        confidence: "low",
        summary: "The conversion path could not be observed.",
        gaps: ["Conversion could not be observed at all."],
        unknowns: ["Whether visitors sign up."],
        evidenceIds: [],
      }),
    ]),

  /**
   * Nothing assessable. The audit must say so rather than manufacture a
   * verdict or show a zero.
   */
  "audit-uncertain": () =>
    audit(
      AUDIT_DIMENSIONS.map((id) =>
        dimension(id, {
          score: null,
          assessmentStatus: "insufficient_evidence",
          confidence: "low",
          summary: "Not enough evidence.",
          evidenceIds: [],
        }),
      ),
    ),
} as const;

export type E2eAuditScenario = keyof typeof E2E_AUDIT_SCENARIOS;

export function isE2eAuditScenario(value: string): value is E2eAuditScenario {
  return value in E2E_AUDIT_SCENARIOS;
}
