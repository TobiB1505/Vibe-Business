import { describe, expect, it } from "vitest";

import { BUSINESS_LENSES } from "./schema";
import { ANTHROPIC_AUDIT_OUTPUT_SCHEMA, normalizeAnthropicAuditOutput } from "./wire-schema";
import { validateAuditOutput } from "./validate";
import { measureSchema } from "@/modules/ai/probe/schema-metrics";

/** A complete, well-formed wire response (contract v8: lenses only). */
function wireLens(lens: string, overrides: Record<string, unknown> = {}) {
  return {
    lens,
    health: "adequate",
    score: 60,
    materiality: "soon",
    summary: `Internal reasoning for ${lens}.`,
    evidenceIds: ["repo:1"],
    missingContext: [],
    ...overrides,
  };
}

function wireResponse(overrides: Record<string, unknown> = {}) {
  return {
    lenses: BUSINESS_LENSES.map((lens) => wireLens(lens)),
    overallConclusion: "One sentence about the business.",
    conclusions: [
      {
        rootProblem: "The business has not decided how usage becomes price.",
        headline: "People can start using it.",
        explanation: "Signup and login are reachable.",
        whyItMatters: "",
        tone: "positive",
        confidence: "high",
        lenses: ["offer"],
        evidenceIds: ["repo:1"],
      },
    ],
    limitations: ["One limitation."],
    ...overrides,
  };
}

describe("ANTHROPIC_AUDIT_OUTPUT_SCHEMA", () => {
  it("declares each item shape exactly once", () => {
    const metrics = measureSchema(ANTHROPIC_AUDIT_OUTPUT_SCHEMA);
    /*
     * Three shapes: the lens item, the conclusion item, and the root. The
     * dimension item left with the dimension layer (ADR 0050).
     *
     * The number that matters is not this one — it is that each is declared
     * ONCE. The Sprint 4 failure was five copies of a single shape, one per
     * dimension key, and the guard below on `unionCount` is the other half of
     * the same lesson. Grow this deliberately, not by accident.
     */
    expect(metrics.objectCount).toBe(3);
    // The one union is the lens diagnostic score, integer-or-null, declared
    // once. `whyItMatters` deliberately remains a required string on the wire.
    expect(metrics.unionCount).toBe(1);
  });

  it("keeps the structured-outputs subset: every object closed, every property required", () => {
    const metrics = measureSchema(ANTHROPIC_AUDIT_OUTPUT_SCHEMA);
    expect(metrics.objectsMissingAdditionalPropertiesFalse).toBe(0);
    expect(metrics.optionalPropertyCount).toBe(0);
  });

  it("still gives the model no field for an overall score", () => {
    const serialized = JSON.stringify(ANTHROPIC_AUDIT_OUTPUT_SCHEMA);
    expect(serialized).not.toContain("overallScore");
    expect(serialized).not.toContain("totalScore");

    // CORE-2a.1 added `overallConclusion`, which is a *sentence*. The invariant
    // this test protects is that the model never produces the headline number
    // (Sprint 4 §7, carried into ADR 0050's lens rule), so it is asserted
    // against the field's type rather than against the substring "overall".
    const properties = (ANTHROPIC_AUDIT_OUTPUT_SCHEMA as { properties: Record<string, { type?: string }> })
      .properties;
    expect(properties.overallConclusion.type).toBe("string");
    expect(Object.keys(properties)).not.toContain("score");
  });

  it("enumerates the lens ids from the domain, not a duplicate list", () => {
    const properties = ANTHROPIC_AUDIT_OUTPUT_SCHEMA.properties as Record<string, never>;
    const item = (properties.lenses as { items: { properties: Record<string, { enum?: string[] }> } })
      .items;
    expect(item.properties.lens!.enum).toEqual([...BUSINESS_LENSES]);
  });

  it("carries no dimension block anywhere in the compiled schema", () => {
    // The scanner-language inventory the conclusions used to paraphrase
    // (CORE-2a.3.2) cannot recur if it does not exist in the response at all.
    expect(JSON.stringify(ANTHROPIC_AUDIT_OUTPUT_SCHEMA)).not.toContain('"dimensions"');
  });
});

