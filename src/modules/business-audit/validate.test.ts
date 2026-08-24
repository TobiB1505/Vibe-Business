import { describe, expect, it } from "vitest";
import { BUSINESS_LENSES } from "./schema";
import { validateAuditOutput } from "./validate";
import { buildModelOutput } from "./test-support";
import { normalizeAnthropicAuditOutput } from "./wire-schema";

const KNOWN = new Set([
  "business.product_summary",
  "business.monetization_model",
  "live.site.title",
  "live.surface.pricing",
  "live.conversion.primary_cta",
  "profile.identity.description",
  "profile.signal.pricing_surface",
  "intent.monetization_model",
]);

/**
 * Validates a fixture, normalizing the provider wire form first, so these
 * cases exercise the real path a provider response takes. Since ADR 0050 the
 * response is lenses + conclusions + limitations — the per-dimension pipeline
 * and its three invariants left with the dimension layer; what survives of
 * them lives in `validateLenses` (score nulled without evidence or against
 * its health band) and is asserted in `business-lenses.test.ts`.
 */
function validate(output: Record<string, unknown>) {
  const normalized = normalizeAnthropicAuditOutput(output);
  if (!normalized.ok) throw new Error("fixture failed wire normalization");
  return validateAuditOutput(normalized.data, KNOWN);
}

describe("validateAuditOutput — structure", () => {
  it("accepts a valid response and preserves its assessments", () => {
    const result = validate(buildModelOutput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.audit.synthesis?.lenses.map((lens) => lens.lens)).toEqual([...BUSINESS_LENSES]);
    expect(result.audit.synthesis?.blockers.length).toBeGreaterThan(0);
    expect("dimensions" in result.audit).toBe(false);
  });

  it("rejects a non-object response", () => {
    const result = validateAuditOutput("not an object", KNOWN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("response_not_object");
  });
});

describe("evidence discipline", () => {
  it("drops hallucinated evidence ids and records that it did", () => {
    const result = validate(
      buildModelOutput({
        lenses: BUSINESS_LENSES.map((lens) => ({
          lens,
          health: "adequate",
          score: 60,
          materiality: "soon",
          summary: `Internal reasoning for ${lens}.`,
          evidenceIds: ["live.site.title", "invented.id.99"],
          missingContext: [],
        })),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.audit.synthesis?.lenses[0]!.evidenceIds).toEqual(["live.site.title"]);
    expect(result.audit.notes.join(" ")).toContain("did not exist in the evidence pack");
  });

  it("drops a business conclusion whose evidence does not exist", () => {
    const result = validate(
      buildModelOutput({
        conclusions: [
          {
            rootProblem: "x",
            headline: "A claim about the product.",
            explanation: "Grounded in nothing.",
            whyItMatters: null,
            tone: "critical",
            confidence: "high",
            lenses: ["offer"],
            evidenceIds: ["invented.id.1"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.synthesis?.blockers).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * Sprint 0083, ported to the lens contract — an unobservable citation
 * ------------------------------------------------------------------------ */

describe("a model scoring from evidence that was never observable", () => {
  /**
   * Sprint 0083 stopped the pack minting absence ids for pages Vibe could not
   * read, and proved the enforcement was the absent id rather than a new
   * validation rule: with the id gone, the citation is dropped and the score
   * cannot survive. Under the lens contract the same property holds through
   * `validateLenses` — a lens whose only citation was discarded has no
   * surviving evidence, so its score is nulled and it cannot enter the
   * overall mean (rule 44, ADR 0050).
   */
  function lensCiting(evidenceIds: string[], known: Set<string>) {
    const output = buildModelOutput({
      lenses: [
        {
          lens: "revenue_economics",
          health: "weak",
          score: 30,
          materiality: "now",
          summary: "The live product has no pricing surface.",
          evidenceIds,
          missingContext: [],
        },
      ],
    });
    const normalized = normalizeAnthropicAuditOutput(output);
    if (!normalized.ok) throw new Error("fixture failed normalization");
    return validateAuditOutput(normalized.data, known);
  }

  it("refuses to keep a score whose only citation no longer exists", () => {
    const result = lensCiting(["live.surface_absent.pricing"], new Set(["live.rendering.client_rendered"]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lens = result.audit.synthesis?.lenses[0];
    expect(lens?.score).toBeNull();
    expect(lens?.evidenceIds).toEqual([]);
  });

  it("would have kept it while the id still existed — the id is what changed", () => {
    const result = lensCiting(
      ["live.surface_absent.pricing"],
      new Set(["live.surface_absent.pricing"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.synthesis?.lenses[0]!.score).toBe(30);
  });
});
