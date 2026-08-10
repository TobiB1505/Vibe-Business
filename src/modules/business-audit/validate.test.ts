import { describe, expect, it } from "vitest";
import { validateAuditOutput } from "./validate";
import { buildModelOutput } from "./test-support";

const KNOWN = new Set([
  "business.product_summary",
  "business.monetization_model",
  "live.site.title",
  "live.surface.pricing",
  "live.conversion.primary_cta",
]);

function validate(data: unknown) {
  return validateAuditOutput(data, KNOWN);
}

describe("validateAuditOutput — well-formed output", () => {
  it("accepts a valid response and preserves its assessments", () => {
    const result = validate(buildModelOutput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const product = result.audit.dimensions.find((dimension) => dimension.id === "product");
    expect(product?.score).toBe(78);
    expect(product?.assessmentStatus).toBe("assessable");
    expect(result.audit.dimensions).toHaveLength(5);
  });

  it("rejects a response that is not an object", () => {
    for (const value of ["nope", null, []]) {
      const result = validate(value);
      expect(result.ok).toBe(false);
      // A bounded code rather than a sentence: the value is persisted, and
      // prose would eventually carry a fragment of the model's output.
      expect(result.ok === false && result.reason).toBe("response_not_object");
    }
  });

  it("rejects a response with no dimensions object", () => {
    const result = validate({ keyFindings: [], limitations: [] });
    expect(result.ok === false && result.reason).toBe("dimensions_missing");
  });

  it("names which dimension was missing", () => {
    const output = buildModelOutput();
    delete (output.dimensions as Record<string, unknown>).retention;
    const result = validate(output);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("structured_output_schema_invalid");
    expect(result.ok === false && result.reason).toBe("dimension_missing_retention");
  });
});

describe("validateAuditOutput — evidence discipline", () => {
  it("drops hallucinated evidence ids and records that it did", () => {
    const result = validate(
      buildModelOutput({
        product: { evidenceIds: ["business.product_summary", "repo.totally.invented", "live.made.up"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const product = result.audit.dimensions.find((dimension) => dimension.id === "product");
    expect(product?.evidenceIds).toEqual(["business.product_summary"]);
    expect(result.audit.notes.join(" ")).toContain("did not exist in the evidence pack");
  });

  it("demotes a dimension whose evidence was entirely hallucinated", () => {
    // The integrity rule that makes fabricated citations harmless rather
    // than load-bearing: no surviving evidence means no assessment.
    const result = validate(
      buildModelOutput({
        product: { assessmentStatus: "assessable", score: 95, evidenceIds: ["repo.invented.entirely"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const product = result.audit.dimensions.find((dimension) => dimension.id === "product");
    expect(product?.assessmentStatus).toBe("insufficient_evidence");
    expect(product?.score).toBeNull();
    expect(result.audit.notes.join(" ")).toContain("cited no valid evidence");
  });

  it("deduplicates repeated evidence ids", () => {
    const result = validate(
      buildModelOutput({
        product: { evidenceIds: ["live.site.title", "live.site.title", "live.site.title"] },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.dimensions.find((d) => d.id === "product")?.evidenceIds).toEqual(["live.site.title"]);
  });

  it("drops a key finding whose evidence does not exist", () => {
    const result = validate(
      buildModelOutput(
        {},
        {
          keyFindings: [
            { finding: "Grounded finding", evidenceIds: ["live.site.title"] },
            { finding: "Unsupported assertion", evidenceIds: ["not.a.real.id"] },
          ],
        },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.keyFindings).toHaveLength(1);
    expect(result.audit.keyFindings[0].finding).toBe("Grounded finding");
  });
});

describe("validateAuditOutput — unknown stays unknown", () => {
  it("forces a null score when the status is insufficient_evidence", () => {
    // Even if the model contradicts itself, the invariant holds.
    const result = validate(
      buildModelOutput({
        retention: { assessmentStatus: "insufficient_evidence", score: 10, evidenceIds: ["live.site.title"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const retention = result.audit.dimensions.find((dimension) => dimension.id === "retention");
    expect(retention?.score).toBeNull();
  });

  it("never converts a missing score into zero", () => {
    const result = validate(
      buildModelOutput({
        distribution: {
          assessmentStatus: "assessable",
          score: null,
          // Real evidence, so this isolates the missing-score rule rather
          // than tripping the stricter no-evidence demotion first.
          evidenceIds: ["live.site.title"],
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const distribution = result.audit.dimensions.find((dimension) => dimension.id === "distribution");
    expect(distribution?.score).toBeNull();
    expect(distribution?.score).not.toBe(0);
    // A scoreable status with no score is only ever partial.
    expect(distribution?.assessmentStatus).toBe("partial");
  });

  it("preserves a genuine zero score, which means evidenced absence", () => {
    const result = validate(
      buildModelOutput({
        monetization: {
          assessmentStatus: "assessable",
          score: 0,
          evidenceIds: ["live.surface.pricing", "business.monetization_model"],
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.dimensions.find((d) => d.id === "monetization")?.score).toBe(0);
  });
});

describe("validateAuditOutput — range and shape enforcement", () => {
  it("clamps out-of-range scores that the JSON Schema cannot constrain", () => {
    const high = validate(buildModelOutput({ product: { score: 900 } }));
    const low = validate(buildModelOutput({ product: { score: -50 } }));

    expect(high.ok && high.audit.dimensions.find((d) => d.id === "product")?.score).toBe(100);
    expect(low.ok && low.audit.dimensions.find((d) => d.id === "product")?.score).toBe(0);
  });

  it("rounds a fractional score to an integer", () => {
    const result = validate(buildModelOutput({ product: { score: 77.6 } }));
    expect(result.ok && result.audit.dimensions.find((d) => d.id === "product")?.score).toBe(78);
  });

  it("falls back to a safe status and confidence for unrecognised values", () => {
    const result = validate(
      buildModelOutput({ product: { assessmentStatus: "amazing", confidence: "certain" } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const product = result.audit.dimensions.find((dimension) => dimension.id === "product");
    expect(product?.assessmentStatus).toBe("insufficient_evidence");
    expect(product?.confidence).toBe("low");
  });

  it("caps list lengths", () => {
    const result = validate(
      buildModelOutput({
        product: { strengths: Array.from({ length: 20 }, (_, index) => `strength ${index}`) },
      }),
    );
    expect(result.ok && result.audit.dimensions.find((d) => d.id === "product")?.strengths).toHaveLength(4);
  });

  it("supplies a summary when the model omitted one", () => {
    const result = validate(buildModelOutput({ product: { summary: "" } }));
    expect(result.ok && result.audit.dimensions.find((d) => d.id === "product")?.summary).toContain(
      "No summary",
    );
  });
});
