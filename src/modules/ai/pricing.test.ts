import { describe, expect, it } from "vitest";
import {
  calculateProviderCost,
  MODEL_PRICING,
  nanoUsdToUsdString,
  resolvePricing,
  UnpricedModelError,
} from "./pricing";

/**
 * Pricing is money, so the boundaries get explicit tests (Sprint 4 §37):
 * the effective-date switch, exact arithmetic, and refusal to price an
 * unknown model.
 */

const INTRODUCTORY = new Date("2026-08-10T00:00:00.000Z");
/** After the instant the withdrawn rise would have taken effect. */
const AFTER_CANCELLED_RISE = new Date("2026-09-15T00:00:00.000Z");

/**
 * The two instants either side of the price change that was announced,
 * scheduled here, and then withdrawn.
 */
const LAST_INSTANT_BEFORE = new Date("2026-08-31T23:59:59.999Z");
const FIRST_INSTANT_AFTER = new Date("2026-09-01T00:00:00.000Z");

/** Claude Sonnet 5, per Anthropic's pricing page as verified on 2026-08-31. */
const SONNET_5 = {
  input: 2_000, // $2 / MTok
  output: 10_000, // $10 / MTok
  cacheRead: 200, // $0.20 / MTok
  cacheWrite: 2_500, // $2.50 / MTok (5-minute write)
} as const;

/**
 * The cancelled 1 September 2026 price rise, permanently.
 *
 * ## What this guards
 *
 * Anthropic announced $2/$10 for Claude Sonnet 5 as introductory pricing
 * "through August 31, 2026", with a rise to $3/$15 on 1 September. This file
 * carried both sides of it and `credits/margin-guard.ts` was built around the
 * step. Anthropic then withdrew the increase — its pricing page now states
 * that the introductory price "is now the standard price" and that the
 * scheduled rise "will not occur" (verified 2026-08-31).
 *
 * A withdrawn future price is more dangerous than a wrong current one, because
 * nothing fails when it is added and nothing fails on the day it arrives — it
 * simply starts pricing real usage. So the assertions below are deliberately
 * about **continuity**: the same version, the same four rates and the same
 * computed cost on both sides of an instant that used to be a step.
 *
 * If somebody reintroduces the September transition, every test in this block
 * fails, and the last one names it directly.
 */
describe("Claude Sonnet 5 — the cancelled September 2026 rise", () => {
  it("prices at $2 / $10 per MTok on the last instant before it", () => {
    const pricing = resolvePricing("claude-sonnet-5", LAST_INSTANT_BEFORE);

    expect(pricing.inputNanoUsdPerToken).toBe(SONNET_5.input);
    expect(pricing.outputNanoUsdPerToken).toBe(SONNET_5.output);
    expect(pricing.cacheReadNanoUsdPerToken).toBe(SONNET_5.cacheRead);
    expect(pricing.cacheWriteNanoUsdPerToken).toBe(SONNET_5.cacheWrite);
  });

  it("prices at $2 / $10 per MTok on the first instant after it", () => {
    const pricing = resolvePricing("claude-sonnet-5", FIRST_INSTANT_AFTER);

    expect(pricing.inputNanoUsdPerToken).toBe(SONNET_5.input);
    expect(pricing.outputNanoUsdPerToken).toBe(SONNET_5.output);
    expect(pricing.cacheReadNanoUsdPerToken).toBe(SONNET_5.cacheRead);
    expect(pricing.cacheWriteNanoUsdPerToken).toBe(SONNET_5.cacheWrite);
  });

  it("resolves the same pricing version on both sides", () => {
    // One row spanning the instant, not two rows agreeing across it. A charge
    // dated either side is explainable by the same version string.
    expect(resolvePricing("claude-sonnet-5", LAST_INSTANT_BEFORE).pricingVersion).toBe(
      resolvePricing("claude-sonnet-5", FIRST_INSTANT_AFTER).pricingVersion,
    );
  });

  it("computes an identical cost across the instant, including cache dimensions", () => {
    // The strongest form of "no discontinuity": not that the rates match, but
    // that the arithmetic a ledger entry would store is byte-identical.
    const call = {
      model: "claude-sonnet-5",
      inputTokens: 12_530,
      outputTokens: 9_680,
      cacheReadInputTokens: 602_000,
      cacheCreationInputTokens: 60_600,
    };

    const before = calculateProviderCost({ ...call, at: LAST_INSTANT_BEFORE });
    const after = calculateProviderCost({ ...call, at: FIRST_INSTANT_AFTER });

    expect(after.totalUsd).toBe(before.totalUsd);
    expect(after.totalNanoUsd).toBe(before.totalNanoUsd);
    expect(after.cacheReadNanoUsd).toBe(before.cacheReadNanoUsd);
    expect(after.cacheWriteNanoUsd).toBe(before.cacheWriteNanoUsd);
    expect(after.pricingVersion).toBe(before.pricingVersion);
  });

  it("still prices Sonnet 5 far beyond the cancelled instant", () => {
    // Deleting the September row without opening the introductory window would
    // leave a coverage gap rather than a price: `recordAIUsage` would write a
    // null cost and `costForAiRow` would report `rate_unavailable` — silently,
    // from the customer's side.
    const pricing = resolvePricing("claude-sonnet-5", new Date("2027-06-01T00:00:00.000Z"));

    expect(pricing.inputNanoUsdPerToken).toBe(SONNET_5.input);
    expect(pricing.outputNanoUsdPerToken).toBe(SONNET_5.output);
  });

  it("carries exactly one open-ended Sonnet 5 row, at no other rate", () => {
    // The reintroduction guard. Naming the withdrawn numbers rather than the
    // withdrawn version string is deliberate: a re-added row under a different
    // name would still be the same mistake.
    const sonnet = MODEL_PRICING.filter((entry) => entry.model === "claude-sonnet-5");

    expect(sonnet).toHaveLength(1);
    expect(sonnet[0]!.effectiveTo).toBeNull();

    for (const entry of sonnet) {
      expect(entry.inputNanoUsdPerToken, "the cancelled $3/MTok input rate is back").not.toBe(3_000);
      expect(entry.outputNanoUsdPerToken, "the cancelled $15/MTok output rate is back").not.toBe(
        15_000,
      );
    }
  });
});

