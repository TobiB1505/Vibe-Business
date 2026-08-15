import { sourceOfEvidence } from "./evidence";
import {
  CAPABILITY_IDS,
  CONFIDENCE_LEVELS,
  PRODUCT_CATEGORIES,
  type Attributed,
  type CapabilityId,
  type EvidenceSource,
  type ProductCategory,
  type ProfileConfidence,
} from "./schema";
import type { NormalizedField, NormalizedUnderstanding, SynthesisField } from "./wire-schema";

/**
 * Validation of model output, independent of schema compliance
 * (CLAUDE.md rule 45, CORE-1 §20).
 *
 * Structured outputs guarantee the *shape* of a response and nothing about
 * its *truthfulness*. This layer enforces the four invariants the product
 * actually depends on:
 *
 *  1. **Every citation must resolve.** Ids are checked against the pack that
 *     was sent. An unknown id is dropped and counted — displaying a citation
 *     that cannot be resolved is worse than displaying none, because the UI
 *     renders it as justification.
 *  2. **Weak evidence cannot become a confirmed fact** (CORE-1 §17). A field
 *     claiming `confirmed` with no surviving evidence is demoted to `unclear`
 *     and its value dropped. This is the rule the sprint's confidence test
 *     exists for, and it is enforced here rather than requested in the prompt.
 *  3. **Unclear means null.** A value that survives alongside `unclear` or
 *     `not_found` would be rendered as an answer, so it does not survive.
 *  4. **Hedges are not values.** "Unknown", "N/A", "not specified" are the
 *     model refusing in prose rather than in the schema. They become null.
 */

export type ValidationFailure = "structured_output_schema_invalid";

/** Bounded codes naming schema fields only — never model content. */
export type ValidationReason =
  | "category_invalid"
  | "no_field_survived_validation"
  | "understanding_missing";

export type ValidatedField = Attributed<string>;

export type ValidatedUnderstanding = {
  fields: Record<SynthesisField, ValidatedField>;
  category: Attributed<ProductCategory>;
  /** Capability ids the model ranked, most important first. Deduplicated. */
  rankedCapabilities: { id: CapabilityId; evidence: string[] }[];
  limitations: string[];
  /** Integrity observations, e.g. how many citations were discarded. */
  notes: string[];
};

export type ValidateResult =
  | { ok: true; understanding: ValidatedUnderstanding }
  | { ok: false; error: ValidationFailure; reason: ValidationReason };

const MAX_VALUE_LENGTH = 600;
const MAX_LIMITATIONS = 4;
const MAX_LIMITATION_LENGTH = 240;
const MAX_CAPABILITIES = 8;
const MAX_EVIDENCE_PER_FIELD = 8;

/**
 * Strings that are a refusal wearing a value's clothes.
 *
 * Anchored to the whole trimmed string: a product genuinely called "N/A" is
 * not a case worth supporting, but an understanding paragraph containing the
 * word "unknown" mid-sentence very much is.
 */
const HEDGE = /^(unknown|n\/?a|none|not (specified|available|found|determined|applicable)|tbd|\?+|-+)$/i;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function cleanValue(raw: unknown): string | null {
  if (!isString(raw)) return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "" || text.length > MAX_VALUE_LENGTH) return null;
  if (HEDGE.test(text)) return null;
  return text;
}

function cleanConfidence(raw: unknown): ProfileConfidence {
  return isString(raw) && (CONFIDENCE_LEVELS as readonly string[]).includes(raw)
    ? (raw as ProfileConfidence)
    : "unclear";
}

/** Keeps only ids that exist in the pack, capped and deduplicated. */
function resolveEvidence(raw: unknown, known: Set<string>): { kept: string[]; dropped: number } {
  if (!Array.isArray(raw)) return { kept: [], dropped: 0 };

  const kept: string[] = [];
  let dropped = 0;

  for (const candidate of raw) {
    if (!isString(candidate)) {
      dropped += 1;
      continue;
    }
    if (!known.has(candidate)) {
      dropped += 1;
      continue;
    }
    if (kept.includes(candidate)) continue;
    if (kept.length >= MAX_EVIDENCE_PER_FIELD) continue;
    kept.push(candidate);
  }

  return { kept, dropped };
}

function sourcesFor(evidence: string[]): EvidenceSource[] {
  const sources = new Set<EvidenceSource>();
  for (const id of evidence) sources.add(sourceOfEvidence(id));
  // A conclusion with no surviving citation is the model's own reading and
  // must say so — that is the difference between "the site says this" and
  // "a model thinks this" (CORE-1 §16).
  if (sources.size === 0) sources.add("ai_inferred");
  return [...sources];
}

/**
 * One field, after every invariant is applied.
 *
 * The demotion ladder, in order:
 *   value is a hedge or empty            → not_found
 *   confidence is unclear/not_found      → value dropped
 *   confidence is confirmed, no evidence → demoted to unclear, value dropped
 *
 * The last rule is the important one. A model asserting a confirmed fact it
 * cannot cite is exactly the failure "weak evidence must not become a
 * confirmed fact" names, and the prompt asking nicely is not a control.
 */
