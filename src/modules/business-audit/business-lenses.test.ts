import { describe, expect, it } from "vitest";
import { BUSINESS_LENSES, type AuditSynthesis } from "./schema";
import { validateAuditOutput } from "./validate";
import { buildModelOutput } from "./test-support";
import { normalizeAnthropicAuditOutput } from "./wire-schema";

/**
 * The nine Business Reasoning Lenses (CORE-2a.3).
 *
 * What is under test is the *contract*, not the model's judgement. A test
 * cannot assert that an audit reasons well — that is what the dogfood is for.
 * It can assert that the framework leaves room for good reasoning and forbids
 * the shapes that produced bad reasoning: forced coverage, a single lens per
 * conclusion, and "unclear" being unrepresentable.
 */

const KNOWN = new Set(["live.site.title", "profile.signal.pricing_surface", "repo.surface.payments"]);

function lens(overrides: Record<string, unknown> = {}) {
  return {
    lens: "offer",
    health: "adequate",
    score: 60,
    materiality: "soon",
    summary: "Internal reasoning.",
    evidenceIds: ["live.site.title"],
    missingContext: [],
    ...overrides,
  };
}

function audit(lenses: Record<string, unknown>[], conclusions?: Record<string, unknown>[]) {
  const normalized = normalizeAnthropicAuditOutput(
    buildModelOutput(conclusions ? { lenses, conclusions } : { lenses }),
  );
  if (!normalized.ok) throw new Error(`normalization failed: ${normalized.reason}`);
  const result = validateAuditOutput(normalized.data, KNOWN);
  if (!result.ok) throw new Error(`validation failed: ${result.reason}`);
  return result.audit;
}

function synthesisOf(a: ReturnType<typeof audit>): AuditSynthesis {
  if (!a.synthesis) throw new Error("expected a synthesis");
  return a.synthesis;
}

describe("the framework covers a whole business, not a product surface", () => {
  it("has exactly the nine lenses", () => {
    expect([...BUSINESS_LENSES]).toEqual([
      "offer",
      "audience",
      "revenue_economics",
      "acquisition",
      "conversion",
      "retention",
      "measurement",
      "business_readiness",
      "scalability",
    ]);
  });

  it("carries an assessment for every lens the model returned", () => {
    const result = audit(BUSINESS_LENSES.map((id) => lens({ lens: id })));
    expect(synthesisOf(result).lenses.map((entry) => entry.lens)).toEqual([...BUSINESS_LENSES]);
  });

  it("reaches the audit rubric, so the model is actually asked to use them", async () => {
    const { BUSINESS_READINESS_RUBRIC } = await import("./rubric");
    for (const id of BUSINESS_LENSES) {
      // The rubric names each lens in prose rather than by key.
      const word = id.split("_")[0]!;
      expect(BUSINESS_READINESS_RUBRIC.toLowerCase()).toContain(word);
    }
  });
});

describe("no forced coverage (§15, §44)", () => {
  it("accepts an audit that assessed only some lenses", () => {
    const result = audit([lens({ lens: "offer" }), lens({ lens: "revenue_economics" })]);
    expect(synthesisOf(result).lenses).toHaveLength(2);
  });

  /**
   * The rule that stops a portfolio site being told its retention is weak.
   * "This does not apply to this kind of product" is a result, not a gap.
   */
  it("preserves a lens marked not material rather than dropping it", () => {
    const result = audit([
      lens({ lens: "retention", health: "adequate", materiality: "not_material" }),
    ]);
    const retention = synthesisOf(result).lenses[0]!;

    // Not applying is a materiality judgment, and after CORE-2a.3.1 it can only
    // be expressed as one. The health stays honest: there is nothing wrong with
    // a one-off product having nothing to come back to.
    expect(retention.materiality).toBe("not_material");
    expect(retention.health).toBe("adequate");
  });

  /**
   * A lens blocked on something only the founder knows cites nothing by
   * definition — so unlike a conclusion, it must survive with no evidence.
   */
  it("keeps a blocked lens even though it can cite no evidence", () => {
    const result = audit([
      lens({
        lens: "revenue_economics",
        health: "blocked_by_missing_context",
        materiality: "now",
        evidenceIds: [],
        missingContext: ["Whether the founder intends to charge for this at all"],
      }),
    ]);

    const economics = synthesisOf(result).lenses[0]!;
    expect(economics.health).toBe("blocked_by_missing_context");
    expect(economics.evidenceIds).toEqual([]);
    expect(economics.missingContext).toEqual([
      "Whether the founder intends to charge for this at all",
    ]);
  });

  it("keeps an unclear lens rather than forcing a verdict", () => {
    const result = audit([lens({ lens: "acquisition", health: "unclear", score: null })]);
    expect(synthesisOf(result).lenses[0]!.health).toBe("unclear");
    expect(synthesisOf(result).lenses[0]!.score).toBeNull();
  });

  it("keeps lens scores honest and nulls contradictions", () => {
    const result = audit([
      lens({ lens: "offer", health: "strong", score: 82 }),
      lens({ lens: "audience", health: "weak", score: 74 }),
      lens({ lens: "scalability", health: "unclear", score: 0 }),
    ]);

    expect(synthesisOf(result).lenses.map((entry) => entry.score)).toEqual([82, null, null]);
  });
});

