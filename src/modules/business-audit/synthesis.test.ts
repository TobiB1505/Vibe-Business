import { describe, expect, it } from "vitest";
import {
  MAX_SYNTHESIZED_BLOCKERS,
  MAX_SYNTHESIZED_STRENGTHS,
  validateAuditOutput,
} from "./validate";
import { AUDIT_SYNTHESIS_VERSION } from "./schema";
import { buildModelOutput } from "./test-support";
import { normalizeAnthropicAuditOutput } from "./wire-schema";

/**
 * The synthesis contract (CORE-2a.1).
 *
 * The rule the whole sprint exists to hold: **evidence can be detailed,
 * judgment must be concise.** These tests are about the judgment layer only —
 * the dimension assessments below it are unchanged and still enumerate.
 *
 * Cardinality is asserted as a ceiling and never as a quota. A test demanding
 * exactly three blockers would push the system toward inventing a third, which
 * is the failure this contract is meant to prevent (§6, §36).
 */

const KNOWN = new Set([
  "profile.identity.description",
  "live.site.title",
  "profile.signal.pricing_surface",
  "intent.monetization_model",
  "live.surface.pricing",
  "repo.surface.payments",
  "profile.journey.checkout_not_found",
  "live.seo.canonical_missing",
  "repo.surface.analytics",
  "live.conversion.primary_cta",
]);

function conclusion(overrides: Record<string, unknown> = {}) {
  return {
    headline: "A plain business conclusion.",
    explanation: "What Vibe found, in plain words.",
    whyItMatters: "",
    tone: "critical",
    confidence: "high",
    dimensions: ["monetization"],
    evidenceIds: ["profile.signal.pricing_surface"],
    ...overrides,
  };
}

/**
 * Runs the real path a provider response takes: transport normalization, then
 * domain validation. Fixtures speak the wire form because that is what the
 * provider returns.
 */
function synthesize(conclusions: Record<string, unknown>[], overall = "One sentence.") {
  const normalized = normalizeAnthropicAuditOutput(
    buildModelOutput({}, { conclusions, overallConclusion: overall }),
  );
  if (!normalized.ok) throw new Error(`fixture failed normalization: ${normalized.reason}`);

  const result = validateAuditOutput(normalized.data, KNOWN);
  if (!result.ok) throw new Error("expected a valid audit");
  return result.audit;
}

describe("grouping related evidence (§8, §35)", () => {
  /**
   * The real dogfood emitted five separate gaps for one problem: no monetization
   * model, no pricing surface, no checkout, no payment capability, no paying
   * journey stage. The contract's job is to make that arrive as one conclusion
   * citing five ids — so the shape a good model returns must survive validation
   * intact.
   */
  it("keeps one conclusion that cites many pieces of evidence", () => {
    const audit = synthesize([
      conclusion({
        headline: "People still don't have a clear path to paying you.",
        evidenceIds: [
          "profile.signal.pricing_surface",
          "intent.monetization_model",
          "live.surface.pricing",
          "repo.surface.payments",
          "profile.journey.checkout_not_found",
        ],
        dimensions: ["monetization", "conversion"],
      }),
    ]);

    expect(audit.synthesis?.blockers).toHaveLength(1);
    expect(audit.synthesis?.blockers[0]!.evidenceIds).toHaveLength(5);
  });

  it("lets one conclusion span several dimensions (§12)", () => {
    const audit = synthesize([
      conclusion({ dimensions: ["monetization", "conversion", "product"] }),
    ]);

    expect(audit.synthesis?.blockers[0]!.dimensions).toEqual([
      "monetization",
      "conversion",
      "product",
    ]);
  });

  it("ignores a dimension key that is not one of the five", () => {
    const audit = synthesize([conclusion({ dimensions: ["monetization", "growth_hacking"] })]);
    expect(audit.synthesis?.blockers[0]!.dimensions).toEqual(["monetization"]);
  });
});

