import { AUDIT_DIMENSIONS, DIMENSION_LABELS, type AssessmentStatus, type AuditDimensionId, type Confidence, type DimensionAssessment, type KeyFinding } from "./schema";

/**
 * Validation and sanitization of model output (Sprint 4 §20).
 *
 * Structured outputs guarantee the *shape* of the response. They guarantee
 * nothing about its *truthfulness*, so this layer enforces the invariants
 * the product depends on:
 *
 *  1. **Evidence must exist.** Every cited id is checked against the pack.
 *     Unknown ids are dropped and recorded — a citation that cannot be
 *     resolved is worse than no citation, because the UI would render it as
 *     proof.
 *  2. **Unknown stays unknown.** A dimension marked `insufficient_evidence`
 *     is forced to a null score, and a dimension claiming to be assessable
 *     with no surviving evidence is demoted. The model is asked to respect
 *     this; the application guarantees it.
 *  3. **Ranges hold.** Scores are integers in 0–100, and list lengths are
 *     capped, because the JSON Schema subset used by structured outputs
 *     cannot express either.
 */

export type ValidationFailure = "structured_output_invalid";

export type ValidatedAudit = {
  dimensions: DimensionAssessment[];
  keyFindings: KeyFinding[];
  limitations: string[];
  /** Integrity observations worth surfacing, e.g. dropped evidence ids. */
  notes: string[];
};

export type ValidateResult =
  | { ok: true; audit: ValidatedAudit }
  | { ok: false; error: ValidationFailure; reason: string };

const MAX_LIST_ITEMS = 4;
const MAX_KEY_FINDINGS = 5;
const MAX_LIMITATIONS = 5;
const MAX_TEXT_LENGTH = 600;

const STATUSES: AssessmentStatus[] = ["assessable", "partial", "insufficient_evidence"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

function cleanStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, 240);
    if (text !== null) items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

/** Keeps only ids that genuinely exist in the pack; reports the rest. */
function filterEvidenceIds(
  value: unknown,
  known: Set<string>,
  dropped: Set<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id === "") continue;
    if (known.has(id)) {
      if (!kept.includes(id)) kept.push(id);
    } else {
      dropped.add(id.slice(0, 80));
    }
  }
  return kept;
}

function normalizeScore(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function validateAuditOutput(data: unknown, knownEvidenceIds: Set<string>): ValidateResult {
  if (!isRecord(data)) {
    return { ok: false, error: "structured_output_invalid", reason: "response was not an object" };
  }
  if (!isRecord(data.dimensions)) {
    return { ok: false, error: "structured_output_invalid", reason: "dimensions missing" };
  }

  const dropped = new Set<string>();
  const notes: string[] = [];
  const dimensions: DimensionAssessment[] = [];

  for (const id of AUDIT_DIMENSIONS) {
    const raw = (data.dimensions as Record<string, unknown>)[id];
    if (!isRecord(raw)) {
      return {
        ok: false,
        error: "structured_output_invalid",
        reason: `dimension "${id}" missing`,
      };
    }

    const status = STATUSES.includes(raw.assessmentStatus as AssessmentStatus)
      ? (raw.assessmentStatus as AssessmentStatus)
      : "insufficient_evidence";

    const confidence = CONFIDENCES.includes(raw.confidence as Confidence)
      ? (raw.confidence as Confidence)
      : "low";

    const evidenceIds = filterEvidenceIds(raw.evidenceIds, knownEvidenceIds, dropped);
    let score = normalizeScore(raw.score);
    let finalStatus = status;

    // Invariant 1: unknown means unscored. Enforced rather than trusted —
    // a scored "insufficient evidence" dimension would silently drag the
    // overall score toward a number nobody can justify.
    if (finalStatus === "insufficient_evidence") {
      score = null;
    }

    // Invariant 2: a claim of assessability with no surviving evidence is
    // not assessable. This is what makes hallucinated citations harmless
    // instead of load-bearing.
    if (finalStatus !== "insufficient_evidence" && evidenceIds.length === 0) {
      finalStatus = "insufficient_evidence";
      score = null;
      notes.push(
        `${DIMENSION_LABELS[id as AuditDimensionId]} was reported as ${status} but cited no valid evidence, so it is treated as insufficient evidence.`,
      );
    }

    // Invariant 3: a scoreable status with no score is only partial.
    if (finalStatus === "assessable" && score === null) {
      finalStatus = "partial";
    }

    dimensions.push({
      id: id as AuditDimensionId,
      label: DIMENSION_LABELS[id as AuditDimensionId],
      assessmentStatus: finalStatus,
      score,
      confidence,
      summary: cleanText(raw.summary) ?? "No summary was produced for this dimension.",
      strengths: cleanStringList(raw.strengths, MAX_LIST_ITEMS),
      gaps: cleanStringList(raw.gaps, MAX_LIST_ITEMS),
      unknowns: cleanStringList(raw.unknowns, MAX_LIST_ITEMS),
      evidenceIds,
    });
  }

  const keyFindings: KeyFinding[] = [];
  if (Array.isArray(data.keyFindings)) {
    for (const entry of data.keyFindings) {
      if (!isRecord(entry)) continue;
      const finding = cleanText(entry.finding, 400);
      if (finding === null) continue;
      const evidenceIds = filterEvidenceIds(entry.evidenceIds, knownEvidenceIds, dropped);
      // A cross-cutting finding with nothing left to stand on is dropped
      // rather than shown as an unsupported assertion.
      if (evidenceIds.length === 0) continue;
      keyFindings.push({ finding, evidenceIds });
      if (keyFindings.length >= MAX_KEY_FINDINGS) break;
    }
  }

  if (dropped.size > 0) {
    notes.push(
      `${dropped.size} cited evidence reference(s) did not exist in the evidence pack and were discarded.`,
    );
  }

  return {
    ok: true,
    audit: {
      dimensions,
      keyFindings,
      limitations: cleanStringList(data.limitations, MAX_LIMITATIONS),
      notes,
    },
  };
}
