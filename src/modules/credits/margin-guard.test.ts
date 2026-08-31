import { describe, expect, it } from "vitest";
import { MODEL_PRICING, type ModelPricing } from "@/modules/ai/pricing";
import {
  ASSUMED_EUR_USD,
  CREDIT_VALUE_NANO_USD,
  LAUNCH_V1_COST_PROFILES,
  MARGIN_FLOOR,
  TARGET_COST_SHARE,
  economicsAssumptions,
  launchV1Margins,
  marginFor,
  targetPriceCreditUnits,
  uncoveredPrices,
} from "./margin-guard";
import { RETAIL_PRICE_POLICIES, resolveRetailPrice } from "./retail";

/**
 * The guard, and the proof it still has teeth.
 *
 * Every assertion is evaluated against the provider rates in force at the
 * instant it names, so a rate change turns a green suite red on the day it
 * lands rather than on the day somebody reads an invoice.
 *
 * The rise this was built for — Sonnet 5 to $3/$15 on 2026-09-01 — was
 * withdrawn by Anthropic before it took effect. That makes the *live* rates
 * unable to demonstrate the guard working, so the demonstration is synthetic
 * and explicit: a hypothetical future price book, priced through the same
 * `calculateProviderCost` seam, must drive a margin below the floor.
 */

/** Inside `launch-v1`. */
const LAUNCH = new Date("2026-09-15T00:00:00.000Z");

/**
 * A hypothetical provider price book, at a multiple of today's Sonnet 5 rates.
 *
 * Built from the real row rather than typed out, so it cannot drift from what
 * is actually charged, and so the only thing the test varies is the multiplier.
 */
function sonnetRatesMultipliedBy(multiplier: number): readonly ModelPricing[] {
  return MODEL_PRICING.map((entry) =>
    entry.model === "claude-sonnet-5"
      ? {
          ...entry,
          pricingVersion: `hypothetical-sonnet-5-x${multiplier}`,
          inputNanoUsdPerToken: entry.inputNanoUsdPerToken * multiplier,
          outputNanoUsdPerToken: entry.outputNanoUsdPerToken * multiplier,
          cacheReadNanoUsdPerToken: entry.cacheReadNanoUsdPerToken * multiplier,
          cacheWriteNanoUsdPerToken: entry.cacheWriteNanoUsdPerToken * multiplier,
        }
      : entry,
  );
}

const AUDIT = LAUNCH_V1_COST_PROFILES.find((p) => p.operation === "business_audit")!;

