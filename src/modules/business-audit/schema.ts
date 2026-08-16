/**
 * Versioned Business Readiness Audit schema (Sprint 4 §8).
 *
 * Diagnostic only. This layer answers "how business-ready is this product,
 * on the evidence available?" It does not produce Opportunities, actions,
 * or code changes — that boundary belongs to Sprint 5's Opportunity Engine,
 * and blurring it here would make both harder to evaluate (Sprint 4 §31).
 *
 * The dimensions are exactly the five in PRODUCT.md §10. They are not
 * extended casually.
 */

export const BUSINESS_AUDIT_SCHEMA_VERSION = "business-readiness-audit.v1" as const;

/** Bumped when the audit's structure or scoring rules change materially. */
export const BUSINESS_AUDIT_VERSION = "business-audit-v1" as const;

export const AUDIT_DIMENSIONS = [
  "product",
  "monetization",
  "distribution",
  "conversion",
  "retention",
] as const;

export type AuditDimensionId = (typeof AUDIT_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<AuditDimensionId, string> = {
  product: "Product",
  monetization: "Monetization",
  distribution: "Distribution",
  conversion: "Conversion",
  retention: "Retention",
};

/**
 * The same five dimensions, phrased as the question each one answers
 * (Sprint UI-3.5).
 *
 * "Monetization: 28" is a category and a number. "Making money from it is
 * still unclear" is the same finding said to someone who has to decide what to
 * do about it — and this product's audience built something with an AI tool
 * and is now trying to build a business, not read an analyst report.
 *
 * The ids, the scoring and the stored payload are untouched: this is a label
 * table, and `DIMENSION_LABELS` above is still what technical views show.
 */
export const DIMENSION_QUESTIONS: Record<AuditDimensionId, string> = {
  product: "Do people understand what you built?",
  monetization: "Can you make money from it?",
  distribution: "Can people discover you?",
  conversion: "Do visitors become customers?",
  retention: "Do people come back?",
};

/**
 * The same five dimensions as **noun phrases**, for use inside a sentence.
 *
 * `DIMENSION_QUESTIONS` reads correctly as a standalone label above a meter and
 * is wrong everywhere else. The first dogfood put one inside a sentence and got:
 *
 *   "Where you're strongest: do people understand what you built? Where you're
 *    weakest: can you make money from it?"
 *
 * — a question mark mid-clause and a sentence that parses as nothing. The unit
 * test asserted that exact string, so the test enforced the defect rather than
 * catching it.
 *
 * Two label sets rather than one clever transformation: there is no rule that
 * turns "Do people come back?" into "keeping people coming back" reliably, and
 * a regex that tried would fail differently for each new dimension.
 */
export const DIMENSION_TOPICS: Record<AuditDimensionId, string> = {
  product: "explaining what you built",
  monetization: "making money from it",
  distribution: "helping people discover you",
  conversion: "turning visitors into customers",
  retention: "bringing people back",
};

/**
 * How much of a dimension the available evidence could actually support.
 *
 * `insufficient_evidence` is a legitimate, useful outcome — not a failure
 * and never a low score. See `scoring.ts` for why this distinction is
 * enforced in code rather than trusted to the model.
 */
export type AssessmentStatus = "assessable" | "partial" | "insufficient_evidence";

export type Confidence = "high" | "medium" | "low";

export type DimensionAssessment = {
  id: AuditDimensionId;
  label: string;
  assessmentStatus: AssessmentStatus;
  /** 0–100, or null when the evidence cannot support a score. */
  score: number | null;
  confidence: Confidence;
  summary: string;
  strengths: string[];
  gaps: string[];
  /** What could not be determined — stated, not silently omitted. */
  unknowns: string[];
  /** Evidence ids justifying this assessment. Validated against the pack. */
  evidenceIds: string[];
};

export type OverallReadiness = {
  /** Deterministically computed by the application, never by the model. */
  score: number | null;
  assessedDimensions: number;
  totalDimensions: number;
  /** Why `score` is null, when it is. */
  insufficientCoverageReason: string | null;
};

export type KeyFinding = {
  finding: string;
  evidenceIds: string[];
};

export type BusinessReadinessAudit = {
  schemaVersion: typeof BUSINESS_AUDIT_SCHEMA_VERSION;
  auditVersion: typeof BUSINESS_AUDIT_VERSION;
  evidencePackVersion: string;
  promptVersion: string;
  rubricVersion: string;
  provider: string;
  model: string;
  dimensions: DimensionAssessment[];
  overall: OverallReadiness;
  keyFindings: KeyFinding[];
  /** What this audit could not assess, and why. */
  limitations: string[];
  /** Integrity notes from output validation, e.g. dropped evidence ids. */
  validationNotes: string[];
  generatedAt: string;
};
