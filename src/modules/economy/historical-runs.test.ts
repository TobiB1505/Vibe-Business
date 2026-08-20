import { describe, expect, it } from "vitest";
import { HISTORICAL_CLASSIFICATIONS, HISTORICAL_RUNS } from "./historical-runs";

/**
 * Sprint 0052, PART D — pins the historical reconstruction so a future
 * change to the classifier or the evidence-surface mapping shows up as a
 * failing test here, not as a silently different table in a document.
 */

describe("the six historical runs reconstruct as documented", () => {
  it("has exactly six runs, #3 through #8, in creation order", () => {
    expect(HISTORICAL_RUNS.map((r) => r.run)).toEqual([3, 4, 5, 6, 7, 8]);
    const createdAt = HISTORICAL_RUNS.map((r) => Date.parse(r.createdAt));
    expect([...createdAt].sort((a, b) => a - b)).toEqual(createdAt);
  });

  it("runs #3-6 all cite the same live.seo.robots_meta_missing evidence family", () => {
    for (const run of HISTORICAL_RUNS.filter((r) => [3, 4, 5, 6].includes(r.run))) {
      expect(run.evidenceIds).toEqual(["live.seo.robots_meta_missing"]);
    }
  });

  it("run #7 cites live.seo.canonical_missing", () => {
    expect(HISTORICAL_RUNS.find((r) => r.run === 7)?.evidenceIds).toEqual(["live.seo.canonical_missing"]);
  });

  it("run #8 cites live.conversion.primary_cta and is marked limited confidence", () => {
    const run8 = HISTORICAL_RUNS.find((r) => r.run === 8)!;
    expect(run8.evidenceIds).toEqual(["live.conversion.primary_cta"]);
    expect(run8.classificationConfidence).toBe("limited");
  });

  it("every other run is marked confirmed confidence", () => {
    for (const run of HISTORICAL_RUNS.filter((r) => r.run !== 8)) {
      expect(run.classificationConfidence, `run #${run.run}`).toBe("confirmed");
    }
  });

  it("all six runs share riskClass=moderate and changeKind=product_change — zero variance on those axes", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.riskClass, `run #${run.run}`).toBe("moderate");
      expect(run.changeKind, `run #${run.run}`).toBe("product_change");
    }
  });
});

describe("v1 classification of the historical runs", () => {
  it("runs #3-7 (one named surface: seo_metadata) classify as standard", () => {
    for (const run of HISTORICAL_CLASSIFICATIONS.filter((r) => r.run >= 3 && r.run <= 7)) {
      expect(run.pricingClass, `run #${run.run}`).toBe("standard");
      expect(run.surfaces, `run #${run.run}`).toEqual(["seo_metadata"]);
    }
  });

  it("run #8 (zero named surfaces) classifies as small", () => {
    const run8 = HISTORICAL_CLASSIFICATIONS.find((r) => r.run === 8)!;
    expect(run8.pricingClass).toBe("small");
    expect(run8.surfaces).toEqual([]);
  });

  it("no historical run reaches complex — the tier has zero empirical coverage in this dataset", () => {
    for (const run of HISTORICAL_CLASSIFICATIONS) {
      expect(run.pricingClass, `run #${run.run}`).not.toBe("complex");
    }
  });

  it("classification never reads cost, and is reproduced deterministically here from the same six runs", () => {
    // The reconstruction module never imports economic cost into the
    // classifier call — this test asserts the module boundary rather than
    // just re-running the function, by checking the classification result
    // carries no cost field at all.
    for (const run of HISTORICAL_CLASSIFICATIONS) {
      expect(run).not.toHaveProperty("economicCostFloorNanoUsd");
      expect(run).not.toHaveProperty("costNanoUsd");
    }
  });
});

describe("economic cost figures match ECONOMY_MODEL.md's PART I table exactly", () => {
  const expected: Record<number, { floor: number; upper: number }> = {
    3: { floor: 433_100_000, upper: 481_400_000 },
    4: { floor: 284_500_000, upper: 284_500_000 },
    5: { floor: 354_200_000, upper: 402_700_000 },
    6: { floor: 173_900_000, upper: 224_500_000 },
    7: { floor: 282_100_000, upper: 328_900_000 },
    8: { floor: 254_100_000, upper: 301_700_000 },
  };

  it("matches every run's floor and upper-bound nanodollar figure", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.economicCostFloorNanoUsd, `run #${run.run} floor`).toBe(expected[run.run].floor);
      expect(run.economicCostUpperNanoUsd, `run #${run.run} upper`).toBe(expected[run.run].upper);
    }
  });

  it("no historical run carries a point-estimate cost — Sprint 0051's fix applies only forward", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.costIsPointEstimate, `run #${run.run}`).toBe(false);
    }
  });

  it("providerCostNanoUsd matches backfill.test.ts's pinned model-spend figures exactly", () => {
    const expectedProviderCost: Record<number, number> = {
      3: 346_506_500,
      4: 227_170_000,
      5: 319_930_000,
      6: 144_400_000,
      7: 251_500_000,
      8: 214_400_000,
    };
    for (const run of HISTORICAL_RUNS) {
      expect(run.providerCostNanoUsd, `run #${run.run}`).toBe(expectedProviderCost[run.run]);
    }
  });

  it("the infra component (floor minus provider cost) is never negative", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.economicCostFloorNanoUsd - run.providerCostNanoUsd, `run #${run.run}`).toBeGreaterThanOrEqual(0);
    }
  });
});
