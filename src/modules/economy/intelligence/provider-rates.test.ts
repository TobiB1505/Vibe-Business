import { describe, expect, it } from "vitest";
import { MODEL_PRICING } from "@/modules/ai/pricing";
import { anthropicRates, estimateModelSpend, type ModelProviderRates } from "./provider-rates";

const TOKENS = { input: 10_000, output: 4_000, cacheRead: 200_000, cacheWrite: 30_000 };

describe("provider rates are resolved, never restated", () => {
  it("delegates to Vibe's one price book", () => {
    const at = new Date("2026-08-20T00:00:00Z");
    const rates = anthropicRates("claude-sonnet-5", at);
    const row = MODEL_PRICING.find((entry) => entry.pricingVersion === "claude-sonnet-5-introductory-2026");

    expect(rates).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      pricingVersion: row?.pricingVersion,
      inputNanoUsdPerToken: row?.inputNanoUsdPerToken,
      outputNanoUsdPerToken: row?.outputNanoUsdPerToken,
      cacheReadNanoUsdPerToken: row?.cacheReadNanoUsdPerToken,
      cacheWriteNanoUsdPerToken: row?.cacheWriteNanoUsdPerToken,
    });
  });

  /**
   * An unpriced model is a legitimate unknown, not a crash. The caller already
   * handles absence on every other signal, and an estimate that refuses to be
   * made is more useful than one that throws out of a workflow step.
   */
  it("returns null for a model no rate covers", () => {
    expect(anthropicRates("some-model-nobody-priced", new Date("2026-08-20T00:00:00Z"))).toBeNull();
  });

  it("carries a provider, so nothing downstream is Anthropic-shaped", () => {
    const rates = anthropicRates("claude-sonnet-5", new Date("2026-08-20T00:00:00Z"));

    expect(rates?.provider).toBe("anthropic");
  });

  it("prices a supplied non-Anthropic rate without knowing anything about it", () => {
    const supplied: ModelProviderRates = {
      provider: "openai",
      model: "some-future-model",
      pricingVersion: "operator-supplied-2026-08",
      inputNanoUsdPerToken: 1_500,
      outputNanoUsdPerToken: 6_000,
      cacheReadNanoUsdPerToken: 150,
      cacheWriteNanoUsdPerToken: 1_875,
    };

    const spend = estimateModelSpend(supplied, TOKENS);

    expect(spend).toEqual({
      known: true,
      basis: "estimated",
      nanoUsd: 10_000 * 1_500 + 4_000 * 6_000 + 200_000 * 150 + 30_000 * 1_875,
    });
  });
});

/**
 * PART P #6 — a provider price change must move future predictions and leave
 * past ones alone.
 *
 * This block used to demonstrate that against the real step in `MODEL_PRICING`:
 * claude-sonnet-5, 2000 -> 3000 nanoUSD per input token on 2026-09-01. **That
 * step was cancelled** (ADR 0062), so the same instant is now demonstrated the
 * other way round — as continuity — and the *mechanism* is demonstrated
 * against a supplied price book instead, which is the shape that survives any
 * future correction.
 */
describe("provider rates follow the price book, at the instant asked", () => {
  const before = anthropicRates("claude-sonnet-5", new Date("2026-08-20T00:00:00Z"));
  const after = anthropicRates("claude-sonnet-5", new Date("2026-10-01T00:00:00Z"));

  it("spans the cancelled 2026-09-01 instant with one version and one rate", () => {
    expect(before?.pricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(after?.pricingVersion).toBe(before?.pricingVersion);
    expect(after?.inputNanoUsdPerToken).toBe(before?.inputNanoUsdPerToken);
  });

  it("costs the same work the same on both sides of it", () => {
    const spendBefore = estimateModelSpend(before, TOKENS);
    const spendAfter = estimateModelSpend(after, TOKENS);

    if (!spendBefore.known || !spendAfter.known) throw new Error("both sides must be priced");
    expect(spendAfter.nanoUsd).toBe(spendBefore.nanoUsd);
  });

  it("uses the half-open boundary, so a step's own instant is the new price", () => {
    // The property itself, shown on the one window boundary the book still
    // has: Haiku 4.5 opening on 2025-10-01.
    const atBoundary = anthropicRates("claude-haiku-4-5-20251001", new Date("2025-10-01T00:00:00Z"));
    const justBefore = anthropicRates(
      "claude-haiku-4-5-20251001",
      new Date("2025-09-30T23:59:59.999Z"),
    );

    expect(atBoundary?.pricingVersion).toBe("claude-haiku-4-5-2025-10");
    expect(justBefore).toBeNull();
  });
});

describe("an unpriceable expectation stays unknown", () => {
  it("names the absent rate", () => {
    expect(estimateModelSpend(null, TOKENS)).toEqual({ known: false, reason: "no_price_available" });
  });

  it("names the absent expectation", () => {
    const rates = anthropicRates("claude-sonnet-5", new Date("2026-08-20T00:00:00Z"));

    expect(estimateModelSpend(rates, null)).toEqual({ known: false, reason: "not_measured" });
  });

  /** An estimate is never a measurement, however precisely it was computed. */
  it("marks a priced expectation estimated, never measured", () => {
    const rates = anthropicRates("claude-sonnet-5", new Date("2026-08-20T00:00:00Z"));
    const spend = estimateModelSpend(rates, TOKENS);

    if (!spend.known) throw new Error("expected a priced amount");
    expect(spend.basis).toBe("estimated");
  });
});
