import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARD_SCENARIOS } from "./credit-rate-card";
import {
  AI_INFLATION_STRESS_SCENARIOS,
  ALL_STRESS_SCENARIOS,
  COMBINED_STRESS_SCENARIO,
  FAILURE_RATE_STRESS_SCENARIOS,
  HISTORICAL_FAILURE_RATE,
  INFRASTRUCTURE_INFLATION_SCENARIOS,
  MARGIN_TARGETS,
  evaluateAllMarginTargets,
  evaluateMarginTargets,
  runAllStressTests,
  stressTestCreditEconomics,
} from "./stress-test";

const modelB = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;

describe("PART I — the named scenario sets match the sprint's own specification", () => {
  it("five failure-rate scenarios: 10/20/30/40/50%", () => {
    expect(FAILURE_RATE_STRESS_SCENARIOS.map((s) => s.failureRate)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    for (const s of FAILURE_RATE_STRESS_SCENARIOS) {
      expect(s.aiInflation).toBe("current");
      expect(s.infraInflation).toBe("current");
    }
  });

  it("four infrastructure-inflation scenarios: current/+25%/+50%/+100%", () => {
    expect(INFRASTRUCTURE_INFLATION_SCENARIOS.map((s) => s.infraInflation)).toEqual([
      "current",
      "+25%",
      "+50%",
      "+100%",
    ]);
    for (const s of INFRASTRUCTURE_INFLATION_SCENARIOS) expect(s.aiInflation).toBe("current");
  });

  it("four AI-inflation scenarios: current/+25%/+50%/+100%", () => {
    expect(AI_INFLATION_STRESS_SCENARIOS.map((s) => s.aiInflation)).toEqual([
      "current",
      "+25%",
      "+50%",
      "+100%",
    ]);
    for (const s of AI_INFLATION_STRESS_SCENARIOS) expect(s.infraInflation).toBe("current");
  });

  it("the combined stress scenario is exactly AI+50%, Infra+50%, failure rate 40%", () => {
    expect(COMBINED_STRESS_SCENARIO.aiInflation).toBe("+50%");
    expect(COMBINED_STRESS_SCENARIO.infraInflation).toBe("+50%");
    expect(COMBINED_STRESS_SCENARIO.failureRate).toBe(0.4);
  });

  it("14 total scenarios (5 + 4 + 4 + 1)", () => {
    expect(ALL_STRESS_SCENARIOS).toHaveLength(14);
  });

  it("the historical failure rate baseline used by the isolated inflation axes is 5/12", () => {
    // 5/11 until Sprint 0053; run #9 delivered, so the denominator moved. The
    // baseline is derived from the dataset rather than pinned as a constant,
    // which is why adding a run updates it here instead of leaving a stale
    // number quietly in the stress table.
    expect(HISTORICAL_FAILURE_RATE).toBeCloseTo(5 / 12, 10);
  });
});

describe("stressTestCreditEconomics — monotonic degradation under stress", () => {
  it("a higher failure rate strictly lowers the margin, all else equal", () => {
    const margins = FAILURE_RATE_STRESS_SCENARIOS.map(
      (s) => stressTestCreditEconomics(s, modelB).grossMargin,
    );
    for (let i = 1; i < margins.length; i++) {
      expect(margins[i], `${i}`).toBeLessThan(margins[i - 1]);
    }
  });

  it("higher infrastructure inflation strictly lowers the margin, all else equal", () => {
    const margins = INFRASTRUCTURE_INFLATION_SCENARIOS.map(
      (s) => stressTestCreditEconomics(s, modelB).grossMargin,
    );
    for (let i = 1; i < margins.length; i++) {
      expect(margins[i], `${i}`).toBeLessThan(margins[i - 1]);
    }
  });

  it("higher AI provider inflation strictly lowers the margin, all else equal", () => {
    const margins = AI_INFLATION_STRESS_SCENARIOS.map(
      (s) => stressTestCreditEconomics(s, modelB).grossMargin,
    );
    for (let i = 1; i < margins.length; i++) {
      expect(margins[i], `${i}`).toBeLessThan(margins[i - 1]);
    }
  });

  it("the combined stress scenario produces a lower margin than any single-axis stress at the same model", () => {
    const combined = stressTestCreditEconomics(COMBINED_STRESS_SCENARIO, modelB).grossMargin;
    const worstFailureOnly = stressTestCreditEconomics(FAILURE_RATE_STRESS_SCENARIOS[3], modelB).grossMargin; // 40%
    const worstInfraOnly = stressTestCreditEconomics(
      INFRASTRUCTURE_INFLATION_SCENARIOS[2], // +50%
      modelB,
    ).grossMargin;
    expect(combined).toBeLessThan(worstFailureOnly);
    expect(combined).toBeLessThan(worstInfraOnly);
  });

  it("revenue never changes across stress scenarios — only cost does", () => {
    const revenues = ALL_STRESS_SCENARIOS.map(
      (s) => stressTestCreditEconomics(s, modelB).averageRevenuePerDeliveredRunNanoUsd,
    );
    for (const r of revenues) expect(r).toBe(revenues[0]);
  });

  it("rejects a failure rate outside [0, 1)", () => {
    expect(() =>
      stressTestCreditEconomics({ label: "invalid", failureRate: 1, aiInflation: "current", infraInflation: "current" }, modelB),
    ).toThrow();
    expect(() =>
      stressTestCreditEconomics({ label: "invalid", failureRate: -0.1, aiInflation: "current", infraInflation: "current" }, modelB),
    ).toThrow();
  });

  it("is a pure computation — running the full table twice gives identical results", () => {
    expect(runAllStressTests()).toEqual(runAllStressTests());
  });

  it("runs every scenario against every one of the three rate cards (14 × 3 = 42 rows)", () => {
    expect(runAllStressTests()).toHaveLength(42);
  });
});

describe("PART J — margin targets", () => {
  it("checks against exactly 70/75/80/85%", () => {
    expect(MARGIN_TARGETS).toEqual([0.7, 0.75, 0.8, 0.85]);
  });

  it("evaluates all three models", () => {
    const results = evaluateAllMarginTargets();
    expect(results.map((r) => r.model)).toEqual(["A", "B", "C"]);
  });

  it("worst-case run margin is never higher than the average", () => {
    for (const result of evaluateAllMarginTargets()) {
      expect(result.worstCaseRunMargin, result.model).toBeLessThanOrEqual(result.averageGrossMargin);
    }
  });

  it("meetsTarget[target] is true only when every one of the five margins clears that target", () => {
    for (const result of evaluateAllMarginTargets()) {
      const margins = [
        result.averageGrossMargin,
        result.medianGrossMargin,
        result.worstCaseRunMargin,
        result.failureAdjustedGrossMargin,
        result.combinedStressMargin,
      ];
      for (const target of MARGIN_TARGETS) {
        const expected = margins.every((m) => m >= target);
        expect(result.meetsTarget[target], `${result.model} @ ${target}`).toBe(expected);
      }
    }
  });

  it("a more expensive model clears more (or equal) margin targets than a cheaper one", () => {
    const a = evaluateMarginTargets(CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "A")!);
    const c = evaluateMarginTargets(CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "C")!);
    const countTrue = (r: typeof a) => MARGIN_TARGETS.filter((t) => r.meetsTarget[t]).length;
    expect(countTrue(c)).toBeGreaterThanOrEqual(countTrue(a));
  });
});
