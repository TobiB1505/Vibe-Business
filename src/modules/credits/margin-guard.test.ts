import { describe, expect, it } from "vitest";
import { MODEL_PRICING } from "@/modules/ai/pricing";
import {
  CREDIT_VALUE_NANO_USD,
  LAUNCH_V1_COST_PROFILES,
  MARGIN_FLOOR,
  launchV1Margins,
  marginFor,
  uncoveredPrices,
} from "./margin-guard";
import { RETAIL_PRICE_POLICIES } from "./retail";

/**
 * The guard that would have caught the 2026-09-01 margin collapse.
 *
 * Every assertion here is evaluated against the provider rates in force at the
 * instant it names, so a future rate change turns a green suite red on the day
 * it lands rather than on the day somebody reads an invoice.
 */

/** After Sonnet 5's scheduled +50%, which is when `launch-v1` takes effect. */
const AFTER_RISE = new Date("2026-09-01T00:00:00.000Z");
/** The last instant `retail-v1` was in force. */
const BEFORE_RISE = new Date("2026-08-31T23:59:59.999Z");

describe("launch-v1 margins at the rates in force", () => {
  it("every measured price clears the floor", () => {
    const reports = launchV1Margins(AFTER_RISE);
    expect(reports.length).toBeGreaterThan(0);

    for (const report of reports) {
      expect(
        report.margin,
        `${report.operation}${report.pricingClass ? ` (${report.pricingClass})` : ""} is at ` +
          `${(report.margin * 100).toFixed(1)}% under ${report.pricingVersion}. ` +
          `The price is ${report.credits / 1000} Credits and the measured cost is ` +
          `$${(report.costNanoUsd / 1e9).toFixed(4)} per delivered result. ` +
          `Either a provider rate moved or the profile did — check ` +
          `docs/business/CREDIT_RATE_CARD_LAUNCH_V1.md before changing this floor.`,
      ).toBeGreaterThanOrEqual(MARGIN_FLOOR);
    }
  });

  it("prices against the rates of the day, not a frozen copy", () => {
    // The same profile, priced under two different Sonnet cards. If this ever
    // stops differing, the guard has been disconnected from `ai/pricing.ts` and
    // is asserting a constant against itself.
    const profile = LAUNCH_V1_COST_PROFILES.find((p) => p.operation === "business_audit")!;

    const before = marginFor(profile, BEFORE_RISE)!;
    const after = marginFor(profile, AFTER_RISE)!;

    expect(before.pricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(after.pricingVersion).toBe("claude-sonnet-5-standard-2026-09");
    expect(after.costNanoUsd).toBeGreaterThan(before.costNanoUsd);
  });

  it("holds the margin retail-v1 was calibrated to, across the rise", () => {
    // The reconstruction this rate card was built from, asserted rather than
    // described: `retail-v1`'s 35 Credits cleared ~80% at the old rates, and
    // `launch-v1`'s 55 clears ~80% at the new ones. The prices moved because
    // the costs did.
    const profile = LAUNCH_V1_COST_PROFILES.find((p) => p.operation === "business_audit")!;

    const before = marginFor(profile, BEFORE_RISE)!;
    const after = marginFor(profile, AFTER_RISE)!;

    expect(before.credits).toBe(35_000);
    expect(after.credits).toBe(55_000);
    expect(before.margin).toBeGreaterThan(0.78);
    expect(after.margin).toBeGreaterThan(0.78);
  });

  it("would fail if launch-v1 had kept retail-v1's prices", () => {
    // The counterfactual, stated as a test so the reason for the repricing
    // survives longer than anybody's memory of it: 35 Credits at the September
    // rates is a materially worse business, and this is by how much.
    const profile = LAUNCH_V1_COST_PROFILES.find((p) => p.operation === "business_audit")!;
    const after = marginFor(profile, AFTER_RISE)!;

    const heldPriceRevenue = (35_000 / 1_000) * CREDIT_VALUE_NANO_USD;
    const heldPriceMargin = (heldPriceRevenue - after.costNanoUsd) / heldPriceRevenue;

    expect(heldPriceMargin).toBeLessThan(0.72);
  });
});

describe("what the guard deliberately does not cover", () => {
  it("names every price with no measured profile behind it", () => {
    // Exactly three, and each for a reason recorded in `retail.ts`'s
    // `PriceBasis`. A fourth appearing here is a decision somebody has to make,
    // not a gap that quietly opens.
    expect(uncoveredPrices(AFTER_RISE)).toEqual([
      // No browser-provider rate exists in this repository, and every
      // `deep_scan_provider_usage.provider_cost_usd` is null. `basis: "policy"`.
      { operation: "deep_scan", pricingClass: null },
      // One cost observation. `basis: "modelled"`.
      { operation: "agent_execution", pricingClass: "small" },
      // Zero cost observations — the largest gap in the card. `basis: "modelled"`.
      { operation: "agent_execution", pricingClass: "complex" },
    ]);
  });

  it("covers the agent tier that actually carries the sample", () => {
    const covered = launchV1Margins(AFTER_RISE).filter((r) => r.operation === "agent_execution");
    expect(covered).toHaveLength(1);
    expect(covered[0]!.pricingClass).toBe("standard");
  });
});

describe("the assumptions the card rests on", () => {
  it("values a Credit at the plan that values it least", () => {
    // €49 / 3,000 Credits = €0.016333, at EUR/USD 1.08 = $0.017640. Pinned
    // because it is the divisor under every price in the card: change it and
    // every margin above moves, which is a commercial decision and not a
    // refactor.
    expect(CREDIT_VALUE_NANO_USD).toBe(17_640_000);
  });

  it("supersedes retail-v1 at the instant the provider rate moves", () => {
    const retail = RETAIL_PRICE_POLICIES.find((p) => p.version === "retail-v1")!;
    const launch = RETAIL_PRICE_POLICIES.find((p) => p.version === "launch-v1")!;
    const sonnetRise = MODEL_PRICING.find(
      (entry) => entry.pricingVersion === "claude-sonnet-5-standard-2026-09",
    )!;

    // One event seen from two sides. A gap between them would be a window in
    // which Vibe knowingly sold below its own standard.
    expect(retail.effectiveTo).toBe(launch.effectiveFrom);
    expect(launch.effectiveFrom).toBe(sonnetRise.effectiveFrom);
  });
});
