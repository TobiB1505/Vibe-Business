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

// ---------------------------------------------------------------------
// Business synthesis (CORE-2a.1)
// ---------------------------------------------------------------------

/**
 * The synthesis contract, versioned **separately** from the evidence pack
 * (CORE-2a.1 §20).
 *
 * The two answer different questions and moved for different reasons.
 * `business-evidence.v3` is about what the model was *told*; this is about what
 * it is asked to *conclude*. Evidence quality improving and judgment quality
 * improving are independent events, and an audit has to be able to say which
 * of them it carries.
 */
export const AUDIT_SYNTHESIS_VERSION = "business-audit-synthesis-v1" as const;

/**
 * How a conclusion reads, not how severe it is.
 *
 * `positive` is what the product already has; `attention` and `critical` are
 * both things holding it back, separated only so the UI can weight them. The
 * split into strengths and blockers is derived from this rather than being a
 * second field the model could contradict.
 */
export const CONCLUSION_TONES = ["positive", "attention", "critical"] as const;
export type ConclusionTone = (typeof CONCLUSION_TONES)[number];

/**
 * One business-level conclusion drawn from several pieces of evidence.
 *
 * This is the layer CORE-2a.1 exists to add. The dimensions below it answer
 * *"how does this business area look?"*; a conclusion answers *"what do these
 * observations mean together?"* — which is the level a founder should read
 * first, and the level the previous audit never produced.
 *
 * The real dogfood is the argument. It emitted, as five separate gaps: no
 * monetization model stated, no pricing surface, no checkout surface, no
 * payment capability, no paying journey stage. Those are five observations of
 * **one** business problem — *people still don't have a clear path to paying
 * you* — and listing them five times is enumeration wearing the costume
 * of thoroughness.
 *
 * `dimensions` is a list on purpose (§12). A buying path that is unclear spans
 * monetization, conversion and the customer journey, and forcing it into one
 * scored dimension would be an artificial taxonomy boundary. Dimension scores
 * stay separate and unchanged.
 */
export type BusinessConclusion = {
  /** The sentence a founder reads. Plain language, no product jargon. */
  headline: string;
  /** One or two sentences on what Vibe actually found. */
  explanation: string;
  /**
   * Why this matters commercially. Usually present on a blocker and often
   * absent on a strength, which is why it is nullable rather than required
   * (§28) — a strength that needs a paragraph of justification is usually not
   * a strength.
   */
  whyItMatters: string | null;
  /** At least one, validated against the pack. Never empty (§10). */
  evidenceIds: string[];
  /** Which scored dimensions this conclusion touches. May be several (§12). */
  dimensions: AuditDimensionId[];
  tone: ConclusionTone;
  confidence: Confidence;
};

/**
 * The concise judgment layer of an audit.
 *
 * Bounded by the contract rather than by the UI: these are few because the
 * model chose the ones that matter, not because React hides the rest
 * (DoD 8). Everything not chosen remains in the dimension assessments and in
 * the evidence pack, both untouched.
 */
export type AuditSynthesis = {
  version: typeof AUDIT_SYNTHESIS_VERSION;
  /**
   * One sentence about the business as a whole, grounded in the assessment
   * below it — never generic encouragement (§25).
   */
  overall: string;
  /** 2–4 when the evidence supports them; fewer when it does not (§6). */
  strengths: BusinessConclusion[];
  /** At most 3 (§6, §36). Fewer is a valid and common answer. */
  blockers: BusinessConclusion[];
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
  /**
   * The business-level judgment (CORE-2a.1).
   *
   * Null on every audit written before this contract existed. Those rows keep
   * their per-dimension findings and their `keyFindings`, and the renderer has
   * a legacy path for them (§21) — back-filling a synthesis by re-reading old
   * prose would be inventing a conclusion nobody's model actually drew.
   */
  synthesis: AuditSynthesis | null;
  /**
   * Historical. Superseded by `synthesis` for audits that carry one: a key
   * finding *was* a cross-cutting conclusion, just without the grounding,
   * cardinality or language rules the synthesis contract imposes. New audits
   * leave this empty rather than producing the same judgment twice.
   */
  keyFindings: KeyFinding[];
  /** What this audit could not assess, and why. */
  limitations: string[];
  /** Integrity notes from output validation, e.g. dropped evidence ids. */
  validationNotes: string[];
  generatedAt: string;
};
