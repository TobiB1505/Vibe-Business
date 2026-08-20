import { describe, expect, it } from "vitest";
import { formatNanoUsd } from "./cost";
import { deriveHarnessMetrics } from "./harness-metrics";
import {
  INFRASTRUCTURE_RATE_CARDS,
  VERCEL_SANDBOX_RATES,
  rateCardByVersion,
} from "./infrastructure-rates";
import { comparableRuns, readMetric } from "./metric-availability";
import { deriveSandboxCost, provenanceFor, type SandboxUsage } from "./sandbox-cost";

/**
 * Sandbox cost, metric integrity and provenance (Sprint 0050).
 */

function usage(overrides: Partial<SandboxUsage> = {}): SandboxUsage {
  return {
    purpose: "change_validation",
    wallMs: 300_000,
    activeCpuMs: null,
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: null,
    snapshot: null,
    ...overrides,
  };
}

describe("the rate card is versioned and honest about itself", () => {
  it("is looked up by version, so a price change cannot restate history", () => {
    expect(rateCardByVersion("vercel-sandbox-2026-08-20")).toBe(VERCEL_SANDBOX_RATES);
    expect(rateCardByVersion("some-future-card")).toBeNull();
  });

  it("declares itself operator-supplied and unverified", () => {
    // The figures could not be checked from this environment: vercel.com is
    // egress-blocked and the docs-search tool returns the pricing page's worked
    // examples but not its price table. Labelling them `official_public_pricing`
    // would assert a verification that did not happen.
    expect(VERCEL_SANDBOX_RATES.sourceKind).toBe("operator_supplied");
    expect(VERCEL_SANDBOX_RATES.verified).toBe(false);
    expect(VERCEL_SANDBOX_RATES.verificationNote).toContain("egress");
  });

  it("holds every rate as an integer number of nanodollars", () => {
    for (const card of INFRASTRUCTURE_RATE_CARDS) {
      for (const value of [
        card.activeCpuNanoUsdPerCpuHour,
        card.memoryNanoUsdPerGbHour,
        card.creationNanoUsd,
        card.outboundNetworkNanoUsdPerGb,
        card.snapshotStorageNanoUsdPerGbMonth,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });
});

describe("the sanity check against Vercel's own worked example", () => {
  /**
   * Vercel documents roughly $0.03 for a five-minute validation on 2 vCPU. The
   * rate card must reproduce that, or the rates were transcribed wrong.
   */
  it("2 vCPU / 4 GB / 5 min / fully active ≈ $0.0284", () => {
    const { fullActiveCpuUpperBoundNanoUsd } = deriveSandboxCost(
      usage({ vcpus: 2, wallMs: 300_000, creations: 1 }),
      VERCEL_SANDBOX_RATES,
    );

    expect(formatNanoUsd(fullActiveCpuUpperBoundNanoUsd!)).toBe("$0.0284");
  });

  it("2 vCPU / 4 GB / 10.5 min / fully active ≈ $0.0596", () => {
    const { fullActiveCpuUpperBoundNanoUsd } = deriveSandboxCost(
      usage({ vcpus: 2, wallMs: 630_000, creations: 1 }),
      VERCEL_SANDBOX_RATES,
    );

    expect(formatNanoUsd(fullActiveCpuUpperBoundNanoUsd!)).toBe("$0.0596");
  });

  /**
   * Vibe does not run the 2 vCPU default. `SANDBOX_RESOURCES.vcpus` is 4 for
   * validation, and agent provisioning passes no override, so both microVMs are
   * 4 vCPU / 8 GB — twice Vercel's example shape and twice its cost.
   */
  it("Vibe's actual 4 vCPU shape costs twice the documented example", () => {
    const two = deriveSandboxCost(usage({ vcpus: 2 }), VERCEL_SANDBOX_RATES);
    const four = deriveSandboxCost(usage({ vcpus: 4 }), VERCEL_SANDBOX_RATES);

    const ratio =
      (four.fullActiveCpuUpperBoundNanoUsd! - VERCEL_SANDBOX_RATES.creationNanoUsd) /
      (two.fullActiveCpuUpperBoundNanoUsd! - VERCEL_SANDBOX_RATES.creationNanoUsd);

    expect(ratio).toBeCloseTo(2, 6);
  });
});

describe("wall duration is never treated as measured active CPU", () => {
  /** The single most important assertion in this file. */
  it("leaves the CPU component unknown when active CPU was not recorded", () => {
    const cost = deriveSandboxCost(usage({ activeCpuMs: null }), VERCEL_SANDBOX_RATES);

    expect(cost.activeCpu).toEqual({ known: false, reason: "not_measured" });
    expect(cost.total.complete).toBe(false);
    expect(cost.total.missing).toContain("activeCpu");
  });

  it("still derives memory and creation, which do not depend on CPU", () => {
    const cost = deriveSandboxCost(usage({ activeCpuMs: null }), VERCEL_SANDBOX_RATES);

    expect(cost.memory.known).toBe(true);
    expect(cost.creation.known).toBe(true);
    // 8 GB × (300s / 3600s) = 0.6667 GB-hours × $0.0212 = $0.0141333
    expect(formatNanoUsd(cost.memory.known ? cost.memory.nanoUsd : 0, 7)).toBe("$0.0141333");
  });

  it("prices a measured zero as zero, and a missing value as unknown", () => {
    const measuredZero = deriveSandboxCost(usage({ activeCpuMs: 0 }), VERCEL_SANDBOX_RATES);
    expect(measuredZero.activeCpu).toEqual({ known: true, nanoUsd: 0, basis: "estimated" });

    const notRecorded = deriveSandboxCost(usage({ activeCpuMs: null }), VERCEL_SANDBOX_RATES);
    expect(notRecorded.activeCpu.known).toBe(false);
  });

  it("names the upper bound as an assumption, separately from the total", () => {
    const cost = deriveSandboxCost(usage({ activeCpuMs: null }), VERCEL_SANDBOX_RATES);

    // The bound exists…
    expect(cost.fullActiveCpuUpperBoundNanoUsd).toBeGreaterThan(0);
    // …and the total still refuses to be complete without the real value.
    expect(cost.total.complete).toBe(false);
  });
});

describe("provenance travels with every derivation", () => {
  it("records the card, the date, the usage source and the assumptions", () => {
    const provenance = provenanceFor(
      usage({ activeCpuMs: null }),
      VERCEL_SANDBOX_RATES,
      "sandbox_usage_events",
    );

    expect(provenance.pricingVersion).toBe("vercel-sandbox-2026-08-20");
    expect(provenance.pricingObservedAt).toBe("2026-08-20");
    expect(provenance.pricingVerified).toBe(false);
    expect(provenance.vcpusBasis).toBe("derived_from_configuration");
    expect(provenance.assumptions.join(" ")).toContain("not recorded");
    expect(provenance.assumptions.join(" ")).toContain("2 GB per vCPU");
  });

  it("stops claiming a reconstruction when the provider reported the shape", () => {
    const provenance = provenanceFor(
      usage({ vcpusBasis: "measured", activeCpuMs: 1000 }),
      VERCEL_SANDBOX_RATES,
      "sandbox_usage_events",
    );

    expect(provenance.assumptions.join(" ")).not.toContain("reconstructed");
  });
});

describe("harness metrics — one number, one meaning", () => {
  const events = [
    { type: "file_read", path: "a.ts" },
    { type: "file_read", path: "a.ts" },
    { type: "file_read", path: "b.ts" },
    { type: "file_edited", path: "a.ts" },
    { type: "file_searched", path: null },
    { type: "command_started", path: null },
    { type: "turn_completed", path: null },
  ];

  it("never lets one file read twice mean both 1 and 2", () => {
    const metrics = deriveHarnessMetrics(events)!;

    expect(metrics.readOperations).toBe(3);
    expect(metrics.uniqueFilesRead).toBe(2);
    expect(metrics.repeatedReads).toBe(1);
  });

  it("counts tool calls without counting lifecycle events", () => {
    const metrics = deriveHarnessMetrics(events)!;

    // 3 reads + 1 edit + 1 search + 1 command. `turn_completed` is not a tool.
    expect(metrics.toolCalls).toBe(6);
  });

  it("returns null for a run with no event stream, rather than a zeroed row", () => {
    expect(deriveHarnessMetrics([])).toBeNull();
  });

  /** Run #7's real shape: 18 read operations across 10 distinct files. */
  it("reproduces run #7's read pattern", () => {
    const runSeven = Array.from({ length: 18 }, (_, index) => ({
      type: "file_read",
      path: `file-${index % 10}.tsx`,
    }));
    const metrics = deriveHarnessMetrics(runSeven)!;

    expect(metrics.readOperations).toBe(18);
    expect(metrics.uniqueFilesRead).toBe(10);
    expect(metrics.repeatedReads).toBe(8);
  });
});

describe("metric availability — 0 is not the same as not measured", () => {
  const RUN_3 = "2026-08-19T11:08:00Z";
  const RUN_8 = "2026-08-19T22:19:00Z";

  it("reports a metric that did not exist yet as unavailable, never 0", () => {
    const reading = readMetric("implementationMutations", RUN_3, null);

    expect(reading.status).toBe("unavailable");
  });

  it("reports a genuine gap as missing, which is a different problem", () => {
    const reading = readMetric("implementationMutations", RUN_8, null);

    expect(reading.status).toBe("missing");
  });

  it("passes a real zero through as observed", () => {
    const reading = readMetric("verificationCommands", RUN_8, 0);

    expect(reading).toEqual({ status: "observed", value: 0 });
  });

  it("filters a comparison set to the runs a metric can legitimately span", () => {
    const runs = [{ createdAt: RUN_3 }, { createdAt: RUN_8 }];

    expect(comparableRuns("implementationMutations", runs)).toEqual([{ createdAt: RUN_8 }]);
    expect(comparableRuns("providerCost", runs)).toHaveLength(2);
  });

  /**
   * The correction this sprint owes the previous one. These columns are not
   * broken: they count gateway-brokered calls, and the harness does not use the
   * gateway under the sandbox topology.
   */
  it("documents the gateway counters as correct rather than absent", () => {
    expect(readMetric("gatewayToolCallsAllowed", RUN_8, 0)).toEqual({
      status: "observed",
      value: 0,
    });
  });
});
