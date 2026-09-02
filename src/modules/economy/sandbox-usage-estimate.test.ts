import { describe, expect, it } from "vitest";
import { VERCEL_SANDBOX_RATES } from "./infrastructure-rates";
import { estimateSandboxCost } from "./sandbox-usage-estimate";

/**
 * What a sandbox actually costs Vibe (ADR 0073).
 *
 * ## Why the expected figures are computed by hand here
 *
 * Because re-deriving them with `deriveSandboxCost` would assert that the
 * function equals itself. The numbers below are the rate card's own arithmetic
 * written out, so a change to either the rates or the derivation has to be
 * argued against a figure a person can check.
 *
 * The dimensions are production run `c462c083`'s, taken from
 * `sandbox_usage_events` — the run this whole sprint is about.
 */

/** The agent's own microVM on 2026-09-02: 8m00s of life, 111s of CPU. */
const AGENT_RUN = {
  purpose: "agent_execution" as const,
  sandboxDurationMs: 480_306,
  activeCpuMs: 111_421,
  outboundBytes: 0,
  vcpus: 4,
};

describe("the figure, against the rate card written out", () => {
  it("prices CPU, memory and creation the way the attested card says", () => {
    const estimate = estimateSandboxCost(AGENT_RUN);

    // CPU: 111.421 s × 4 vCPU = 0.1238 CPU-hours, at $0.128/CPU-hour.
    const cpu = Math.round(((111_421 * 4) / 3_600_000) * 128_000_000);
    // Memory: 4 vCPU × 2 GB/vCPU = 8 GB, held for 480.306 s, at $0.0212/GB-hour.
    const memory = Math.round(((480_306 * 8) / 3_600_000) * 21_200_000);
    // One microVM, at $0.60 per million.
    const creation = 600;

    expect(estimate.estimatedCostNanoUsd).toBe(cpu + memory + creation);
    // Roughly four cents, which is the order of magnitude worth sanity-checking:
    // a bug in the unit conversion moves this by a factor of a thousand.
    expect(estimate.estimatedCostNanoUsd).toBeGreaterThan(30_000_000);
    expect(estimate.estimatedCostNanoUsd).toBeLessThan(50_000_000);
  });

  it("carries the rate card version and the allocation it assumed", () => {
    // Both are what make the figure reproducible after the profile or the price
    // moves — the rule `rateCardByVersion` enforces, applied to an estimate.
    const estimate = estimateSandboxCost(AGENT_RUN);

    expect(estimate.pricingVersion).toBe(VERCEL_SANDBOX_RATES.pricingVersion);
    expect(estimate.vcpus).toBe(4);
  });

  it("halves the memory term for a preview, which runs on half the vCPUs", () => {
    const four = estimateSandboxCost({ ...AGENT_RUN, purpose: "change_preview", vcpus: 4 });
    const two = estimateSandboxCost({ ...AGENT_RUN, purpose: "change_preview", vcpus: 2 });

    // Both terms scale with the allocation, so the whole estimate does.
    expect(two.estimatedCostNanoUsd).toBeLessThan(four.estimatedCostNanoUsd!);
    expect(two.vcpus).toBe(2);
  });
});

describe("what it refuses to estimate", () => {
  it("stores nothing when the provider never reported CPU time", () => {
    // Most of Vibe's history. A total missing its CPU term is a floor, and a
    // floor written into a cost column reads as the whole bill — which is how a
    // business talks itself into a margin it does not have (`economy/cost.ts`).
    expect(
      estimateSandboxCost({ ...AGENT_RUN, activeCpuMs: null }).estimatedCostNanoUsd,
    ).toBeNull();
  });

  it("stores nothing when the sandbox's lifetime was never recorded", () => {
    expect(
      estimateSandboxCost({ ...AGENT_RUN, sandboxDurationMs: null }).estimatedCostNanoUsd,
    ).toBeNull();
  });

  it("prices a measured zero as zero, which is not the same as unmeasured", () => {
    // A sandbox that provisioned and did nothing still cost memory and a
    // creation. Zero CPU is a measurement; null is an absence.
    const estimate = estimateSandboxCost({ ...AGENT_RUN, activeCpuMs: 0 });

    expect(estimate.estimatedCostNanoUsd).not.toBeNull();
    expect(estimate.estimatedCostNanoUsd).toBeGreaterThan(0);
  });
});

describe("the value it must never produce", () => {
  it("treats an undefined dimension as absent rather than multiplying it into NaN", () => {
    /*
     * `deriveSandboxCost` guards on `null` specifically, so an `undefined`
     * arriving from a caller whose type said `number | null` slipped past it,
     * multiplied into `NaN`, satisfied `known`, and landed in the total —
     * caught by the agent execution suite writing `NaN` into a cost column.
     *
     * NaN is the worst value here: not a number, not a refusal, and it sums to
     * NaN. So every dimension is narrowed to a finite number or to absence.
     */
    const undefinedWall = estimateSandboxCost({
      ...AGENT_RUN,
      sandboxDurationMs: undefined as unknown as number,
    });

    expect(undefinedWall.estimatedCostNanoUsd).toBeNull();
    expect(Number.isNaN(undefinedWall.estimatedCostNanoUsd)).toBe(false);
  });

  it("refuses a dimension that is not a number at all", () => {
    const nonsense = estimateSandboxCost({
      ...AGENT_RUN,
      activeCpuMs: Number.NaN,
    });

    expect(nonsense.estimatedCostNanoUsd).toBeNull();
  });
});
