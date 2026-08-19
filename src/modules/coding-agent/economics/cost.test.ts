import { describe, expect, it } from "vitest";
import {
  summarizeChangeEconomics,
  summarizeExecutionEconomics,
  summarizeProviderEconomics,
  type ProviderUsageRow,
  type RunCostRow,
} from "./cost";

/**
 * The numbers a business decision would be made on.
 *
 * The one that matters most is the denominator. Runs #1 and #2 both finished,
 * both spent real provider money, and neither produced anything a person could
 * review — so counting "runs that completed" would have reported a healthy cost
 * per change for a product that had delivered none.
 */

function call(overrides: Partial<ProviderUsageRow> = {}): ProviderUsageRow {
  return {
    status: "succeeded",
    inputTokens: 2,
    outputTokens: 300,
    cacheReadInputTokens: 10_000,
    cacheCreationInputTokens: 2_000,
    thinkingTokens: 100,
    providerCostUsd: 0.01,
    latencyMs: 4000,
    ...overrides,
  };
}

describe("provider usage aggregates across many events", () => {
  /**
   * The cardinality fix's whole point: one run writes one row per sampling
   * call, and the cost is the sum of them. A model that expected one row per
   * run would report a thirty-fifth of what run #2 actually spent.
   */
  it("sums every call rather than reading one", () => {
    const summary = summarizeProviderEconomics([
      call({ providerCostUsd: 0.026374 }),
      call({ providerCostUsd: 0.011554 }),
      call({ providerCostUsd: 0.007941 }),
    ]);

    expect(summary.calls).toBe(3);
    expect(summary.costUsd).toBeCloseTo(0.045869, 6);
  });

  it("separates succeeded from failed calls", () => {
    const summary = summarizeProviderEconomics([call(), call({ status: "failed" })]);

    expect(summary.succeededCalls).toBe(1);
    expect(summary.failedCalls).toBe(1);
  });

  /** Cache reads are the cheap third of billed input; the ratio says whether caching worked. */
  it("computes the cache hit ratio over all billed input", () => {
    const summary = summarizeProviderEconomics([
      call({ inputTokens: 0, cacheReadInputTokens: 7_500, cacheCreationInputTokens: 2_500 }),
    ]);

    expect(summary.cacheHitRatio).toBeCloseTo(0.75, 6);
  });

  it("reports no ratio rather than zero when nothing was billed", () => {
    expect(summarizeProviderEconomics([]).cacheHitRatio).toBeNull();
    expect(summarizeProviderEconomics([]).averageInputTokensPerCall).toBeNull();
  });

  it("finds the single largest call", () => {
    const summary = summarizeProviderEconomics([
      call({ cacheReadInputTokens: 1_000, cacheCreationInputTokens: 0, inputTokens: 0 }),
      call({ cacheReadInputTokens: 40_000, cacheCreationInputTokens: 0, inputTokens: 0 }),
    ]);

    expect(summary.largestCallInputTokens).toBe(40_000);
  });

  /** A null token field is unknown, not zero — and must not skew a sum. */
  it("treats a null token count as absent", () => {
    const summary = summarizeProviderEconomics([
      call({ inputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null }),
    ]);

    expect(summary.inputTokens).toBe(0);
    expect(summary.cacheHitRatio).toBeNull();
  });
});

describe("a total that does not quietly omit half of itself", () => {
  it("is null while sandbox cost is unreported", () => {
    const economics = summarizeExecutionEconomics({
      usage: [call({ providerCostUsd: 0.5 })],
      sandbox: {
        activeCpuMs: 262_149,
        sandboxDurationMs: 634_502,
        networkEgressBytes: 6_286_274,
        networkIngressBytes: 580_363_930,
        // What every run has stored so far: the provider prices no sandbox.
        providerCostUsd: null,
      },
    });

    expect(economics.provider.costUsd).toBeCloseTo(0.5, 6);
    expect(economics.sandbox.activeCpuMs).toBe(262_149);
    expect(economics.totalCostUsd).toBeNull();
  });

  it("adds the two once both are known", () => {
    const economics = summarizeExecutionEconomics({
      usage: [call({ providerCostUsd: 0.5 })],
      sandbox: {
        activeCpuMs: 1000,
        sandboxDurationMs: 2000,
        networkEgressBytes: null,
        networkIngressBytes: null,
        providerCostUsd: 0.25,
      },
    });

    expect(economics.totalCostUsd).toBeCloseTo(0.75, 6);
  });

  it("reports the budget remaining, floored at zero", () => {
    const economics = summarizeExecutionEconomics({
      usage: [call({ providerCostUsd: 4 })],
      sandbox: null,
      providerBudgetUsd: 3,
    });

    expect(economics.providerBudgetRemainingUsd).toBe(0);
  });
});

describe("cost per successful change", () => {
  const rejected = (id: string, cost: number): RunCostRow => ({
    runId: id,
    providerCostUsd: cost,
    sandboxCostUsd: null,
    producedPreparedChange: false,
  });

  /**
   * Runs #1 and #2, exactly. Both terminal, both paid for, neither delivering.
   * The honest answer is "undefined", and it is the reason the denominator is
   * prepared changes rather than completed runs.
   */
  it("is undefined — not zero — when nothing has been prepared", () => {
    const economics = summarizeChangeEconomics([rejected("run-1", 0.31), rejected("run-2", 0.62)]);

    expect(economics.runs).toBe(2);
    expect(economics.successfulChanges).toBe(0);
    expect(economics.costPerSuccessfulChangeUsd).toBeNull();
    expect(economics.totalProviderCostUsd).toBeCloseTo(0.93, 6);
  });

  /** A failed run's money still counts. It was spent. */
  it("charges rejected runs to the numerator and not to the denominator", () => {
    const economics = summarizeChangeEconomics([
      rejected("run-1", 0.31),
      rejected("run-2", 0.62),
      { runId: "run-3", providerCostUsd: 0.5, sandboxCostUsd: null, producedPreparedChange: true },
    ]);

    expect(economics.successfulChanges).toBe(1);
    expect(economics.rejectedRunCostUsd).toBeCloseTo(0.93, 6);
    // Everything spent, over what was delivered — which is the number a price
    // would have to clear, not the cost of the one run that happened to work.
    expect(economics.costPerSuccessfulChangeUsd).toBeCloseTo(1.43, 6);
  });

  it("counts nothing at all as nothing", () => {
    expect(summarizeChangeEconomics([])).toMatchObject({
      runs: 0,
      successfulChanges: 0,
      totalProviderCostUsd: 0,
      costPerSuccessfulChangeUsd: null,
    });
  });
});
