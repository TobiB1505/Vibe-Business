import { ANTHROPIC_AUDIT_OUTPUT_SCHEMA } from "@/modules/business-audit/wire-schema";
import { AUDIT_DIMENSIONS } from "@/modules/business-audit/schema";

/**
 * Candidate output schemas for the grammar compile probe. **Dev-only** —
 * nothing in production imports this file.
 *
 * The reduction sequence is deliberately ordered least-invasive first, and the
 * probe stops at the first candidate that compiles. Simplifying further
 * without a measured reason would trade real domain guarantees for nothing.
 */

const KEY_FINDINGS_SCHEMA = {
  type: "array",
  description: "At most 5 cross-cutting findings, each grounded in cited evidence.",
  items: {
    type: "object",
    properties: {
      finding: { type: "string" },
      evidenceIds: { type: "array", items: { type: "string" } },
    },
    required: ["finding", "evidenceIds"],
    additionalProperties: false,
  },
} as const;

const LIMITATIONS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  description: "What this audit could not assess and why. At most 5 short phrases.",
} as const;

/**
 * BASELINE — a frozen copy of the schema that production sent when the
 * provider replied "the compiled grammar is too large" (`req_011CdwEyahFVgLpqzLEDPgW3`).
 *
 * Copied rather than imported because production no longer contains it. It
 * exists so the baseline can be *measured and re-probed* instead of asserted;
 * no test hard-codes the assumption that it is over the limit.
 */
const BASELINE_DIMENSION_SCHEMA = {
  type: "object",
  properties: {
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
  required: ["assessmentStatus", "score", "confidence", "summary", "strengths", "gaps", "unknowns", "evidenceIds"],
  additionalProperties: false,
} as const;

export const BASELINE_AUDIT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    dimensions: {
      type: "object",
      properties: Object.fromEntries(
        AUDIT_DIMENSIONS.map((dimension) => [dimension, BASELINE_DIMENSION_SCHEMA]),
      ),
      required: [...AUDIT_DIMENSIONS],
      additionalProperties: false,
    },
    keyFindings: KEY_FINDINGS_SCHEMA,
    limitations: LIMITATIONS_SCHEMA,
  },
  required: ["dimensions", "keyFindings", "limitations"],
  additionalProperties: false,
};

/**
 * CANDIDATE B — collapses `strengths` / `gaps` / `unknowns` into one
 * `findings` array discriminated by `kind`. Three array-of-string shapes per
 * dimension become one array-of-object shape.
 *
 * Only probed if A fails; it costs a normalization step to rebuild the three
 * domain lists, so it is not adopted without a measured reason.
 */
const CANDIDATE_B_ITEM = {
  type: "object",
  properties: {
    dimension: { type: "string", enum: [...AUDIT_DIMENSIONS] },
    assessmentStatus: { type: "string", enum: ["assessable", "partial", "insufficient_evidence"] },
    score: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "0-100, or null. MUST be null when assessmentStatus is insufficient_evidence.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string", description: "One to three plain sentences." },
    findings: {
      type: "array",
      description: "At most 4 per kind. kind is strength, gap or unknown.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["strength", "gap", "unknown"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["dimension", "assessmentStatus", "score", "confidence", "summary", "findings", "evidenceIds"],
  additionalProperties: false,
} as const;

export const CANDIDATE_B_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    dimensions: { type: "array", items: CANDIDATE_B_ITEM },
    keyFindings: KEY_FINDINGS_SCHEMA,
    limitations: LIMITATIONS_SCHEMA,
  },
  required: ["dimensions", "keyFindings", "limitations"],
  additionalProperties: false,
};

/**
 * CANDIDATE C — B with the two least critical enumerations (`confidence`,
 * finding `kind`) demoted to plain strings, validated in the application
 * instead. `dimension` and `assessmentStatus` keep their enums: they are the
 * routing key and the unknown-vs-scored invariant respectively.
 *
 * Only probed if B fails. Adopting it means documenting exactly which
 * guarantees moved out of the grammar.
 */
const CANDIDATE_C_ITEM = {
  ...CANDIDATE_B_ITEM,
  properties: {
    ...CANDIDATE_B_ITEM.properties,
    confidence: { type: "string", description: "high, medium or low." },
    findings: {
      type: "array",
      description: "At most 4 per kind.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", description: "strength, gap or unknown." },
          text: { type: "string" },
        },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
  },
} as const;

export const CANDIDATE_C_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    dimensions: { type: "array", items: CANDIDATE_C_ITEM },
    keyFindings: KEY_FINDINGS_SCHEMA,
    limitations: LIMITATIONS_SCHEMA,
  },
  required: ["dimensions", "keyFindings", "limitations"],
  additionalProperties: false,
};

export type SchemaCandidate = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

/**
 * Probe order. `baseline` is measured first to confirm the failure still
 * reproduces; `A` is the intended production shape and is what production
 * currently sends.
 */
export const SCHEMA_CANDIDATES: SchemaCandidate[] = [
  {
    name: "baseline",
    description: "Rejected production schema: dimension shape declared 5×, once per key",
    schema: BASELINE_AUDIT_OUTPUT_SCHEMA,
  },
  {
    name: "A",
    description: "Dimension array, item shape declared once (current production wire schema)",
    schema: ANTHROPIC_AUDIT_OUTPUT_SCHEMA,
  },
  {
    name: "B",
    description: "A + strengths/gaps/unknowns collapsed into one discriminated findings array",
    schema: CANDIDATE_B_SCHEMA,
  },
  {
    name: "C",
    description: "B + confidence and finding kind demoted from enum to string",
    schema: CANDIDATE_C_SCHEMA,
  },
];
