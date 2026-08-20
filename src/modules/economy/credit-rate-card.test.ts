import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "@/modules/credits/rating";
import {
  CREDIT_RATE_CARD_SCENARIOS,
  RETAIL_NANO_USD_PER_CREDIT,
  formatCreditRetailValue,
  simulateAllHistoricalRuns,
  simulateCreditRateCard,
  type RunEconomicCost,
} from "./credit-rate-card";

/**
 * Sprint 0052, PARTS E-G. Every number here is a simulation input the sprint
 * itself specified ("these are scenarios, not a decision") or a real
 * historical cost already pinned in `historical-runs.test.ts` — nothing is
 * invented in this test file.
 */

describe("PART E — the Credit unit is a retail constant, not an infra cost", () => {
  it("1 Credit simulates at exactly $0.01", () => {
    expect(RETAIL_NANO_USD_PER_CREDIT).toBe(10_000_000);
    expect(formatCreditRetailValue(1)).toBe("$0.01");
  });

  it("is an integer number of nanodollars, matching the rest of the economy module's arithmetic discipline", () => {
    expect(Number.isInteger(RETAIL_NANO_USD_PER_CREDIT)).toBe(true);
  });
});

describe("PART F — the three scenarios match the sprint's own specification exactly", () => {
  it("Model A (Entry/Aggressive): 100/200/350", () => {
    const a = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "A")!;
    expect(a.creditsByClass).toEqual({ small: 100, standard: 200, complex: 350 });
  });

  it("Model B (Balanced): 150/250/450", () => {
    const b = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;
    expect(b.creditsByClass).toEqual({ small: 150, standard: 250, complex: 450 });
  });

  it("Model C (Margin Focused): 200/300/500", () => {
    const c = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "C")!;
    expect(c.creditsByClass).toEqual({ small: 200, standard: 300, complex: 500 });
  });

  it("every scenario prices complex highest, standard in the middle, small lowest", () => {
    for (const scenario of CREDIT_RATE_CARD_SCENARIOS) {
      const { small, standard, complex } = scenario.creditsByClass;
      expect(small, scenario.model).toBeLessThan(standard);
      expect(standard, scenario.model).toBeLessThan(complex);
    }
  });
});

describe("PART G — simulateCreditRateCard arithmetic", () => {
  const cost: RunEconomicCost = {
    run: 99,
    pricingClass: "standard",
    economicCostFloorNanoUsd: 200_000_000, // $0.20
    economicCostUpperNanoUsd: 300_000_000, // $0.30
  };

  it("retail revenue is credits × $0.01, exactly", () => {
    const modelB = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;
    const result = simulateCreditRateCard(modelB, cost);
    expect(result.credits).toBe(250);
    expect(result.retailRevenueNanoUsd).toBe(2_500_000_000); // $2.50
  });

  it("gross profit floor uses the cost floor (best case), gross profit upper uses the cost upper bound (worst case)", () => {
    const modelB = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;
    const result = simulateCreditRateCard(modelB, cost);
    // $2.50 revenue - $0.20 floor = $2.30; $2.50 - $0.30 upper = $2.20
    expect(result.grossProfitFloorNanoUsd).toBe(2_300_000_000);
    expect(result.grossProfitUpperNanoUsd).toBe(2_200_000_000);
  });

  it("gross margin is gross profit divided by revenue, for both floor and upper", () => {
    const modelB = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;
    const result = simulateCreditRateCard(modelB, cost);
    expect(result.grossMarginFloor).toBeCloseTo(2_300_000_000 / 2_500_000_000, 10);
    expect(result.grossMarginUpper).toBeCloseTo(2_200_000_000 / 2_500_000_000, 10);
    expect(result.grossMarginFloor).toBeGreaterThan(result.grossMarginUpper);
  });

  it("a cheaper model charges fewer credits for the same class and produces a lower margin", () => {
    const modelA = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "A")!;
    const modelC = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "C")!;
    const resultA = simulateCreditRateCard(modelA, cost);
    const resultC = simulateCreditRateCard(modelC, cost);
    expect(resultA.credits).toBeLessThan(resultC.credits);
    expect(resultA.grossMarginFloor).toBeLessThan(resultC.grossMarginFloor);
  });
});

describe("simulateAllHistoricalRuns — the full PART G table", () => {
  const rows = simulateAllHistoricalRuns();

  it("has 6 runs × 3 models = 18 rows", () => {
    expect(rows).toHaveLength(18);
  });

  it("every row's class matches the run's own reconstructed classification", () => {
    const run3Rows = rows.filter((r) => r.run === 3);
    expect(run3Rows).toHaveLength(3);
    for (const row of run3Rows) expect(row.pricingClass).toBe("standard");

    const run8Rows = rows.filter((r) => r.run === 8);
    expect(run8Rows).toHaveLength(3);
    for (const row of run8Rows) expect(row.pricingClass).toBe("small");
  });

  it("is a pure computation — calling it twice never mutates real state and produces identical output", () => {
    const again = simulateAllHistoricalRuns();
    expect(again).toEqual(rows);
  });

  it("touches no billing, credits, or Stripe module — CREDIT_RATE_CARDS remains empty regardless of this simulation running", () => {
    expect(CREDIT_RATE_CARDS).toEqual([]);
  });
});