describe("launch-v1 margins at the rates in force", () => {
  it("every measured price clears the floor", () => {
    const reports = launchV1Margins(LAUNCH);
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

  it("every measured price also meets the target it was derived against", () => {
    // The floor is where a human should look; the target is what the card was
    // built to. A price sitting between them is a price that has quietly
    // stopped meeting its own derivation.
    for (const report of launchV1Margins(LAUNCH)) {
      expect(report.margin, `${report.operation} is below the ${1 - TARGET_COST_SHARE} target`)
        .toBeGreaterThanOrEqual(1 - TARGET_COST_SHARE);
    }
  });

  it("ships the price the derivation rule actually produces", () => {
    // Checked against the executable rule rather than against numbers retyped
    // from a document, which is how a card and its documentation drift apart.
    for (const report of launchV1Margins(LAUNCH)) {
      // The agent tiers are deliberately above their derived price — see the
      // conservative-modelled test below — so only the measured ones are pinned.
      if (report.operation === "agent_execution") continue;
      expect(report.credits, `${report.operation}`).toBe(
        targetPriceCreditUnits(report.costNanoUsd),
      );
    }
  });
});

describe("the guard still refuses a provider increase", () => {
  it("reduces the computed margin when provider rates rise", () => {
    // Monotonic response through the real `calculateProviderCost` seam. If this
    // ever stops differing, the guard has been disconnected from
    // `ai/pricing.ts` and is asserting a constant against itself.
    const live = marginFor(AUDIT, LAUNCH)!;
    const risen = marginFor(AUDIT, LAUNCH, sonnetRatesMultipliedBy(1.5))!;

    expect(risen.costNanoUsd).toBeGreaterThan(live.costNanoUsd);
    expect(risen.margin).toBeLessThan(live.margin);
    // The exact increase that was cancelled: 80.3% -> 70.4%. It lands just
    // above the floor, which is itself worth knowing — a 50% provider rise is
    // roughly the whole distance from the target to the floor.
    expect(risen.margin).toBeLessThan(0.71);
  });

  it("falls below the floor on a large enough increase", () => {
    const doubled = marginFor(AUDIT, LAUNCH, sonnetRatesMultipliedBy(2))!;

    expect(doubled.margin).toBeLessThan(MARGIN_FLOOR);
  });

  it("fails the floor assertion the live suite relies on", () => {
    // Not "a number is small" — the actual guard, run against the hypothetical
    // book, producing the actual failure. This is what proves the first
    // describe block above would catch a real increase.
    const reports = LAUNCH_V1_COST_PROFILES.map((profile) =>
      marginFor(profile, LAUNCH, sonnetRatesMultipliedBy(2)),
    ).filter((r): r is NonNullable<typeof r> => r !== null);

    const breached = reports.filter((r) => r.margin < MARGIN_FLOOR);
    expect(breached.length).toBeGreaterThan(0);
  });

  it("leaves the real price book untouched while doing it", () => {
    const sonnet = MODEL_PRICING.find((entry) => entry.model === "claude-sonnet-5")!;
    expect(sonnet.inputNanoUsdPerToken).toBe(2_000);
    expect(sonnet.outputNanoUsdPerToken).toBe(10_000);
  });
});

describe("what the guard deliberately does not cover", () => {
  it("names every price with no measured profile behind it", () => {
    // Exactly three, and each for a reason recorded in `retail.ts`'s
    // `PriceBasis`. A fourth appearing here is a decision somebody has to make,
    // not a gap that quietly opens.
    expect(uncoveredPrices(LAUNCH)).toEqual([
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
    const covered = launchV1Margins(LAUNCH).filter((r) => r.operation === "agent_execution");
    expect(covered).toHaveLength(1);
    expect(covered[0]!.pricingClass).toBe("standard");
  });

  it("prices the agent above its derived price, on purpose", () => {
    // The mean is not the exposure. `standard` derives to 125 Credits at the
    // corrected rates, but the worst agent run ever measured would sit on the
    // floor at that price; 200 keeps the tail clear. Asserted as a deliberate
    // inequality so that quietly dropping it to the derived number fails.
    const standard = launchV1Margins(LAUNCH).find((r) => r.operation === "agent_execution")!;

    expect(standard.credits).toBeGreaterThan(targetPriceCreditUnits(standard.costNanoUsd));
    expect(resolveRetailPrice("agent_execution", LAUNCH)?.basis).toBe("modelled");
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

  it("declares the target cost share once, and derives against that value", () => {
    expect(TARGET_COST_SHARE).toBe(0.2);
    // The rule, checked at a known input: $0.1219 / 0.20 / $0.017640 = 34.5,
    // rounded up to the nearest five.
    expect(targetPriceCreditUnits(121_900_000)).toBe(35_000);
  });

  it("reports every assumption alongside the margins", () => {
    // A contribution margin quoted without the credit value and the FX rate
    // behind it is a number nobody can check.
    expect(economicsAssumptions()).toEqual({
      creditValueNanoUsd: CREDIT_VALUE_NANO_USD,
      assumedEurUsd: ASSUMED_EUR_USD,
      targetCostShare: TARGET_COST_SHARE,
      marginFloor: MARGIN_FLOOR,
    });
  });

  it("states the FX rate rather than observing one", () => {
    // No FX service exists and none is wanted here. The value is a declared
    // planning assumption; this test is where that is written down in code.
    expect(ASSUMED_EUR_USD).toBe(1.08);
  });

  it("supersedes retail-v1 at a single instant, with no provider step behind it", () => {
    const retail = RETAIL_PRICE_POLICIES.find((p) => p.version === "retail-v1")!;
    const launch = RETAIL_PRICE_POLICIES.find((p) => p.version === "launch-v1")!;

    // The two policies still meet exactly, so no instant resolves to neither
    // or to both. What changed is the reason: this instant used to mirror a
    // scheduled Sonnet increase, and that increase was withdrawn — the
    // provider price book now spans it without a step.
    expect(retail.effectiveTo).toBe(launch.effectiveFrom);

    const before = marginFor(AUDIT, new Date("2026-08-31T23:59:59.999Z"))!;
    const after = marginFor(AUDIT, new Date("2026-09-01T00:00:00.000Z"))!;
    expect(after.costNanoUsd).toBe(before.costNanoUsd);
    expect(after.pricingVersion).toBe(before.pricingVersion);
  });
});
