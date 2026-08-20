import { describe, expect, it } from "vitest";
import { analyzeClassCostDifferentiation, smallVersusStandardCostGapRatio } from "./class-cost-analysis";

/**
 * Sprint 0052, PART K. The headline finding this pins: `complex` has zero
 * historical runs, so any statement about its real cost is unsupported by
 * data — this must show up as `runCount: 0` and null stats, never as a
 * silently-substituted average.
 */

describe("analyzeClassCostDifferentiation", () => {
  const stats = analyzeClassCostDifferentiation();

  it("covers all three classes, small/standard/complex in order", () => {
    expect(stats.map((s) => s.pricingClass)).toEqual(["small", "standard", "complex"]);
  });

  it("small has exactly 1 run (run #8) and no standard deviation — one point is not a spread", () => {
    const small = stats.find((s) => s.pricingClass === "small")!;
    expect(small.runCount).toBe(1);
    expect(small.runs).toEqual([8]);
    expect(small.standardDeviationNanoUsd).toBeNull();
    expect(small.meanFloorNanoUsd).toBe(254_100_000);
  });

  it("standard has exactly 6 runs (#3-7 and #9) with a real standard deviation", () => {
    const standard = stats.find((s) => s.pricingClass === "standard")!;
    expect(standard.runCount).toBe(6);
    expect(standard.runs).toEqual([3, 4, 5, 6, 7, 9]);
    expect(standard.standardDeviationNanoUsd).not.toBeNull();
    expect(standard.standardDeviationNanoUsd).toBeGreaterThan(0);
  });

  it("complex has zero runs and every stat is null — the honest gap this sprint must report", () => {
    const complex = stats.find((s) => s.pricingClass === "complex")!;
    expect(complex.runCount).toBe(0);
    expect(complex.meanFloorNanoUsd).toBeNull();
    expect(complex.standardDeviationNanoUsd).toBeNull();
    expect(complex.minFloorNanoUsd).toBeNull();
    expect(complex.maxFloorNanoUsd).toBeNull();
    expect(complex.runs).toEqual([]);
  });

  it("standard's mean cost is materially above small's, but this is a 5-vs-1 comparison, not a robust one", () => {
    const small = stats.find((s) => s.pricingClass === "small")!;
    const standard = stats.find((s) => s.pricingClass === "standard")!;
    expect(standard.meanFloorNanoUsd!).toBeGreaterThan(small.meanFloorNanoUsd!);
  });
});

describe("smallVersusStandardCostGapRatio", () => {
  it("is standard's mean divided by small's mean, and is greater than 1", () => {
    const ratio = smallVersusStandardCostGapRatio();
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(1);
    // Real figures: standard mean $0.30556, small mean $0.2541 -> ratio ~1.20
    expect(ratio!).toBeCloseTo(1.2, 1);
  });
});
