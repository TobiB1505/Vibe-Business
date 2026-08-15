import { CAPABILITY_IDS, CONFIDENCE_LEVELS, PRODUCT_CATEGORIES } from "./schema";

/**
 * The transport representation of a Product Understanding response.
 *
 * Written to the structured-outputs subset the provider accepts, and shaped by
 * the lesson Sprint 4 paid for: a schema that declares the same object shape
 * once per field compiles that shape once per field, and the provider's
 * grammar budget is real, internal, and unpublished.
 *
 * So every attributed field shares **one** item shape, and which field it is
 * moves inside the item as an enum. One `FIELD_ITEM` compiled once, rather
 * than eleven near-identical objects:
 *
 *   provider JSON → normalizeUnderstandingOutput → validateUnderstanding
 *                 → assemble → product-profile.v1
 *
 * Nothing in this file is persisted. Provider-shaped data stops here.
 *
 * Every object sets `additionalProperties: false` and lists all properties as
 * `required`; no string-length or numeric constraints are used, since the
 * subset does not support them. Lengths and list caps are enforced in
 * `validate.ts`.
 */

/** The attributed fields the model fills. Order is the order they are asked for. */
export const SYNTHESIS_FIELDS = [
  "name",
  "shortDescription",
  "understanding",
  "mainPurpose",
  "mainPromise",
  "primaryAudience",
  "userType",
  "problemSolved",
  "useCase",
  "tone",
  "positioningLine",
] as const;

export type SynthesisField = (typeof SYNTHESIS_FIELDS)[number];

const FIELD_ITEM_SCHEMA = {
  type: "object",
  properties: {
    field: {
      type: "string",
      enum: [...SYNTHESIS_FIELDS],
      description: "Which field this entry answers. Include each field exactly once.",
    },
    value: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "The answer, or null. MUST be null when confidence is unclear or not_found. Never the word 'unknown'.",
    },
    confidence: {
      type: "string",
      enum: [...CONFIDENCE_LEVELS],
      description: "How well the evidence supports this value. not_found is a valid, useful answer.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description: "Evidence ids from the pack that justify this value. Never invent an id.",
    },
  },
  required: ["field", "value", "confidence", "evidenceIds"],
  additionalProperties: false,
} as const;

const CAPABILITY_ITEM_SCHEMA = {
  type: "object",
  properties: {
    capability: {
      type: "string",
      enum: [...CAPABILITY_IDS],
      description: "A capability from the closed list. Nothing outside it is valid.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description: "Evidence ids supporting that a person can do this.",
    },
  },
  required: ["capability", "evidenceIds"],
  additionalProperties: false,
} as const;

export const PRODUCT_UNDERSTANDING_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: FIELD_ITEM_SCHEMA,
      description: "One entry per field, each field exactly once.",
    },
    category: {
      type: "string",
      enum: [...PRODUCT_CATEGORIES],
      description: "The single closest category for this product.",
    },
    categoryConfidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    categoryEvidenceIds: { type: "array", items: { type: "string" } },
    primaryCapabilities: {
      type: "array",
      items: CAPABILITY_ITEM_SCHEMA,
      description: "The most important capabilities, most important first. At most 8.",
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      description:
        "What could not be established, in plain language a founder would read. At most 4 short sentences.",
    },
  },
  required: [
    "fields",
    "category",
    "categoryConfidence",
    "categoryEvidenceIds",
    "primaryCapabilities",
    "limitations",
  ],
  additionalProperties: false,
} as const;

/**
 * Why normalization rejected the response, as a bounded code.
 *
 * Codes name schema fields only — never model content — so they are safe to
 * persist and log. Derived from `SYNTHESIS_FIELDS`, so a field added later
 * cannot be forgotten here.
 */
export type WireNormalizationReason =
  | "response_not_object"
  | "fields_not_array"
  | "capabilities_not_array"
  | `field_missing_${SynthesisField}`;

export type NormalizedField = {
  field: SynthesisField;
  value: unknown;
  confidence: unknown;
  evidenceIds: unknown;
};

export type NormalizedUnderstanding = {
  fields: Record<SynthesisField, NormalizedField>;
  category: unknown;
  categoryConfidence: unknown;
  categoryEvidenceIds: unknown;
  primaryCapabilities: unknown[];
  limitations: unknown;
};

export type NormalizeResult =
  | { ok: true; data: NormalizedUnderstanding }
  | { ok: false; reason: WireNormalizationReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns the provider's array form back into a keyed shape, enforcing the
 * guarantees the array gave up: every field present, each exactly once, none
 * unknown.
 *
 * A duplicate field keeps the **first** entry rather than the last. Either
 * choice is arbitrary; being deterministic about it is not, because two runs
 * of the same input must produce the same profile.
 */
export function normalizeUnderstandingOutput(raw: unknown): NormalizeResult {
  if (!isRecord(raw)) return { ok: false, reason: "response_not_object" };
  if (!Array.isArray(raw.fields)) return { ok: false, reason: "fields_not_array" };
  if (!Array.isArray(raw.primaryCapabilities)) {
    return { ok: false, reason: "capabilities_not_array" };
  }

  const fields = {} as Record<SynthesisField, NormalizedField>;

  for (const entry of raw.fields) {
    if (!isRecord(entry)) continue;
    const name = entry.field;
    if (typeof name !== "string") continue;
    if (!SYNTHESIS_FIELDS.includes(name as SynthesisField)) continue;
    const field = name as SynthesisField;
    if (field in fields) continue;
    fields[field] = {
      field,
      value: entry.value,
      confidence: entry.confidence,
      evidenceIds: entry.evidenceIds,
    };
  }

  for (const field of SYNTHESIS_FIELDS) {
    if (!(field in fields)) return { ok: false, reason: `field_missing_${field}` };
  }

  return {
    ok: true,
    data: {
      fields,
      category: raw.category,
      categoryConfidence: raw.categoryConfidence,
      categoryEvidenceIds: raw.categoryEvidenceIds,
      primaryCapabilities: raw.primaryCapabilities,
      limitations: raw.limitations,
    },
  };
}