export function validateField(entry: NormalizedField, known: Set<string>): {
  field: ValidatedField;
  dropped: number;
} {
  const { kept, dropped } = resolveEvidence(entry.evidenceIds, known);
  const value = cleanValue(entry.value);
  let confidence = cleanConfidence(entry.confidence);

  if (value === null) {
    return {
      field: { value: null, confidence: confidence === "not_found" ? "not_found" : "unclear", sources: [], evidence: kept },
      dropped,
    };
  }

  if (confidence === "unclear" || confidence === "not_found") {
    return { field: { value: null, confidence, sources: [], evidence: kept }, dropped };
  }

  if (kept.length === 0) {
    // An uncitable claim is still the model's reading, and the profile keeps
    // it — but only as `unclear`, with no value, so nothing downstream can
    // present it as something Vibe established.
    confidence = "unclear";
    return { field: { value: null, confidence, sources: ["ai_inferred"], evidence: [] }, dropped };
  }

  return { field: { value, confidence, sources: sourcesFor(kept), evidence: kept }, dropped };
}

export function validateUnderstanding(
  raw: NormalizedUnderstanding,
  known: Set<string>,
): ValidateResult {
  const fields = {} as Record<SynthesisField, ValidatedField>;
  let droppedCitations = 0;
  let survivingValues = 0;

  for (const [name, entry] of Object.entries(raw.fields) as [SynthesisField, NormalizedField][]) {
    const { field, dropped } = validateField(entry, known);
    fields[name] = field;
    droppedCitations += dropped;
    if (field.value !== null) survivingValues += 1;
  }

  if (survivingValues === 0) {
    // Every field failed validation. That is not a thin profile, it is a call
    // that produced nothing usable, and reporting it as a success would put an
    // empty "I understand your product" screen in front of a founder.
    return {
      ok: false,
      error: "structured_output_schema_invalid",
      reason: "no_field_survived_validation",
    };
  }

  if (fields.understanding.value === null && fields.shortDescription.value === null) {
    // The two fields the final screen is built around. Without either, there
    // is nothing to show and nothing to confirm.
    return {
      ok: false,
      error: "structured_output_schema_invalid",
      reason: "understanding_missing",
    };
  }

  const categoryEvidence = resolveEvidence(raw.categoryEvidenceIds, known);
  droppedCitations += categoryEvidence.dropped;

  const categoryValue =
    isString(raw.category) && (PRODUCT_CATEGORIES as readonly string[]).includes(raw.category)
      ? (raw.category as ProductCategory)
      : null;

  const categoryConfidence = cleanConfidence(raw.categoryConfidence);
  const category: Attributed<ProductCategory> =
    categoryValue === null
      ? { value: null, confidence: "unclear", sources: [], evidence: [] }
      : categoryConfidence === "unclear" || categoryConfidence === "not_found"
        ? { value: null, confidence: categoryConfidence, sources: [], evidence: categoryEvidence.kept }
        : {
            value: categoryValue,
            confidence: categoryEvidence.kept.length === 0 ? "unclear" : categoryConfidence,
            sources: categoryEvidence.kept.length === 0 ? ["ai_inferred"] : sourcesFor(categoryEvidence.kept),
            evidence: categoryEvidence.kept,
          };

  if (category.confidence === "unclear") category.value = category.value === null ? null : category.value;

  const rankedCapabilities: { id: CapabilityId; evidence: string[] }[] = [];
  for (const entry of raw.primaryCapabilities) {
    if (rankedCapabilities.length >= MAX_CAPABILITIES) break;
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.capability;
    if (!isString(id) || !(CAPABILITY_IDS as readonly string[]).includes(id)) continue;
    if (rankedCapabilities.some((existing) => existing.id === id)) continue;
    const resolved = resolveEvidence(record.evidenceIds, known);
    droppedCitations += resolved.dropped;
    rankedCapabilities.push({ id: id as CapabilityId, evidence: resolved.kept });
  }

  const limitations: string[] = [];
  if (Array.isArray(raw.limitations)) {
    for (const candidate of raw.limitations) {
      if (limitations.length >= MAX_LIMITATIONS) break;
      if (!isString(candidate)) continue;
      const text = candidate.replace(/\s+/g, " ").trim();
      if (text === "" || text.length > MAX_LIMITATION_LENGTH) continue;
      if (limitations.includes(text)) continue;
      limitations.push(text);
    }
  }

  const notes: string[] = [];
  if (droppedCitations > 0) {
    notes.push(
      `${droppedCitations} evidence citation(s) did not resolve to the evidence pack and were discarded.`,
    );
  }

  return { ok: true, understanding: { fields, category, rankedCapabilities, limitations, notes } };
}
