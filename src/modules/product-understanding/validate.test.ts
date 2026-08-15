import { describe, expect, it } from "vitest";
import { validateField, validateUnderstanding } from "./validate";
import { normalizeUnderstandingOutput, SYNTHESIS_FIELDS } from "./wire-schema";
import { buildModelOutput } from "./test-support";

/** Every id the default fixture cites, so the base case drops nothing. */
const KNOWN = new Set([
  "live.meta.title",
  "live.meta.description",
  "live.heading.0",
  "live.surface.signup",
  "repo.framework.nextjs",
  "repo.surface.dashboard_app",
]);

function normalized(overrides: Parameters<typeof buildModelOutput>[0] = {}, extras: Parameters<typeof buildModelOutput>[1] = {}) {
  const result = normalizeUnderstandingOutput(buildModelOutput(overrides, extras));
  if (!result.ok) throw new Error(`fixture did not normalize: ${result.reason}`);
  return result.data;
}

describe("wire normalization", () => {
  it("turns the array form into a keyed shape", () => {
    const result = normalizeUnderstandingOutput(buildModelOutput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data.fields).sort()).toEqual([...SYNTHESIS_FIELDS].sort());
  });

  it("rejects a response missing a field, naming which one", () => {
    const raw = buildModelOutput() as { fields: { field: string }[] };
    raw.fields = raw.fields.filter((entry) => entry.field !== "understanding");

    const result = normalizeUnderstandingOutput(raw);
    expect(result).toEqual({ ok: false, reason: "field_missing_understanding" });
  });

  it("rejects a response that is not an object", () => {
    expect(normalizeUnderstandingOutput("a paragraph of prose")).toEqual({
      ok: false,
      reason: "response_not_object",
    });
  });

  it("ignores a field outside the closed vocabulary", () => {
    const raw = buildModelOutput() as { fields: unknown[] };
    raw.fields.push({ field: "secretBackdoor", value: "x", confidence: "confirmed", evidenceIds: [] });

    const result = normalizeUnderstandingOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("secretBackdoor" in result.data.fields).toBe(false);
  });

  it("keeps the first entry when a field is duplicated, deterministically", () => {
    const raw = buildModelOutput() as { fields: { field: string; value: unknown }[] };
    raw.fields.unshift({ field: "name", value: "First", confidence: "likely", evidenceIds: [] } as never);

    const result = normalizeUnderstandingOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fields.name.value).toBe("First");
  });
});

describe("confidence cannot be claimed without evidence", () => {
  it("demotes a confirmed claim that cites nothing, and drops its value", () => {
    const { field } = validateField(
      { field: "primaryAudience", value: "Restaurant owners", confidence: "confirmed", evidenceIds: [] },
      KNOWN,
    );

    expect(field).toEqual({
      value: null,
      confidence: "unclear",
      sources: ["ai_inferred"],
      evidence: [],
    });
  });

  it("demotes a confirmed claim whose every citation is invented", () => {
    const { field, dropped } = validateField(
      {
        field: "primaryAudience",
        value: "Restaurant owners",
        confidence: "confirmed",
        evidenceIds: ["live.surface.restaurants", "made.up.id"],
      },
      KNOWN,
    );

    expect(dropped).toBe(2);
    expect(field.value).toBeNull();
    expect(field.confidence).toBe("unclear");
  });

  it("keeps a claim that cites real evidence, and attributes it to that source", () => {
    const { field } = validateField(
      { field: "name", value: "Acme", confidence: "confirmed", evidenceIds: ["live.meta.title"] },
      KNOWN,
    );

    expect(field).toEqual({
      value: "Acme",
      confidence: "confirmed",
      sources: ["live_product"],
      evidence: ["live.meta.title"],
    });
  });

  it("drops the value when the model itself says unclear", () => {
    const { field } = validateField(
      { field: "useCase", value: "Probably scheduling", confidence: "unclear", evidenceIds: ["live.meta.title"] },
      KNOWN,
    );

    expect(field.value).toBeNull();
    expect(field.confidence).toBe("unclear");
  });

  it("treats a hedge as an absent value rather than an answer", () => {
    for (const hedge of ["unknown", "N/A", "not specified", "TBD", "-"]) {
      const { field } = validateField(
        { field: "userType", value: hedge, confidence: "likely", evidenceIds: ["live.meta.title"] },
        KNOWN,
      );
      expect(field.value, hedge).toBeNull();
    }
  });

  it("does not treat the word unknown inside a sentence as a hedge", () => {
    const { field } = validateField(
      {
        field: "understanding",
        value: "You've built a tool whose audience is currently unknown to its own analytics.",
        confidence: "likely",
        evidenceIds: ["live.meta.title"],
      },
      KNOWN,
    );

    expect(field.value).not.toBeNull();
  });

  it("refuses an oversized value rather than storing a pasted document", () => {
    const { field } = validateField(
      { field: "understanding", value: "x".repeat(5_000), confidence: "likely", evidenceIds: ["live.meta.title"] },
      KNOWN,
    );

    expect(field.value).toBeNull();
  });
});

describe("validateUnderstanding", () => {
  it("accepts a well-formed response and records nothing dropped", () => {
    const result = validateUnderstanding(normalized(), KNOWN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.fields.name.value).toBe("Acme");
    expect(result.understanding.notes).toEqual([]);
  });

  it("counts discarded citations in a note the user's limitations can carry", () => {
    const result = validateUnderstanding(
      normalized({ name: { evidenceIds: ["invented.one", "invented.two"] } }),
      KNOWN,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.notes[0]).toContain("2 evidence citation(s) did not resolve");
  });

  it("refuses a response where nothing survived", () => {
    const empty = Object.fromEntries(
      SYNTHESIS_FIELDS.map((field) => [field, { value: null, confidence: "not_found", evidenceIds: [] }]),
    );

    const result = validateUnderstanding(normalized(empty as never), KNOWN);
    expect(result).toEqual({
      ok: false,
      error: "structured_output_schema_invalid",
      reason: "no_field_survived_validation",
    });
  });

  it("refuses a response with no understanding and no short description", () => {
    const result = validateUnderstanding(
      normalized({
        understanding: { value: null, confidence: "not_found", evidenceIds: [] },
        shortDescription: { value: null, confidence: "not_found", evidenceIds: [] },
      }),
      KNOWN,
    );

    expect(result).toEqual({
      ok: false,
      error: "structured_output_schema_invalid",
      reason: "understanding_missing",
    });
  });

  it("drops a capability outside the closed vocabulary", () => {
    const result = validateUnderstanding(
      normalized({}, {
        primaryCapabilities: [
          { capability: "create_account", evidenceIds: [] },
          { capability: "launch_rockets", evidenceIds: [] },
        ],
      }),
      KNOWN,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.rankedCapabilities.map((entry) => entry.id)).toEqual([
      "create_account",
    ]);
  });

  it("falls back to unclear for a category outside the closed vocabulary", () => {
    const result = validateUnderstanding(normalized({}, { category: "world_domination" }), KNOWN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.category).toMatchObject({ value: null, confidence: "unclear" });
  });

  it("caps limitations and refuses ones that are really documents", () => {
    const result = validateUnderstanding(
      normalized({}, { limitations: ["a", "b", "c", "d", "e", "x".repeat(500)] }),
      KNOWN,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.limitations).toEqual(["a", "b", "c", "d"]);
  });
});
