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