describe("resolvePricing — effective dating", () => {
  it("prices Claude Sonnet 5 from its own effective instant", () => {
    const pricing = resolvePricing("claude-sonnet-5", INTRODUCTORY);
    expect(pricing.pricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(pricing.inputNanoUsdPerToken).toBe(2_000);
    expect(pricing.outputNanoUsdPerToken).toBe(10_000);
  });

  it("has no pricing before a model's window opens", () => {
    expect(() => resolvePricing("claude-sonnet-5", new Date("2025-06-01T00:00:00.000Z"))).toThrow(
      UnpricedModelError,
    );
  });

  it("treats a boundary instant as belonging to the newer row", () => {
    // The half-open interval leaves no ambiguous second at a switch. Sonnet 5
    // no longer has one, so this is asserted on Haiku's own opening boundary —
    // the property is about the resolver, not about any particular model.
    const firstHaikuInstant = new Date("2025-10-01T00:00:00.000Z");

    expect(resolvePricing("claude-haiku-4-5-20251001", firstHaikuInstant).pricingVersion).toBe(
      "claude-haiku-4-5-2025-10",
    );
    expect(() =>
      resolvePricing("claude-haiku-4-5-20251001", new Date("2025-09-30T23:59:59.999Z")),
    ).toThrow(UnpricedModelError);
  });

  it("resolves against a supplied price book without touching the real one", () => {
    // The seam `margin-guard.ts` uses to price a hypothetical future increase.
    const hypothetical = [
      {
        pricingVersion: "hypothetical",
        model: "claude-sonnet-5",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        inputNanoUsdPerToken: 9_000,
        outputNanoUsdPerToken: 45_000,
        cacheReadNanoUsdPerToken: 900,
        cacheWriteNanoUsdPerToken: 11_250,
      },
    ];

    expect(resolvePricing("claude-sonnet-5", INTRODUCTORY, hypothetical).inputNanoUsdPerToken).toBe(
      9_000,
    );
    // ...and the real book is unchanged.
    expect(resolvePricing("claude-sonnet-5", INTRODUCTORY).inputNanoUsdPerToken).toBe(2_000);
  });

  it("refuses to price an unknown model rather than assuming it is free", () => {
    expect(() => resolvePricing("some-other-model", INTRODUCTORY)).toThrow(UnpricedModelError);
  });
});

describe("nanoUsdToUsdString", () => {
  it("renders sub-cent amounts without floating point drift", () => {
    expect(nanoUsdToUsdString(0)).toBe("0.000000000");
    expect(nanoUsdToUsdString(1)).toBe("0.000000001");
    expect(nanoUsdToUsdString(21_000_000)).toBe("0.021000000");
    expect(nanoUsdToUsdString(1_000_000_000)).toBe("1.000000000");
    expect(nanoUsdToUsdString(1_234_567_890)).toBe("1.234567890");
  });
});

describe("calculateProviderCost", () => {
  it("computes cost from actual token counts at introductory pricing", () => {
    // 4,000 input × $2/MTok = $0.008; 1,500 output × $10/MTok = $0.015.
    const cost = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 4_000,
      outputTokens: 1_500,
      at: INTRODUCTORY,
    });

    expect(cost.pricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(cost.inputNanoUsd).toBe(8_000_000);
    expect(cost.outputNanoUsd).toBe(15_000_000);
    expect(cost.totalNanoUsd).toBe(23_000_000);
    expect(cost.totalUsd).toBe("0.023000000");
  });

  it("computes the same cost for the same call after the cancelled rise", () => {
    // This assertion used to be "computes a higher cost", at $0.034500000.
    // The rise it was written for was withdrawn before it took effect.
    const cost = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 4_000,
      outputTokens: 1_500,
      at: AFTER_CANCELLED_RISE,
    });

    expect(cost.pricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(cost.totalUsd).toBe("0.023000000");
  });

  it("is exact for a single token, where floating point would drift", () => {
    const cost = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 1,
      outputTokens: 0,
      at: INTRODUCTORY,
    });
    expect(cost.totalNanoUsd).toBe(2_000);
    expect(cost.totalUsd).toBe("0.000002000");
  });

  it("returns zero cost for a zero-token call", () => {
    const cost = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      at: INTRODUCTORY,
    });
    expect(cost.totalNanoUsd).toBe(0);
    expect(cost.totalUsd).toBe("0.000000000");
  });

  it("does not double-count thinking tokens, which are already in output_tokens", () => {
    // The provider reports thinking inside output_tokens; adding it again
    // would overstate every reasoning-heavy call.
    const cost = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 1_000,
      at: INTRODUCTORY,
    });
    expect(cost.totalNanoUsd).toBe(10_000_000);
  });
});