describe("normalizeAnthropicAuditOutput", () => {
  it("passes the transport object through in the domain shape", () => {
    const result = normalizeAnthropicAuditOutput(wireResponse());
    expect(result.ok).toBe(true);

    const data = (result as { ok: true; data: Record<string, unknown> }).data;
    expect(Array.isArray(data.lenses)).toBe(true);
    expect(data.conclusions).toHaveLength(1);
    expect(data.overallConclusion).toBe("One sentence about the business.");
    expect(data.limitations).toEqual(["One limitation."]);
    expect(data).not.toHaveProperty("dimensions");
  });

  it("rejects a non-object envelope with a bounded reason", () => {
    for (const bad of [null, "text", 42, ["array"]]) {
      const result = normalizeAnthropicAuditOutput(bad);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toBe("response_not_object");
    }
  });
});

describe("wire → domain, end to end", () => {
  const knownEvidence = new Set(["repo:1", "web:2"]);

  function validated(response: Record<string, unknown>) {
    const normalized = normalizeAnthropicAuditOutput(response);
    expect(normalized.ok).toBe(true);
    return validateAuditOutput(
      (normalized as { ok: true; data: Record<string, unknown> }).data,
      knownEvidence,
    );
  }

  it("normalizes then validates into nine lens assessments", () => {
    const result = validated(wireResponse());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.audit.synthesis?.lenses.map((lens) => lens.lens)).toEqual([...BUSINESS_LENSES]);
  });

  it("preserves a null lens score through the transport", () => {
    const result = validated(
      wireResponse({
        lenses: BUSINESS_LENSES.map((lens) =>
          lens === "retention"
            ? wireLens(lens, { health: "unclear", score: null, evidenceIds: [] })
            : wireLens(lens),
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const retention = result.audit.synthesis?.lenses.find((lens) => lens.lens === "retention");
    expect(retention?.score).toBeNull();
    expect(retention?.health).toBe("unclear");
  });

  it("still validates evidence ids after normalization", () => {
    const result = validated(
      wireResponse({
        lenses: BUSINESS_LENSES.map((lens) =>
          wireLens(lens, { evidenceIds: ["repo:1", "hallucinated:99"] }),
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.audit.synthesis?.lenses[0]!.evidenceIds).toEqual(["repo:1"]);
    expect(result.audit.notes.join(" ")).toContain("did not exist in the evidence pack");
  });
});

/**
 * Generation order (CORE-2a.3.2, completed by ADR 0050).
 *
 * The v4 dogfood wrote the Monetization dimension's four gaps and then wrote
 * the customer-facing explanation as those same four facts, in the same order.
 * The fix was ordering — reasoning before prose — and ADR 0050 finished it by
 * removing the scanner-language block from the response entirely.
 *
 * These assertions exist because the ordering is load-bearing and looks
 * arbitrary. Anyone tidying this schema alphabetically would silently weaken
 * the property, and no other test would notice.
 */
describe("judgment is generated before the founder-facing prose", () => {
  const properties = ANTHROPIC_AUDIT_OUTPUT_SCHEMA.properties as Record<string, unknown>;
  const required = ANTHROPIC_AUDIT_OUTPUT_SCHEMA.required as string[];

  it("declares the lens reasoning first", () => {
    expect(Object.keys(properties)).toEqual([
      "lenses",
      "overallConclusion",
      "conclusions",
      "limitations",
    ]);
  });

  /** Both orders are declared; a mismatch would leave the real one ambiguous. */
  it("keeps the required list in the same order as the properties", () => {
    expect(required).toEqual(Object.keys(properties));
  });

  it("asks for the root problem before any founder-facing prose", () => {
    const conclusion = (properties.conclusions as { items: Record<string, unknown> }).items;
    const keys = Object.keys(conclusion.properties as Record<string, unknown>);

    expect(keys.indexOf("rootProblem")).toBe(0);
    expect(keys.indexOf("rootProblem")).toBeLessThan(keys.indexOf("headline"));
    expect(keys.indexOf("headline")).toBeLessThan(keys.indexOf("explanation"));
  });
});