describe("cardinality is a ceiling, never a quota (§6, §36, §37)", () => {
  it(`caps blockers at ${MAX_SYNTHESIZED_BLOCKERS}`, () => {
    const audit = synthesize([
      conclusion({ headline: "One", evidenceIds: ["profile.signal.pricing_surface"] }),
      conclusion({ headline: "Two", evidenceIds: ["live.seo.canonical_missing"] }),
      conclusion({ headline: "Three", evidenceIds: ["repo.surface.analytics"] }),
      conclusion({ headline: "Four", evidenceIds: ["live.conversion.primary_cta"] }),
      conclusion({ headline: "Five", evidenceIds: ["live.site.title"] }),
    ]);

    expect(audit.synthesis?.blockers).toHaveLength(MAX_SYNTHESIZED_BLOCKERS);
  });

  it(`caps strengths at ${MAX_SYNTHESIZED_STRENGTHS}`, () => {
    const audit = synthesize(
      ["a", "b", "c", "d", "e", "f"].map((key, index) =>
        conclusion({
          headline: `Strength ${key}`,
          tone: "positive",
          evidenceIds: [[...KNOWN][index]!],
        }),
      ),
    );

    expect(audit.synthesis?.strengths).toHaveLength(MAX_SYNTHESIZED_STRENGTHS);
  });

  /** Nothing may pad toward the ceiling. Two justified blockers stay two. */
  it("returns fewer when fewer are justified", () => {
    const audit = synthesize([
      conclusion({ headline: "One", evidenceIds: ["profile.signal.pricing_surface"] }),
      conclusion({ headline: "Two", evidenceIds: ["live.seo.canonical_missing"] }),
    ]);

    expect(audit.synthesis?.blockers).toHaveLength(2);
  });

  it("treats attention and critical alike as things holding the business back", () => {
    const audit = synthesize([
      conclusion({ headline: "Critical one", tone: "critical" }),
      conclusion({
        headline: "Attention one",
        tone: "attention",
        evidenceIds: ["live.seo.canonical_missing"],
      }),
    ]);

    expect(audit.synthesis?.blockers.map((entry) => entry.headline)).toEqual([
      "Critical one",
      "Attention one",
    ]);
    expect(audit.synthesis?.strengths).toEqual([]);
  });
});

