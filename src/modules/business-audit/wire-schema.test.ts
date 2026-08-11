import { describe, expect, it } from "vitest";

import { AUDIT_DIMENSIONS } from "./schema";
import { ANTHROPIC_AUDIT_OUTPUT_SCHEMA, normalizeAnthropicAuditOutput } from "./wire-schema";
import { validateAuditOutput } from "./validate";
import { measureSchema } from "@/modules/ai/probe/schema-metrics";

/** A complete, well-formed wire response. */
function wireDimension(dimension: string, overrides: Record<string, unknown> = {}) {
  return {
    dimension,
    assessmentStatus: "assessable",
    score: 60,
    confidence: "medium",
    summary: `Summary for ${dimension}.`,
    strengths: ["a strength"],
    gaps: ["a gap"],
    unknowns: [],
    evidenceIds: ["repo:1"],
    ...overrides,
  };
}

function wireResponse(overrides: Record<string, unknown> = {}) {
  return {
    dimensions: AUDIT_DIMENSIONS.map((dimension) => wireDimension(dimension)),
    keyFindings: [{ finding: "A cross-cutting finding.", evidenceIds: ["repo:1"] }],
    limitations: ["One limitation."],
    ...overrides,
  };
}

describe("ANTHROPIC_AUDIT_OUTPUT_SCHEMA", () => {
  it("declares the dimension assessment shape exactly once", () => {
    const metrics = measureSchema(ANTHROPIC_AUDIT_OUTPUT_SCHEMA);
    // Root, the single dimension item, and the key-finding item.
    expect(metrics.objectCount).toBe(3);
    // One per dimension key would be 5.
    expect(metrics.unionCount).toBe(1);
  });

  it("keeps the structured-outputs subset: every object closed, every property required", () => {
    const metrics = measureSchema(ANTHROPIC_AUDIT_OUTPUT_SCHEMA);
    expect(metrics.objectsMissingAdditionalPropertiesFalse).toBe(0);
    expect(metrics.optionalPropertyCount).toBe(0);
  });

  it("still gives the model no field for an overall score", () => {
    const serialized = JSON.stringify(ANTHROPIC_AUDIT_OUTPUT_SCHEMA);
    expect(serialized).not.toContain("overall");
    expect(serialized).not.toContain("totalScore");
  });

  it("enumerates the dimension ids from the domain, not a duplicate list", () => {
    const dimensions = ANTHROPIC_AUDIT_OUTPUT_SCHEMA.properties as Record<string, never>;
    const item = (dimensions.dimensions as { items: { properties: Record<string, { enum?: string[] }> } })
      .items;
    expect(item.properties.dimension!.enum).toEqual([...AUDIT_DIMENSIONS]);
  });
});

describe("normalizeAnthropicAuditOutput", () => {
  it("converts the array form into the dimension-keyed domain shape", () => {
    const result = normalizeAnthropicAuditOutput(wireResponse());
    expect(result.ok).toBe(true);

    const data = (result as { ok: true; data: Record<string, unknown> }).data;
    const dimensions = data.dimensions as Record<string, Record<string, unknown>>;
    expect(Object.keys(dimensions).sort()).toEqual([...AUDIT_DIMENSIONS].sort());
    expect(dimensions.product!.summary).toBe("Summary for product.");
    // The routing key is not part of the assessment; the validator sets id/label.
    expect(dimensions.product).not.toHaveProperty("dimension");
    expect(data.keyFindings).toHaveLength(1);
    expect(data.limitations).toEqual(["One limitation."]);
  });

  it("requires exactly five dimensions — a missing one is rejected by name", () => {
    const response = wireResponse({
      dimensions: AUDIT_DIMENSIONS.filter((d) => d !== "retention").map((d) => wireDimension(d)),
    });
    expect(normalizeAnthropicAuditOutput(response)).toEqual({
      ok: false,
      reason: "dimension_missing_retention",
    });
  });

  it("rejects a duplicated dimension rather than letting one silently win", () => {
    const response = wireResponse({
      dimensions: [...AUDIT_DIMENSIONS.map((d) => wireDimension(d)), wireDimension("product")],
    });
    expect(normalizeAnthropicAuditOutput(response)).toEqual({
      ok: false,
      reason: "dimension_duplicate",
    });
  });

  it("rejects an unknown dimension", () => {
    const response = wireResponse({
      dimensions: [...AUDIT_DIMENSIONS.map((d) => wireDimension(d)), wireDimension("growth")],
    });
    expect(normalizeAnthropicAuditOutput(response)).toEqual({
      ok: false,
      reason: "dimension_unknown",
    });
  });

  it("rejects malformed envelopes with bounded reasons", () => {
    expect(normalizeAnthropicAuditOutput(null)).toEqual({ ok: false, reason: "response_not_object" });
    expect(normalizeAnthropicAuditOutput([])).toEqual({ ok: false, reason: "response_not_object" });
    expect(normalizeAnthropicAuditOutput({ dimensions: {} })).toEqual({
      ok: false,
      reason: "dimensions_not_array",
    });
    expect(normalizeAnthropicAuditOutput({ dimensions: ["product"] })).toEqual({
      ok: false,
      reason: "dimension_entry_not_object",
    });
  });

  it("carries no model content in a rejection reason", () => {
    const response = wireResponse({
      dimensions: [wireDimension("growth", { summary: "MODEL PROSE HERE" })],
    });
    const result = normalizeAnthropicAuditOutput(response);
    expect(JSON.stringify(result)).not.toContain("MODEL PROSE HERE");
  });
});

