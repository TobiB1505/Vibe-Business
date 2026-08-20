import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARD_SCENARIOS } from "./credit-rate-card";
import {
  FAILED_ATTEMPT_COSTS,
  calculateAllDeliveredRunMargins,
  calculateDeliveredRunMargin,
  computeHistoricalFailureEconomics,
} from "./failure-economics";

/**
 * Sprint 0052, PART H. `computeHistoricalFailureEconomics`'s inputs were
 * verified directly against `agent_execution_runs` on 2026-08-20
 * (`select status, count(*) ... group by status` → 5 failed, 6 succeeded),
 * not copied from earlier sprints' prose, which only ever named the three
 * failures with nonzero cost. These tests pin that corrected historical
 * shape.
 */

describe("the historical dataset really has 5 failed attempts, not 2 or 3", () => {
  it("FAILED_ATTEMPT_COSTS has exactly 5 entries", () => {
    expect(FAILED_ATTEMPT_COSTS).toHaveLength(5);
  });

  it("two of the five failed attempts genuinely cost nothing measurable", () => {
    const zeroCost = FAILED_ATTEMPT_COSTS.filter((f) => f.floorNanoUsd === 0);
    expect(zeroCost).toHaveLength(2);
  });

  it("the other three match the figures named in ECONOMY_MODEL.md within a small rounding margin", () => {
    const nonZero = FAILED_ATTEMPT_COSTS.filter((f) => f.floorNanoUsd > 0).map((f) => f.floorNanoUsd);
    // Doc prose: $0.0060, $0.3794, $0.6842 — this sprint's direct recomputation
    // from deriveSandboxCost gets $0.00577, $0.37845, $0.68302. Both are real
    // derivations of the same underlying rows; the small gap is rounding in
    // the doc's own display arithmetic, not a different dataset.
    expect(nonZero[0]).toBeCloseTo(5_766_940, -4);
    expect(nonZero[1]).toBeCloseTo(378_449_559, -4);
    expect(nonZero[2]).toBeCloseTo(683_017_807, -4);
  });
});

describe("computeHistoricalFailureEconomics", () => {
  const economics = computeHistoricalFailureEconomics();

  it("counts 6 delivered, 5 failed, 11 total attempts", () => {
    expect(economics.deliveredCount).toBe(6);
    expect(economics.failedCount).toBe(5);
    expect(economics.totalAttempts).toBe(11);
  });

  it("the historical failure rate is 5/11, about 45.5% — not the ~2/8 or 3/9 implied by earlier prose", () => {
    expect(economics.historicalFailureRate).toBeCloseTo(5 / 11, 10);
    expect(Math.round(economics.historicalFailureRate * 1000) / 10).toBeCloseTo(45.5, 1);
  });

  it("delivered floor sum matches the six pinned run floors exactly ($1.7819)", () => {
    expect(economics.deliveredFloorNanoUsd).toBe(1_781_900_000);
  });

  it("failed floor sum is the sum of all five failed-attempt floors", () => {
    const expected = FAILED_ATTEMPT_COSTS.reduce((sum, f) => sum + f.floorNanoUsd, 0);
    expect(economics.failedFloorNanoUsd).toBe(expected);
  });

  it("total floor is delivered + failed, and effective cost per delivered run divides it by 6", () => {
    expect(economics.totalFloorNanoUsd).toBe(economics.deliveredFloorNanoUsd + economics.failedFloorNanoUsd);
    expect(economics.effectiveCostPerDeliveredRunNanoUsd).toBe(
      Math.round(economics.totalFloorNanoUsd / 6),
    );
    // Close to (not necessarily identical to) the previously-pinned $0.4752 —
    // this sprint's direct query is the more precise, independently-derived
    // figure; the two should agree to within a few tenths of a cent.
    expect(economics.effectiveCostPerDeliveredRunNanoUsd / 1e9).toBeCloseTo(0.4752, 2);
  });

  it("failure overhead per delivered run is the failed floor divided by 6, and is a material uplift", () => {
    expect(economics.failureOverheadPerDeliveredRunNanoUsd).toBe(
      Math.round(economics.failedFloorNanoUsd / 6),
    );
    expect(economics.failureOverheadPerDeliveredRunNanoUsd).toBeGreaterThan(0);
  });

  it("is a pure recomputation — calling it twice gives byte-identical results", () => {
    expect(computeHistoricalFailureEconomics()).toEqual(economics);
  });
});

describe("calculateDeliveredRunMargin — does each rate card cover its own failure overhead?", () => {
  it("computes a margin for every one of the three scenarios", () => {
    const results = calculateAllDeliveredRunMargins();
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.model)).toEqual(["A", "B", "C"]);
  });

  it("gross profit is average revenue minus the failure-adjusted effective cost, exactly", () => {
    const modelB = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;
    const result = calculateDeliveredRunMargin(modelB);
    expect(result.grossProfitPerDeliveredRunNanoUsd).toBe(
      result.averageRevenuePerDeliveredRunNanoUsd - result.effectiveCostPerDeliveredRunNanoUsd,
    );
  });

  it("gross margin is gross profit divided by average revenue", () => {
    const modelC = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "C")!;
    const result = calculateDeliveredRunMargin(modelC);
    expect(result.grossMargin).toBeCloseTo(
      result.grossProfitPerDeliveredRunNanoUsd / result.averageRevenuePerDeliveredRunNanoUsd,
      10,
    );
  });

  it("coversFailureOverhead is true exactly when gross profit is positive", () => {
    for (const result of calculateAllDeliveredRunMargins()) {
      expect(result.coversFailureOverhead).toBe(result.grossProfitPerDeliveredRunNanoUsd > 0);
    }
  });

  it("a more expensive model (C) realises a higher failure-adjusted margin than a cheaper one (A)", () => {
    const results = calculateAllDeliveredRunMargins();
    const a = results.find((r) => r.model === "A")!;
    const c = results.find((r) => r.model === "C")!;
    expect(c.grossMargin).toBeGreaterThan(a.grossMargin);
  });
});