describe("lens hygiene", () => {
  it("discards a lens name outside the closed vocabulary", () => {
    const result = audit([lens({ lens: "growth_hacking" }), lens({ lens: "offer" })]);
    expect(synthesisOf(result).lenses.map((e) => e.lens)).toEqual(["offer"]);
  });

  it("keeps the first of a repeated lens", () => {
    const result = audit([
      lens({ lens: "offer", summary: "First." }),
      lens({ lens: "offer", summary: "Second." }),
    ]);

    expect(synthesisOf(result).lenses).toHaveLength(1);
    expect(synthesisOf(result).lenses[0]!.summary).toBe("First.");
  });

  it("drops an invented evidence id from a lens without dropping the lens", () => {
    const result = audit([lens({ evidenceIds: ["live.site.title", "not.a.real.id"] })]);
    expect(synthesisOf(result).lenses[0]!.evidenceIds).toEqual(["live.site.title"]);
  });

  it("falls back to unclear rather than inventing a health", () => {
    const result = audit([lens({ health: "amazing" })]);
    expect(synthesisOf(result).lenses[0]!.health).toBe("unclear");
  });

  /**
   * `unknown`, not a middle value. An unreadable materiality is one the audit
   * did not state, and quietly promoting it to "soon" would let a lens nobody
   * assessed compete for one of three top-three slots.
   */
  it("falls back to unknown rather than guessing a materiality", () => {
    const result = audit([lens({ materiality: "urgent-ish" })]);
    expect(synthesisOf(result).lenses[0]!.materiality).toBe("unknown");
  });
});

describe("conclusions span lenses (§40)", () => {
  it("records every lens a conclusion came from", () => {
    const result = audit(
      [lens()],
      [
        {
          headline: "You haven't turned usage into revenue yet.",
          explanation: "Every action costs you money and nothing brings any in.",
          whyItMatters: "Growth makes the problem bigger rather than smaller.",
          tone: "critical",
          confidence: "high",
          dimensions: ["monetization"],
          lenses: ["revenue_economics", "scalability", "offer"],
          evidenceIds: ["profile.signal.pricing_surface"],
        },
      ],
    );

    expect(synthesisOf(result).blockers[0]!.lenses).toEqual([
      "revenue_economics",
      "scalability",
      "offer",
    ]);
  });

  it("ignores a lens key that is not one of the nine", () => {
    const result = audit(
      [lens()],
      [
        {
          headline: "A conclusion.",
          explanation: "Grounded.",
          whyItMatters: "",
          tone: "critical",
          confidence: "high",
          dimensions: ["monetization"],
          lenses: ["revenue_economics", "vibes"],
          evidenceIds: ["profile.signal.pricing_surface"],
        },
      ],
    );

    expect(synthesisOf(result).blockers[0]!.lenses).toEqual(["revenue_economics"]);
  });

  /**
   * The lenses are the audit's working-out. They must never become nine cards
   * on the screen — the customer-facing output stays a handful of conclusions.
   */
  it("keeps the customer-facing output bounded regardless of lens count", () => {
    const result = audit(BUSINESS_LENSES.map((id) => lens({ lens: id })));
    const synthesis = synthesisOf(result);

    expect(synthesis.lenses).toHaveLength(9);
    expect(synthesis.strengths.length + synthesis.blockers.length).toBeLessThanOrEqual(7);
  });
});