describe("grounding (§10, §39)", () => {
  it("discards a conclusion citing no evidence at all", () => {
    const audit = synthesize([
      conclusion({ headline: "Grounded" }),
      conclusion({ headline: "Ungrounded", evidenceIds: [] }),
    ]);

    expect(audit.synthesis?.blockers.map((entry) => entry.headline)).toEqual(["Grounded"]);
    expect(audit.notes.join(" ")).toContain("cited no evidence");
  });

  it("discards a conclusion whose every citation is invented", () => {
    const audit = synthesize([
      conclusion({ headline: "Grounded" }),
      conclusion({ headline: "Hallucinated", evidenceIds: ["totally.made.up", "also.fake"] }),
    ]);

    expect(audit.synthesis?.blockers.map((entry) => entry.headline)).toEqual(["Grounded"]);
  });

  it("keeps a conclusion that cited one real id among invented ones, minus the invented", () => {
    const audit = synthesize([
      conclusion({ evidenceIds: ["profile.signal.pricing_surface", "not.real"] }),
    ]);

    expect(audit.synthesis?.blockers[0]!.evidenceIds).toEqual(["profile.signal.pricing_surface"]);
  });

  it("never emits a primary conclusion with an empty evidence list", () => {
    const audit = synthesize([
      conclusion({ headline: "A", evidenceIds: [] }),
      conclusion({ headline: "B", tone: "positive", evidenceIds: [] }),
      conclusion({ headline: "C", evidenceIds: ["live.site.title"] }),
    ]);

    for (const entry of [...(audit.synthesis?.strengths ?? []), ...(audit.synthesis?.blockers ?? [])]) {
      expect(entry.evidenceIds.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("no duplicate root problems (§40)", () => {
  it("merges two conclusions resting on substantially the same evidence", () => {
    const audit = synthesize([
      conclusion({
        headline: "The buying path is unclear.",
        evidenceIds: ["profile.signal.pricing_surface", "live.surface.pricing", "repo.surface.payments"],
      }),
      conclusion({
        headline: "Customers don't know what it costs.",
        evidenceIds: ["profile.signal.pricing_surface", "live.surface.pricing"],
      }),
    ]);

    expect(audit.synthesis?.blockers).toHaveLength(1);
    expect(audit.synthesis?.blockers[0]!.headline).toBe("The buying path is unclear.");
    expect(audit.notes.join(" ")).toContain("restated a problem already reported");
  });

  it("keeps two conclusions that rest on genuinely different evidence", () => {
    const audit = synthesize([
      conclusion({ headline: "Paying is unclear.", evidenceIds: ["profile.signal.pricing_surface"] }),
      conclusion({ headline: "Finding you is hard.", evidenceIds: ["live.seo.canonical_missing"] }),
    ]);

    expect(audit.synthesis?.blockers).toHaveLength(2);
  });

  /**
   * A strength and a blocker citing the same fact are usually two honest
   * readings of it — "accounts exist" and "nothing brings people back to them"
   * — not a duplicate.
   */
  it("does not merge across tones", () => {
    const audit = synthesize([
      conclusion({ headline: "Accounts exist.", tone: "positive" }),
      conclusion({ headline: "Nothing brings people back.", tone: "critical" }),
    ]);

    expect(audit.synthesis?.strengths).toHaveLength(1);
    expect(audit.synthesis?.blockers).toHaveLength(1);
  });

  /** A duplicate must not consume one of the three blocker slots. */
  it("applies the cap after merging, not before", () => {
    const audit = synthesize([
      conclusion({ headline: "One", evidenceIds: ["profile.signal.pricing_surface"] }),
      conclusion({ headline: "One restated", evidenceIds: ["profile.signal.pricing_surface"] }),
      conclusion({ headline: "Two", evidenceIds: ["live.seo.canonical_missing"] }),
      conclusion({ headline: "Three", evidenceIds: ["repo.surface.analytics"] }),
    ]);

    expect(audit.synthesis?.blockers.map((entry) => entry.headline)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });
});

describe("the synthesis document", () => {
  it("carries its own version, separate from the evidence pack (§20)", () => {
    const audit = synthesize([conclusion()]);
    expect(audit.synthesis?.version).toBe(AUDIT_SYNTHESIS_VERSION);
    expect(AUDIT_SYNTHESIS_VERSION).not.toContain("evidence");
  });

  it("carries one overall business conclusion (§25)", () => {
    const audit = synthesize([conclusion()], "You have a real product, but nobody can pay for it.");
    expect(audit.synthesis?.overall).toBe("You have a real product, but nobody can pay for it.");
  });

  it("maps an empty whyItMatters to null rather than an empty paragraph (§28)", () => {
    const audit = synthesize([conclusion({ tone: "positive", whyItMatters: "" })]);
    expect(audit.synthesis?.strengths[0]!.whyItMatters).toBeNull();
  });

  it("is null when the model returned nothing usable at this layer", () => {
    // Nothing at all: no conclusions, no overall, and no lens reasoning
    // either. Lens assessments alone would be a real result — the audit
    // thought about the business and could not conclude — so they have to be
    // absent too for the synthesis to be genuinely empty.
    const normalized = normalizeAnthropicAuditOutput(
      buildModelOutput({}, { conclusions: [], overallConclusion: "", lenses: [] }),
    );
    if (!normalized.ok) throw new Error("fixture failed normalization");

    const result = validateAuditOutput(normalized.data, KNOWN);
    if (!result.ok) throw new Error("expected a valid audit");
    expect(result.audit.synthesis).toBeNull();
  });

  /**
   * §38: compression happens at the judgment layer only. The dimension
   * assessments keep every finding they had, which is what the technical
   * breakdown renders and what the Opportunity Engine reads.
   */
  it("leaves the dimension assessments untouched", () => {
    const audit = synthesize([conclusion()]);

    expect(audit.dimensions).toHaveLength(5);
    for (const dimension of audit.dimensions) {
      expect(dimension).toHaveProperty("strengths");
      expect(dimension).toHaveProperty("gaps");
      expect(dimension).toHaveProperty("unknowns");
    }
    expect(audit.dimensions.find((d) => d.id === "product")?.strengths).toEqual(["Something works"]);
  });
});
