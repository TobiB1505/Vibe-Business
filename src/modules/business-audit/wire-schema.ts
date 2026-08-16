import { AUDIT_DIMENSIONS, CONCLUSION_TONES, type AuditDimensionId } from "./schema";

/**
 * The Anthropic **transport** representation of an audit response, and the
 * normalizer that turns it back into the domain shape (Sprint 4 §9).
 *
 * Why a separate representation exists at all: the first production request
 * was rejected with `400 invalid_request_error` — "the compiled grammar is
 * too large". The previous schema declared the dimension assessment shape
 * five times, once per dimension key, so every enum, union, array and string
 * inside it was compiled five times over. The provider's grammar budget is
 * internal and unpublished, so this is measured rather than predicted (see
 * `src/modules/ai/probe/`).
 *
 * The response is therefore an **array of dimension assessments with the item
 * shape declared once**, and `dimension` moves inside the item as an enum.
 * That is a change of wire format only:
 *
 *   provider JSON → normalizeAnthropicAuditOutput → validateAuditOutput
 *                 → deterministic scoring → business-readiness-audit.v1
 *
 * `business-readiness-audit.v1` is unchanged, and nothing in this file is
 * persisted. Provider-shaped data stops here so a transport constraint cannot
 * leak into the product's domain model.
 *
 * What moved from grammar enforcement to application enforcement: "exactly
 * these five dimension keys, each present exactly once". A keyed object made
 * the provider enforce that; an array cannot. It is enforced below instead,
 * with the same closed-set vocabulary the rest of the pipeline uses — and it
 * was never the authoritative layer anyway, since a keyed object still could
 * not stop the model from emitting a wrong *value*.
 *
 * Written to the structured-outputs subset: every object sets
 * `additionalProperties: false` and lists all properties as `required`, and
 * no numeric or string-length constraints are used (unsupported). Value
 * ranges and list caps are enforced in `validate.ts`.
 *
 * There is deliberately still no `overall` field: the model is never given
 * the opportunity to invent a headline number (Sprint 4 §7).
 */

const DIMENSION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    dimension: {
      type: "string",
      enum: [...AUDIT_DIMENSIONS],
      description: "Which dimension this entry assesses. Include each dimension exactly once.",
    },
    assessmentStatus: {
      type: "string",
      enum: ["assessable", "partial", "insufficient_evidence"],
      description: "Decide this before scoring. Missing evidence lowers this, never the score.",
    },
    score: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "0-100, or null. MUST be null when assessmentStatus is insufficient_evidence.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string", description: "One to three plain sentences describing the current state." },
    strengths: { type: "array", items: { type: "string" }, description: "At most 4 short phrases." },
    gaps: { type: "array", items: { type: "string" }, description: "At most 4 short phrases." },
    unknowns: {
      type: "array",
      items: { type: "string" },
      description: "What could not be determined from the evidence. At most 4 short phrases.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description: "Evidence ids from the pack that justify this assessment. Never invent ids.",
    },
  },
  required: [
    "dimension",
    "assessmentStatus",
    "score",
    "confidence",
    "summary",
    "strengths",
    "gaps",
    "unknowns",
    "evidenceIds",
  ],
  additionalProperties: false,
} as const;

/**
 * One synthesized business conclusion (CORE-2a.1).
 *
 * Declared **once** and used for strengths and blockers alike, with `tone`
 * deciding which it is. Two separate arrays would serialize this shape twice
 * and compile it twice, which is the grammar-size problem Sprint 4 already paid
 * for — see the note at the top of this file.
 *
 * `keyFindings` was removed in the same change rather than kept alongside.
 * A key finding *was* a cross-cutting conclusion; asking for both would spend
 * grammar and tokens on the model saying the same thing twice, in two shapes,
 * with only one of them subject to the cardinality and grounding rules.
 */
