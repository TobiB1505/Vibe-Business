import { describe, expect, it } from "vitest";
import {
  calculateProviderCost,
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
const STANDARD = new Date("2026-09-15T00:00:00.000Z");

describe("resolvePricing — effective dating", () => {
  it("uses introductory pricing before the change date", () => {
    const pricing = resolvePricing("claude-sonnet-5", INTRODUCTORY);
    expect(pricing.pricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(pricing.inputNanoUsdPerToken).toBe(2_000);
    expect(pricing.outputNanoUsdPerToken).toBe(10_000);
  });

  it("uses standard pricing after the change date", () => {
    const pricing = resolvePricing("claude-sonnet-5", STANDARD);
    expect(pricing.pricingVersion).toBe("claude-sonnet-5-standard-2026-09");
    expect(pricing.inputNanoUsdPerToken).toBe(3_000);
    expect(pricing.outputNanoUsdPerToken).toBe(15_000);
  });

  it("treats the boundary instant as belonging to the newer pricing", () => {
    // The half-open interval leaves no ambiguous second at the switch.
    const lastIntroductory = new Date("2026-08-31T23:59:59.999Z");
    const firstStandard = new Date("2026-09-01T00:00:00.000Z");

    expect(resolvePricing("claude-sonnet-5", lastIntroductory).pricingVersion).toBe(
      "claude-sonnet-5-introductory-2026",
    );
    expect(resolvePricing("claude-sonnet-5", firstStandard).pricingVersion).toBe(
      "claude-sonnet-5-standard-2026-09",
    );
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

  it("computes a higher cost for the same call after the price change", () => {
    const cost = calculateProviderCost({
      model: "claude-sonnet-5",
      inputTokens: 4_000,
      outputTokens: 1_500,
      at: STANDARD,
    });

    expect(cost.pricingVersion).toBe("claude-sonnet-5-standard-2026-09");
    // 4,000 × $3/MTok + 1,500 × $15/MTok = $0.012 + $0.0225.
    expect(cost.totalUsd).toBe("0.034500000");
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