describe("wire → domain, end to end", () => {
  const knownEvidence = new Set(["repo:1", "web:2"]);

  it("normalizes then validates into five domain assessments", () => {
    const normalized = normalizeAnthropicAuditOutput(wireResponse());
    expect(normalized.ok).toBe(true);

    const validated = validateAuditOutput(
      (normalized as { ok: true; data: Record<string, unknown> }).data,
      knownEvidence,
    );
    expect(validated.ok).toBe(true);

    const audit = (validated as { ok: true; audit: { dimensions: { id: string; label: string }[] } }).audit;
    expect(audit.dimensions.map((d) => d.id)).toEqual([...AUDIT_DIMENSIONS]);
    // id and label come from the domain, never from the wire payload.
    expect(audit.dimensions[0]!.label).toBe("Product");
  });

  it("preserves a null score through the transport", () => {
    const normalized = normalizeAnthropicAuditOutput(
      wireResponse({
        dimensions: AUDIT_DIMENSIONS.map((d) =>
          d === "retention"
            ? wireDimension(d, { assessmentStatus: "insufficient_evidence", score: null })
            : wireDimension(d),
        ),
      }),
    );

    const validated = validateAuditOutput(
      (normalized as { ok: true; data: Record<string, unknown> }).data,
      knownEvidence,
    );
    const audit = (validated as {
      ok: true;
      audit: { dimensions: { id: string; score: number | null; assessmentStatus: string }[] };
    }).audit;

    const retention = audit.dimensions.find((d) => d.id === "retention")!;
    expect(retention.score).toBeNull();
    expect(retention.assessmentStatus).toBe("insufficient_evidence");
  });

  it("forces a null score when the model scores an insufficient_evidence dimension", () => {
    const normalized = normalizeAnthropicAuditOutput(
      wireResponse({
        dimensions: AUDIT_DIMENSIONS.map((d) =>
          d === "monetization"
            ? wireDimension(d, { assessmentStatus: "insufficient_evidence", score: 70 })
            : wireDimension(d),
        ),
      }),
    );

    const validated = validateAuditOutput(
      (normalized as { ok: true; data: Record<string, unknown> }).data,
      knownEvidence,
    );
    const audit = (validated as {
      ok: true;
      audit: { dimensions: { id: string; score: number | null }[] };
    }).audit;

    expect(audit.dimensions.find((d) => d.id === "monetization")!.score).toBeNull();
  });

  it("still validates evidence ids after normalization", () => {
    const normalized = normalizeAnthropicAuditOutput(
      wireResponse({
        dimensions: AUDIT_DIMENSIONS.map((d) =>
          wireDimension(d, { evidenceIds: ["repo:1", "hallucinated:99"] }),
        ),
      }),
    );

    const validated = validateAuditOutput(
      (normalized as { ok: true; data: Record<string, unknown> }).data,
      knownEvidence,
    );
    const audit = (validated as {
      ok: true;
      audit: { dimensions: { evidenceIds: string[] }[]; notes: string[] };
    }).audit;

    expect(audit.dimensions[0]!.evidenceIds).toEqual(["repo:1"]);
    expect(audit.notes.join(" ")).toContain("did not exist in the evidence pack");
  });
});
