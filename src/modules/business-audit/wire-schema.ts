import {
  AUDIT_DIMENSIONS,
  BUSINESS_LENSES,
  CONCLUSION_TONES,
  LENS_HEALTH,
  LENS_MATERIALITY,
  type AuditDimensionId,
} from "./schema";

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
    // Generated FIRST, and internal (CORE-2a.3.2 §11–§13). One sentence naming
    // the underlying business problem, before any founder-facing prose exists
    // to be anchored on. A separate `RootBusinessProblem` object was considered
    // and rejected: §11 permits reusing an existing structure, a conclusion
    // already carries the lenses and evidence a root problem would, and a fifth
    // object shape costs compiled grammar this file exists to conserve.
    rootProblem: {
      type: "string",
      description:
        "INTERNAL, never shown. The underlying business problem in one sentence — the decision or gap itself, not what a scanner failed to find. 'The business has not decided what customers pay for or how usage becomes price', not 'no pricing or checkout exists'. Write this before the headline.",
    },
    headline: {
      type: "string",
      description:
        "One plain sentence a non-technical founder understands, written to them. No jargon.",
    },
    explanation: {
      type: "string",
      description:
        "One or two sentences that TRANSLATE the rootProblem above into the founder's own words. Not a second analysis: say the same thing at the same level, warmer and more concrete. It must still be recognisably the rootProblem — if it makes a point the rootProblem does not make, one of them is wrong. Listing what was not detected belongs in evidenceIds, never here.",
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
    lenses: {
      type: "array",
      items: { type: "string", enum: [...BUSINESS_LENSES] },
      description:
        "Which reasoning lenses produced this. Most real blockers span several; one lens usually means you found a symptom.",
    },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Every evidence id this conclusion rests on. At least one, and often several — grouping related evidence is the point. Never invent an id.",
    },
  },
  required: [
    "rootProblem",
    "headline",
    "explanation",
    "whyItMatters",
    "tone",
    "confidence",
    "dimensions",
    "lenses",
    "evidenceIds",
  ],
  additionalProperties: false,
} as const;

/**
 * One reasoning lens, assessed (CORE-2a.3).
 *
 * Deliberately lean. This is the audit's working-out, not its output, and every
 * field added here is compiled into the grammar and generated on every run —
 * so it carries its health, its materiality, a short internal note and its
 * grounding, and nothing else. No score: the five dimensions are the scored
 * layer and giving the lenses numbers too would invite the two to disagree.
 *
 * `health` and `materiality` are two fields rather than one because they are
 * two questions (CORE-2a.3.1 §3). When there was only a state enum with no way
 * to say "weak", the model expressed severity through materiality instead, and
 * a prototype's missing privacy policy outranked its undefined revenue model.
 * The descriptions below carry that separation to the model, since the field
 * names alone did not.
 */
const LENS_ITEM_SCHEMA = {
  type: "object",
  properties: {
    lens: { type: "string", enum: [...BUSINESS_LENSES] },
    health: {
      type: "string",
      enum: [...LENS_HEALTH],
      description:
        "How this area of the business ACTUALLY LOOKS. Say weak when it is genuinely poor; unclear means the evidence does not settle it, not that the answer is uncomfortable. Never a statement about priority.",
    },
    materiality: {
      type: "string",
      enum: [...LENS_MATERIALITY],
      description:
        "WHEN this needs attention, independent of how it looks. now blocks the founder's next milestone; soon follows it; later is a real gap whose prerequisites do not exist yet; not_material does not apply to this kind of business. A lens is routinely weak and later at once.",
    },
    summary: {
      type: "string",
      description: "One or two sentences of internal reasoning. Not shown to the founder.",
    },
    evidenceIds: { type: "array", items: { type: "string" } },
    missingContext: {
      type: "array",
      items: { type: "string" },
      description: "What only the founder could tell you. Empty unless the lens is blocked on it.",
    },
  },
  required: ["lens", "health", "materiality", "summary", "evidenceIds", "missingContext"],
  additionalProperties: false,
} as const;

/**
 * The response shape — and its property order is load-bearing (CORE-2a.3.2).
 *
 * ## What the v4 dogfood showed
 *
 * `dimensions` used to come first. The five dimension assessments are the
 * scanner record and are written in technical language on purpose, so the model
 * generated, as the Monetization gaps:
 *
 *   - No pricing surface on the live site or in the repository
 *   - No checkout/billing surface detected anywhere
 *   - No payment integration signal in the repository
 *   - Founder states the monetization model is undecided
 *
 * …and then, with that inventory as the freshest thing in its own context,
 * wrote the customer-facing explanation:
 *
 *   "There's no pricing shown anywhere, no way for a visitor to buy or pay, and
 *    no payment system built into the code — and you've told Vibe directly that
 *    the monetization model isn't decided yet."
 *
 * Four clauses, same four facts, same order, and "monetization model" carried
 * up verbatim. That is not a wording slip; the audit was paraphrasing its own
 * scanner notes because they were the nearest available material.
 *
 * It explains the priority defect too. `monetization` is a dimension scoring
 * 10/100 written at the top of the response — while `audience`, the lens the
 * same audit marked `now`, **is not a dimension at all** and therefore had no
 * numeric presence to compete with it.
 *
 * ## The order now
 *
 * Judgment first, scanner record last:
 *
 *   lenses → overallConclusion → conclusions → dimensions → limitations
 *
 * The model reasons about the business, concludes, and only then writes the
 * technical breakdown. Nothing is deleted: the five dimensions still exist,
 * still score, and still carry their findings. They are just no longer the last
 * thing read before the founder-facing sentence gets written.
 *
 * This costs nothing — one call, same fields — which is the argument for trying
 * it before anything more elaborate.
 */
export const ANTHROPIC_AUDIT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    lenses: {
      type: "array",
      description: `FIRST: assess all ${BUSINESS_LENSES.length} lenses, each exactly once: ${BUSINESS_LENSES.join(", ")}. This is where you work out what the evidence means for the business. Everything below is derived from it.`,
      items: LENS_ITEM_SCHEMA,
    },
    overallConclusion: {
      type: "string",
      description:
        "One concise sentence about the business as a whole, grounded in the lens assessments above. Not generic encouragement.",
    },
    conclusions: {
      type: "array",
      description:
        "The answer, derived from the lenses above. 2-4 positive conclusions and AT MOST 3 negative ones (tone attention or critical). Select the negative ones by materiality: a lens you marked `now` normally outranks one you marked `soon`, and `later` normally stays out. Group related lenses into one root problem rather than listing each observation. Return fewer if fewer are justified; never pad to a count.",
      items: CONCLUSION_ITEM_SCHEMA,
    },
    dimensions: {
      type: "array",
      description: `LAST: the technical breakdown, one entry per dimension, exactly ${AUDIT_DIMENSIONS.length}: ${AUDIT_DIMENSIONS.join(", ")}. No duplicates. This is the scanner record for someone who wants the detail — it is not the source of the conclusions above, which are already written.`,
      items: DIMENSION_ITEM_SCHEMA,
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      description: "What this audit could not assess and why. At most 5 short phrases.",
    },
  },
  required: ["lenses", "overallConclusion", "conclusions", "dimensions", "limitations"],
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
      lenses: data.lenses,
      overallConclusion: data.overallConclusion,
      conclusions: data.conclusions,
      limitations: data.limitations,
    },
  };
}
