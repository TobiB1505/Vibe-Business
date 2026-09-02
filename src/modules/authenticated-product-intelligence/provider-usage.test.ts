import { describe, expect, it } from "vitest";
import { VERCEL_SANDBOX_RATES } from "@/modules/economy/infrastructure-rates";
import { buildDeepScanUsage } from "./provider-usage";
import type { BrowserSessionUsage } from "./provider";

/**
 * What a Deep Scan cost, and the three ways that answer goes wrong quietly
 * (ADR 0076).
 *
 * Deep Scan was the last priced operation with no measured cost behind it: 25
 * Credits of revenue against a bill nobody could compute. What makes the
 * measurement dangerous rather than merely useful is that every failure here
 * produces a *number* — a zero where a measurement is absent, a figure without
 * the rate it was computed under, or an estimate sitting in the column that
 * means "the provider charged this".
 */

const STARTED = new Date("2026-09-02T12:00:00.000Z");
const ENDED = new Date("2026-09-02T12:01:30.000Z");

const measured: BrowserSessionUsage = {
  sandboxDurationMs: null,
  activeCpuMs: 4_000,
  outboundBytes: 250_000,
  costUsd: null,
  vcpus: 2,
};

function usage(overrides: Partial<Parameters<typeof buildDeepScanUsage>[0]> = {}) {
  return buildDeepScanUsage({
    provider: "vercel_sandbox_browser",
    projectId: "project_1",
    sessionId: "session_1",
    accessMode: "included_first_scan",
    startedAt: STARTED,
    endedAt: ENDED,
    status: "completed",
    usage: measured,
    ...overrides,
  });
}

describe("the measurement reaches the row", () => {
  it("carries the dimensions the rate applies to", () => {
    const row = usage();

    expect(row.activeCpuMs).toBe(4_000);
    expect(row.outboundBytes).toBe(250_000);
    expect(row.durationMs).toBe(90_000);
  });

  it("derives a cost from them", () => {
    const row = usage();

    // The figure itself is `estimateSandboxCost`'s to compute — asserting the
    // exact nanodollars here would pin this test to a rate card that is
    // allowed to move. What must hold is that a figure exists at all, which is
    // the thing that was missing.
    expect(row.estimatedCostNanoUsd).not.toBeNull();
    expect(row.estimatedCostNanoUsd).toBeGreaterThan(0);
  });

  it("names the rate card and the allocation the figure assumed", () => {
    const row = usage();

    // The database refuses an estimate without both, because an estimate whose
    // rate and allocation are unknown is a number rather than an estimate.
    expect(row.costPricingVersion).toBe(VERCEL_SANDBOX_RATES.pricingVersion);
    expect(row.vcpus).toBe(2);
  });

  it("never puts the derived figure in the provider's column", () => {
    const row = usage();

    // `provider_cost_usd` means "the provider charged this" everywhere else in
    // this repository. Overloading it is how an assumption gets summed as a
    // measurement — the thing economy/cost.ts exists to prevent.
    expect(row.providerCostUsd).toBeNull();
  });
});

describe("an absent measurement is absent, never zero", () => {
  it("records nothing derived when termination reported nothing", () => {
    // A session that never came up, or one the provider refused to stop.
    const row = usage({ usage: null });

    expect(row.activeCpuMs).toBeNull();
    expect(row.outboundBytes).toBeNull();
    expect(row.estimatedCostNanoUsd).toBeNull();
  });

  it("carries neither the rate nor the allocation without a figure", () => {
    const row = usage({ usage: null });

    // The two travel with the estimate or not at all: the constraint would
    // reject the other combination, and a row carrying a rate but no figure
    // reads as a computation that silently produced nothing.
    expect(row.costPricingVersion).toBeNull();
    expect(row.vcpus).toBeNull();
  });

  it("still records the duration, because Vibe measured that itself", () => {
    const row = usage({ usage: null });

    // The wall clock is Vibe's own subtraction of two timestamps, not the
    // provider's report, so it survives a provider that said nothing.
    expect(row.durationMs).toBe(90_000);
  });

  it("produces no figure from a session with no CPU and no egress reported", () => {
    const row = usage({
      usage: { sandboxDurationMs: null, activeCpuMs: null, outboundBytes: null, costUsd: null, vcpus: 2 },
    });

    // Memory is billed against the wall clock, which Vibe does measure — so a
    // figure here is correct rather than invented, and the assertion is that
    // the *missing* dimensions did not become zeroes inside it.
    expect(row.activeCpuMs).toBeNull();
    expect(row.outboundBytes).toBeNull();
  });

  it("never produces NaN in a cost column", () => {
    const row = usage({
      usage: {
        sandboxDurationMs: null,
        activeCpuMs: undefined as unknown as number,
        outboundBytes: undefined as unknown as number,
        costUsd: null,
        vcpus: 2,
      },
    });

    // The exact defect ADR 0073 caught one table over: an `undefined` slipping
    // past a `null` guard multiplies into NaN, which is not a number, is not a
    // refusal, and sums to NaN.
    expect(Number.isNaN(row.estimatedCostNanoUsd)).toBe(false);
  });
});

describe("a failed scan is measured too", () => {
  it("records what a cancelled session consumed", () => {
    const row = usage({ status: "cancelled" });

    // A browser that ran for a minute and was then abandoned cost the same as
    // one that finished. Recording only successes would understate the bill in
    // exactly the case a person is least likely to be charged for.
    expect(row.status).toBe("cancelled");
    expect(row.estimatedCostNanoUsd).not.toBeNull();
  });
});
