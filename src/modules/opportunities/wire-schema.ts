import { AUDIT_DIMENSIONS } from "@/modules/business-audit/schema";
import {
  EXECUTION_READINESS,
  EXECUTION_TYPES,
  MAX_OPPORTUNITIES,
  OPPORTUNITY_CATEGORIES,
} from "./schema";

/**
 * The Anthropic **transport** representation of an opportunity set, and the
 * normalizer back into domain shape (Sprint 8 §20).
 *
 * Compact from the start, learning from Sprint 4: the audit's first schema
 * declared one item shape five times, once per dimension key, and the request
 * was rejected outright — "the compiled grammar is too large". The item shape
 * here is declared **once**, inside a single array, and everything that
 * distinguishes one entry from another is a field within it.
 *
 * Nothing in this file is persisted. Provider-shaped data stops here so a
 * transport constraint cannot leak into the product's domain model.
 *
 * Written to the structured-outputs subset: every object sets
 * `additionalProperties: false` and lists all properties as `required`, and no
 * numeric or string-length constraints are used — those are unsupported, so
 * counts, ranges and caps are enforced in `validate.ts` instead.
 */

const OPPORTUNITY_ITEM_SCHEMA = {
  type: "object",
  properties: {
    rank: {
      type: "integer",
      description: "1 is what to do first. Unique and contiguous across the array. No ties.",
    },
    title: { type: "string", description: "Short imperative phrase, e.g. 'Clarify your monetization path'." },
    problem: { type: "string", description: "One to three sentences describing what is, in the present tense." },
    whyNow: {
      type: "string",
      description: "One to three sentences on why this precedes the alternatives, grounded in this product's evidence.",
    },
    impact: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "How much this could matter if addressed well. Never a guarantee.",
    },
    effort: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Roughly how much work. No hour or day estimates.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Confidence the problem is real and matters now. Independent of impact.",
    },
    category: { type: "string", enum: [...OPPORTUNITY_CATEGORIES] },
    primaryDimension: {
      type: "string",
      enum: [...AUDIT_DIMENSIONS],
      description: "Exactly one readiness dimension this most belongs to.",
    },
    secondaryDimensions: {
      type: "array",
      items: { type: "string", enum: [...AUDIT_DIMENSIONS] },
      description: "At most 2 other dimensions this also touches. May be empty.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description: "Evidence ids from the pack supporting this. Never invent one. At most 6.",
    },
    executionType: { type: "string", enum: [...EXECUTION_TYPES] },
    executionReadiness: {
      type: "string",
      enum: [...EXECUTION_READINESS],
      description: "Be honest: a decision only the founder can make is needs_user_input, never ready.",
    },
    dependencies: {
      type: "array",
      items: { type: "string" },
      description:
        "What must happen first — a founder decision, or 'Opportunity N' referring to a lower rank in this set. At most 3. May be empty.",
    },
  },
  required: [
    "rank",
    "title",
    "problem",
    "whyNow",
    "impact",
    "effort",
    "confidence",
    "category",
    "primaryDimension",
    "secondaryDimensions",
    "evidenceIds",
    "executionType",
    "executionReadiness",
    "dependencies",
  ],
  additionalProperties: false,
};

export const ANTHROPIC_OPPORTUNITY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    opportunities: {
      type: "array",
      description: `3 entries unless the evidence argues otherwise. Never more than ${MAX_OPPORTUNITIES}. Ranked, no ties, no gaps.`,
      items: OPPORTUNITY_ITEM_SCHEMA,
    },
  },
  required: ["opportunities"],
  additionalProperties: false,
};

/** Why a provider response could not be read as an opportunity set at all. */
export type WireNormalizationReason =
  | "not_an_object"
  | "opportunities_not_an_array"
  | "opportunities_empty"
  | "opportunity_not_an_object";

export type WireOpportunity = {
  rank: unknown;
  title: unknown;
  problem: unknown;
  whyNow: unknown;
  impact: unknown;
  effort: unknown;
  confidence: unknown;
  category: unknown;
  primaryDimension: unknown;
  secondaryDimensions: unknown;
  evidenceIds: unknown;
  executionType: unknown;
  executionReadiness: unknown;
  dependencies: unknown;
};

export type NormalizeResult =
  | { ok: true; opportunities: WireOpportunity[] }
  | { ok: false; reason: WireNormalizationReason };

/**
 * Transport → domain shape, before any business rule runs.
 *
 * Only structural: is this an object with a non-empty array of objects? Every
 * value question — valid enums, unique ranks, real evidence ids, duplicates —
 * belongs to `validate.ts`, which is the layer that decides whether a *billed*
 * response is usable.
 */
export function normalizeAnthropicOpportunityOutput(data: unknown): NormalizeResult {
  if (typeof data !== "object" || data === null) return { ok: false, reason: "not_an_object" };

  const raw = (data as { opportunities?: unknown }).opportunities;
  if (!Array.isArray(raw)) return { ok: false, reason: "opportunities_not_an_array" };
  if (raw.length === 0) return { ok: false, reason: "opportunities_empty" };

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "opportunity_not_an_object" };
    }
  }

  return { ok: true, opportunities: raw as WireOpportunity[] };
}
