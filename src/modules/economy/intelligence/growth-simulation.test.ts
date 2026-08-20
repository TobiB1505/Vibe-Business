import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "@/modules/credits/rating";
import {
  ECONOMY_SIMULATION_SCENARIOS,
  REPOSITORY_GROWTH_FACTORS,
  repositoryGrowthMultiplier,
  runEconomySimulations,
  simulateEconomy,
} from "./growth-simulation";
import { resolveEconomyModel } from "./model-version";

const MODEL = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));

describe("repository growth is the axis the earlier stress model could not see", () => {
  it("raises the multiplier as the product grows", () => {
    const multipliers = REPOSITORY_GROWTH_FACTORS.map((factor) =>
      repositoryGrowthMultiplier(factor, MODEL),
    );

    expect(multipliers[0]).toBeCloseTo(1);
    for (const [index, multiplier] of multipliers.entries()) {
      const next = multipliers[index + 1];
      if (next === undefined) continue;
      expect(next).toBeGreaterThanOrEqual(multiplier);
    }
  });

  /**
   * A limitation worth stating rather than hiding: past roughly 5x, the
   * repository policy's ceiling is doing the work instead of the evidence, so
   * the simulation cannot distinguish a 5x product from a 10x one. Widening
   * that requires measuring a large repository, not a larger bound.
   */
  it("saturates at the policy ceiling, so past 5x it stops discriminating", () => {
    expect(repositoryGrowthMultiplier(5, MODEL)).toBe(MODEL.repositoryPolicy.maxMultiplier);
    expect(repositoryGrowthMultiplier(10, MODEL)).toBe(repositoryGrowthMultiplier(5, MODEL));
  });

  it("costs more at 5x than at 1x, at the same revenue", () => {
    const flat = simulateEconomy(
      { label: "flat", aiInflation: "current", infraInflation: "current", failureRate: 0, repositoryGrowth: 1 },
      "C",
    );
    const grown = simulateEconomy(
      { label: "grown", aiInflation: "current", infraInflation: "current", failureRate: 0, repositoryGrowth: 5 },
      "C",
    );

    expect(grown.effectiveCostPerDeliveredRunNanoUsd).toBeGreaterThan(
      flat.effectiveCostPerDeliveredRunNanoUsd,
    );
    // Revenue does not move: the class is the same class, which is the entire
    // point of pricing by class rather than by cost.
    expect(grown.averageRevenuePerDeliveredRunNanoUsd).toBe(flat.averageRevenuePerDeliveredRunNanoUsd);
    expect(grown.grossMargin).toBeLessThan(flat.grossMargin);
  });
});

describe("every axis is simulated, and the compound case with them", () => {
  it("covers provider inflation, infrastructure, failure rate and growth", () => {
    const labels = ECONOMY_SIMULATION_SCENARIOS.map((scenario) => scenario.label);

    expect(labels).toContain("AI provider +100%");
    expect(labels).toContain("infrastructure +50%");
    expect(labels).toContain("failure rate 40%");
    expect(labels).toContain("repository 10x");
    expect(labels).toContain("everything at once");
  });

  it("produces one result per scenario per rate card", () => {
    const results = runEconomySimulations();

    expect(results).toHaveLength(ECONOMY_SIMULATION_SCENARIOS.length * 3);
    for (const result of results) {
      expect(Number.isFinite(result.grossMargin)).toBe(true);
      expect(result.recommendation).not.toBe("");
    }
  });

  /**
   * The headline. Each axis alone is survivable at Model C's simulated prices;
   * all four together are not — 59% against a 75% target. That is the number a
   * later pricing decision has to answer, and it exists only because repository
   * growth is now one of the axes.
   */
  it("shows the compound scenario falling below the margin target", () => {
    const compound = simulateEconomy(
      { label: "everything at once", aiInflation: "+50%", infraInflation: "+50%", failureRate: 0.4, repositoryGrowth: 5 },
      "C",
    );

    expect(compound.grossMargin).toBeLessThan(MODEL.marginTarget);
    expect(compound.grossMargin).toBeGreaterThan(0.5);
    expect(compound.risk).toBe("watch");
    expect(compound.recommendation).toContain("below the 75% target");
  });

  it("holds the target on every single-axis scenario", () => {
    const singleAxis = ECONOMY_SIMULATION_SCENARIOS.filter(
      (scenario) => scenario.label !== "everything at once",
    );

    for (const scenario of singleAxis) {
      const result = simulateEconomy(scenario, "C");
      expect(result.risk, scenario.label).toBe("acceptable");
    }
  });

  it("classifies a scenario that loses money as unsustainable", () => {
    // Model A at its weakest, compounded hard enough to invert the margin.
    const result = simulateEconomy(
      { label: "extreme", aiInflation: "+100%", infraInflation: "+100%", failureRate: 0.9, repositoryGrowth: 10 },
      "A",
    );

    expect(result.grossMargin).toBeLessThan(0);
    expect(result.risk).toBe("unsustainable");
    expect(result.recommendation).toContain("loses money");
  });
});

describe("the simulation activates nothing", () => {
  it("leaves the production rate card empty", () => {
    runEconomySimulations();

    expect(CREDIT_RATE_CARDS).toEqual([]);
  });

  it("refuses a rate card scenario that does not exist", () => {
    expect(() =>
      simulateEconomy(
        { label: "x", aiInflation: "current", infraInflation: "current", failureRate: 0, repositoryGrowth: 1 },
        "Z" as never,
      ),
    ).toThrow(/Unknown rate card scenario/);
  });
});