const CONCLUSION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One plain sentence a non-technical founder understands, written to them. No jargon.",
    },
    explanation: {
      type: "string",
      description: "One or two sentences on what was actually found. Plain language.",
    },
    whyItMatters: {
      // A plain string rather than `anyOf: [string, null]`, and that is a
      // grammar decision, not a modelling one. The union would be the second
      // `anyOf` in this schema, and the compiled-grammar budget is the reason
      // this file exists at all (see the header). An empty string means "no
      // commercial note", and `cleanText` already maps empty to null on the way
      // into the domain — so the domain type keeps its honest `string | null`.
      type: "string",
      description:
        "Why this matters commercially. Usually set for a blocker. Return an empty string when there is nothing worth adding.",
    },
    tone: {
      type: "string",
      enum: [...CONCLUSION_TONES],
      description:
        "positive = something the business already has. attention/critical = something holding it back.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    dimensions: {
      type: "array",
      items: { type: "string", enum: [...AUDIT_DIMENSIONS] },
      description: "Which dimensions this conclusion touches. More than one is expected and correct.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Every evidence id this conclusion rests on. At least one, and often several — grouping related evidence is the point. Never invent an id.",
    },
  },
  required: [
    "headline",
    "explanation",
    "whyItMatters",
    "tone",
    "confidence",
    "dimensions",
    "evidenceIds",
  ],
  additionalProperties: false,
} as const;

export const ANTHROPIC_AUDIT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    dimensions: {
      type: "array",
      description: `One entry per dimension, exactly ${AUDIT_DIMENSIONS.length}: ${AUDIT_DIMENSIONS.join(", ")}. No duplicates.`,
      items: DIMENSION_ITEM_SCHEMA,
    },
    overallConclusion: {
      type: "string",
      description:
        "One concise sentence about the business as a whole, grounded in the assessment. Not generic encouragement.",
    },
    conclusions: {
      type: "array",
      description:
        "The synthesis. 2-4 positive conclusions and AT MOST 3 negative ones (tone attention or critical). Group related evidence into one conclusion rather than listing each observation. Return fewer if fewer are justified; never pad to a count.",
      items: CONCLUSION_ITEM_SCHEMA,
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      description: "What this audit could not assess and why. At most 5 short phrases.",
    },
  },
  required: ["dimensions", "overallConclusion", "conclusions", "limitations"],
  additionalProperties: false,
};

/**
 * Why normalization rejected the provider's JSON, as a bounded code.
 *
 * Same discipline as `ValidationReason`: schema field names and dimension ids
 * only, never model content, because the value is persisted in the audit log.
 * The dimension arm is derived from `AUDIT_DIMENSIONS` so adding a dimension
 * cannot silently skip its check.
 */
export type WireNormalizationReason =
  | "response_not_object"
  | "dimensions_not_array"
  | "dimension_entry_not_object"
  | "dimension_unknown"
  | "dimension_duplicate"
  | `dimension_missing_${AuditDimensionId}`;

export type NormalizeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: WireNormalizationReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KNOWN_DIMENSIONS = new Set<string>(AUDIT_DIMENSIONS);

/**
 * Converts the transport array into the dimension-keyed object the domain
 * validator consumes, enforcing the guarantees the array form gave up.
 *
 * Rejects rather than repairs: a response missing a dimension, naming an
 * unknown one, or repeating one is a failed audit, not something to paper
 * over with a default. Silently inventing an absent dimension would fabricate
 * a result, which is the one thing the audit must never do.
 */
export function normalizeAnthropicAuditOutput(data: unknown): NormalizeResult {
  if (!isRecord(data)) return { ok: false, reason: "response_not_object" };
  if (!Array.isArray(data.dimensions)) return { ok: false, reason: "dimensions_not_array" };

  const byId: Record<string, unknown> = {};

  for (const entry of data.dimensions) {
    if (!isRecord(entry)) return { ok: false, reason: "dimension_entry_not_object" };

    const id = entry.dimension;
    if (typeof id !== "string" || !KNOWN_DIMENSIONS.has(id)) {
      return { ok: false, reason: "dimension_unknown" };
    }
    if (id in byId) return { ok: false, reason: "dimension_duplicate" };

    // `dimension` is the transport's routing key, not part of the assessment;
    // the domain model carries `id` and `label`, both set by the validator.
    // Copied field-by-field rather than rest-spread so the routing key cannot
    // ride along into the domain payload.
    const assessment: Record<string, unknown> = { ...entry };
    delete assessment.dimension;
    byId[id] = assessment;
  }

  for (const id of AUDIT_DIMENSIONS) {
    if (!(id in byId)) return { ok: false, reason: `dimension_missing_${id}` };
  }

  return {
    ok: true,
    data: {
      dimensions: byId,
      overallConclusion: data.overallConclusion,
      conclusions: data.conclusions,
      limitations: data.limitations,
    },
  };
}
