import { computeOverallScore } from "@/modules/business-audit/scoring";
import {
  AUDIT_SYNTHESIS_VERSION,
  type AuditSynthesis,
  type BusinessLensAssessment,
  type BusinessReadinessAudit,
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
 * `overall` is computed by the **real** `computeOverallScore`, so a change
 * to scoring changes what the browser sees rather than letting a hand-written
 * fixture drift away from it (ADR 0050: the mean over validated lens scores).
 */

function audit(synthesis: AuditSynthesis): BusinessReadinessAudit {
  return {
    schemaVersion: "business-readiness-audit.v2",
    auditVersion: "business-audit-v3",
    contractVersion: "business-audit-contract-v8",
    evidencePackVersion: "business-evidence.v4",
    promptVersion: "business-audit-prompt-v5",
    rubricVersion: "business-readiness-rubric-v11",
    provider: "anthropic",
    model: "claude-sonnet-5",
    overall: computeOverallScore(synthesis.lenses),
    keyFindings: [],
    synthesis,
    limitations: ["No traffic, revenue or usage data is available to Vibe."],
    validationNotes: [],
    generatedAt: "2026-08-16T09:00:00.000Z",
  };
}

/**
 * The synthesis a good model returns for the real Vibe Business evidence
 * (CORE-2a.1).
 *
 * Two strengths and two blockers, each grouping several observations — the
 * shape the contract asks for, against the same underlying facts that produced
 * 10 strengths and 15 gaps under the old rubric. Two blockers rather than three
 * on purpose: the ceiling is not a quota, and a fixture that always fills it
 * would quietly assert the opposite.
 */
/**
 * One lens the audit assessed. `missingContext` is empty unless a case needs
 * it, because most lenses are judged rather than blocked.
 */
function lensAssessment(
  lens: BusinessLensAssessment["lens"],
  health: BusinessLensAssessment["health"],
  materiality: BusinessLensAssessment["materiality"],
  evidenceIds: string[],
  missingContext: string[] = [],
): BusinessLensAssessment {
  // Fixture-only values make the visual contract testable. Production values
  // come exclusively from a validated audit and old audits remain null.
  const fixtureScores: Record<BusinessLensAssessment["lens"], number | null> = {
    offer: 62,
    audience: 41,
    revenue_economics: 38,
    acquisition: 44,
    conversion: 58,
    retention: 61,
    measurement: 31,
    business_readiness: 36,
    scalability: null,
  };
  return {
    lens,
    health,
    score: fixtureScores[lens],
    materiality,
    summary: `What Vibe worked out about ${lens.replace(/_/g, " ")}.`,
    evidenceIds,
    missingContext,
  };
}

const VIBE_SYNTHESIS: AuditSynthesis = {
  version: AUDIT_SYNTHESIS_VERSION,
  /*
   * Nine lens assessments, at the shape a real audit produces.
   *
   * This was `[]` until AUDIT UI-1, which was correct when the fixture was
   * written and became a hole the moment the map existed: every node rendered
   * as unknown, in one flat outer ring, and the browser suite was green over a
   * screen that could not have shipped. The same failure CORE-2a.3.1 paid for,
   * with a different field.
   *
   * The mix is taken from the real Vibe Business audit: three areas that matter
   * now, two soon, four later, and a deliberate `weak`+`later` pairing so the
   * map is forced to show health and priority as independent axes.
   */
  lenses: [
    lensAssessment("audience", "weak", "now", [
      "live.site.title",
      "profile.audience.primary",
    ]),
    lensAssessment("offer", "adequate", "now", ["profile.identity.description"]),
    lensAssessment("conversion", "adequate", "now", ["live.conversion.primary_cta"]),
    lensAssessment("revenue_economics", "weak", "soon", [
      "intent.how_it_earns",
      "live.surface.pricing_not_observed",
      // Was `repo.payments.none`, which no evidence builder emits — so the
      // fixture was the only place that string could come from, and it rendered
      // as "Payments none" in a screenshot the audit then quoted as a product
      // defect (UI-7 §2). The real id for the same fact.
      "repo.surface.payments_not_observed",
    ]),
    lensAssessment("acquisition", "weak", "soon", ["live.seo.canonical_missing"]),
    lensAssessment("business_readiness", "weak", "later", ["live.surface.terms_not_observed"]),
    lensAssessment("measurement", "weak", "later", ["repo.analytics.none"]),
    lensAssessment("retention", "adequate", "later", ["auth.surface.dashboard"]),
    lensAssessment("scalability", "unclear", "later", []),
  ],
  overall:
    "You have a real product that people can use, but nothing about it explains how anyone would pay you.",
  strengths: [
    {
      rootProblem: "",
      headline: "People can understand and start using your product.",
      explanation:
        "Vibe found a consistent message about what you do, a clear way to sign up, and a real signed-in area with several working parts.",
      whyItMatters: null,
      evidenceIds: [
        "profile.identity.description",
        "live.site.title",
        "live.conversion.primary_cta",
        "auth.area.reached",
      ],
      dimensions: ["product", "conversion"],
      lenses: ["offer", "conversion"],
      tone: "positive",
      confidence: "high",
    },
    {
      rootProblem: "",
      headline: "Customers already have something to come back to.",
      explanation:
        "There is a signed-in workspace with a dashboard and integrations, not just a landing page.",
      whyItMatters: null,
      evidenceIds: ["auth.surface.dashboard", "auth.area.reached"],
      dimensions: ["retention"],
      lenses: ["retention"],
      tone: "positive",
      confidence: "medium",
    },
  ],
  blockers: [
    {
      rootProblem: "",
      headline: "People still don't have a clear way to pay you.",
      explanation:
        "Vibe couldn't find prices, a way to buy, or any payment step — on your site, in your code, or inside the signed-in product.",
      whyItMatters:
        "Someone can like what you built and still leave, because they never find out what it costs or how to start paying.",
      evidenceIds: [
        "profile.signal.pricing_surface",
        "intent.how_it_earns",
        "live.surface.pricing",
        "repo.surface.payments",
        "profile.journey.checkout_not_found",
      ],
      dimensions: ["monetization", "conversion"],
      lenses: ["revenue_economics", "conversion", "scalability"],
      tone: "critical",
      confidence: "high",
    },
    {
      rootProblem: "",
      headline: "You may not be able to tell what is actually working.",
      explanation:
        "Vibe couldn't find anything measuring what people do, so there is no way to see where they drop off.",
      whyItMatters:
        "Without that, every change you make is a guess, and you won't know which ones helped.",
      evidenceIds: ["repo.surface.analytics", "profile.signal.analytics"],
      dimensions: ["retention", "distribution"],
      lenses: ["measurement"],
      tone: "attention",
      confidence: "medium",
    },
  ],
};

export const E2E_AUDIT_SCENARIOS = {
  /**
   * The synthesis contract, on the real product's evidence. This is what a new
   * audit looks like: four conclusions rather than twenty-five findings, and
   * an overall score computed from the lens scores the map renders.
   */
  "audit-synthesis": () => audit(VIBE_SYNTHESIS),

  /** Same truthful audit, with no Opportunity Engine output behind the CTA. */
  "audit-synthesis-no-moves": () => audit(VIBE_SYNTHESIS),
} as const;

export type E2eAuditScenario = keyof typeof E2E_AUDIT_SCENARIOS;

export function isE2eAuditScenario(value: string): value is E2eAuditScenario {
  return value in E2E_AUDIT_SCENARIOS;
}
