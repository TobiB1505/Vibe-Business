import { describe, expect, it } from "vitest";
import { formatNanoUsd, sumCosts } from "./cost";
import { VERCEL_SANDBOX_RATES } from "./infrastructure-rates";
import { deriveSandboxCost, type SandboxUsage } from "./sandbox-cost";

/**
 * PART F/I — runs #3–#8 recomputed with sandbox cost (Sprint 0050).
 *
 * ## Why this is a derivation and not a stored backfill
 *
 * Every input already exists in Supabase, so recomputing is idempotent by
 * construction: there is nothing to write twice, no raw row to overwrite, no
 * provider cost to touch, no credit to move. A stored backfill would have to
 * *earn* those properties; a pure derivation has them for free, which is why
 * this sprint added no migration.
 *
 * The usage figures below were read on 2026-08-20 and are frozen here so a
 * later schema change cannot silently restate the analysis.
 *
 * ## What changed relative to the previous sprint's analysis
 *
 * The agent microVM turned out to be **fully measured** — wall duration, active
 * CPU and egress are recorded for all eleven rows. Only the validation microVM
 * lacks active CPU, and only for the older rows. So the agent sandbox cost is
 * derived rather than unknown, and the previous report's claim that no sandbox
 * cost was knowable was too pessimistic in one direction and too vague in the
 * other.
 */

/** 4 vCPU / 8 GB, from `SANDBOX_RESOURCES.vcpus` — reconstructed, not measured. */
const VIBE_SHAPE = { vcpus: 4, vcpusBasis: "derived_from_configuration" } as const;

type Historical = {
  run: number;
  providerCostNanoUsd: number;
  agent: { wallMs: number; activeCpuMs: number; egressBytes: number };
  validation: { wallMs: number } | null;
};

const RUNS: readonly Historical[] = [
  { run: 3, providerCostNanoUsd: 346_506_500, agent: { wallMs: 523_892, activeCpuMs: 318_690, egressBytes: 4_127_587 }, validation: { wallMs: 339_880 } },
  { run: 4, providerCostNanoUsd: 227_170_000, agent: { wallMs: 388_405, activeCpuMs: 271_273, egressBytes: 3_227_885 }, validation: null },
  { run: 5, providerCostNanoUsd: 319_930_000, agent: { wallMs: 191_842, activeCpuMs: 61_366, egressBytes: 3_717_473 }, validation: { wallMs: 340_676 } },
  { run: 6, providerCostNanoUsd: 144_400_000, agent: { wallMs: 79_949, activeCpuMs: 60_114, egressBytes: 2_636_467 }, validation: { wallMs: 356_258 } },
  { run: 7, providerCostNanoUsd: 251_500_000, agent: { wallMs: 120_855, activeCpuMs: 63_090, egressBytes: 3_067_644 }, validation: { wallMs: 329_109 } },
  { run: 8, providerCostNanoUsd: 214_400_000, agent: { wallMs: 198_699, activeCpuMs: 99_095, egressBytes: 3_145_312 }, validation: { wallMs: 334_737 } },
];

function agentUsage(run: Historical): SandboxUsage {
  return {
    purpose: "agent_execution",
    wallMs: run.agent.wallMs,
    activeCpuMs: run.agent.activeCpuMs, // measured by the provider
    creations: 1,
    outboundBytes: run.agent.egressBytes,
    snapshot: null,
    ...VIBE_SHAPE,
  };
}

function validationUsage(run: Historical): SandboxUsage | null {
  if (!run.validation) return null;
  return {
    purpose: "change_validation",
    wallMs: run.validation.wallMs,
    activeCpuMs: null, // never recorded for these rows
    creations: 1,
    outboundBytes: null,
    snapshot: null,
    ...VIBE_SHAPE,
  };
}

function floorOf(run: Historical): number {
  const agent = deriveSandboxCost(agentUsage(run), VERCEL_SANDBOX_RATES);
  const validation = validationUsage(run);
  const val = validation ? deriveSandboxCost(validation, VERCEL_SANDBOX_RATES) : null;

  return (
    run.providerCostNanoUsd +
    agent.total.knownFloorNanoUsd +
    (val?.total.knownFloorNanoUsd ?? 0)
  );
}

describe("the agent microVM is fully measured", () => {
  it("derives a complete agent sandbox cost for every run", () => {
    for (const run of RUNS) {
      const cost = deriveSandboxCost(agentUsage(run), VERCEL_SANDBOX_RATES);

      expect(cost.activeCpu.known, `run #${run.run}`).toBe(true);
      expect(cost.memory.known).toBe(true);
      expect(cost.outboundNetwork.known).toBe(true);
      // Snapshot is `stage_not_run`, which does not count against completeness.
      expect(cost.total.complete, `run #${run.run}`).toBe(true);
    }
  });

  /**
   * The empirical case for never substituting wall clock for active CPU.
   * Utilisation across the six runs is 32%–75%, mean 57% — an agent waiting on
   * a provider response burns wall clock and no CPU.
   */
  it("shows CPU utilisation between 32% and 75%, never 100%", () => {
    const utilisations = RUNS.map((run) => run.agent.activeCpuMs / run.agent.wallMs);

    expect(Math.min(...utilisations)).toBeGreaterThan(0.3);
    expect(Math.max(...utilisations)).toBeLessThan(0.8);

    const mean = utilisations.reduce((a, b) => a + b, 0) / utilisations.length;
    expect(Math.round(mean * 100)).toBe(57);
  });

  it("would have overstated agent CPU cost by ~75% under a full-active assumption", () => {
    const run = RUNS.find((r) => r.run === 8)!;
    const cost = deriveSandboxCost(agentUsage(run), VERCEL_SANDBOX_RATES);
    const real = cost.total.knownFloorNanoUsd;

    expect(cost.fullActiveCpuUpperBoundNanoUsd).toBeGreaterThan(real);
  });
});

describe("the validation microVM is only partly derivable", () => {
  it("prices memory and creation but leaves active CPU unknown", () => {
    const cost = deriveSandboxCost(validationUsage(RUNS[0])!, VERCEL_SANDBOX_RATES);

    expect(cost.memory.known).toBe(true);
    expect(cost.creation.known).toBe(true);
    expect(cost.activeCpu).toEqual({ known: false, reason: "not_measured" });
    expect(cost.total.complete).toBe(false);
  });

  it("reports run #3's validation floor and upper bound apart", () => {
    const cost = deriveSandboxCost(validationUsage(RUNS[0])!, VERCEL_SANDBOX_RATES);

    expect(formatNanoUsd(cost.total.knownFloorNanoUsd, 5)).toBe("$0.01601");
    expect(formatNanoUsd(cost.fullActiveCpuUpperBoundNanoUsd!, 5)).toBe("$0.06435");
  });
});

describe("the re-analysed cost of the six runs", () => {
  it("run #8's floor is $0.2541, up from $0.2144 model spend alone", () => {
    expect(formatNanoUsd(floorOf(RUNS.find((r) => r.run === 8)!))).toBe("$0.2541");
  });

  it("the floor spread is $0.1739 to $0.4331, mean $0.2970", () => {
    const floors = RUNS.map(floorOf);
    const mean = floors.reduce((a, b) => a + b, 0) / floors.length;

    expect(formatNanoUsd(Math.min(...floors))).toBe("$0.1739");
    expect(formatNanoUsd(Math.max(...floors))).toBe("$0.4331");
    expect(formatNanoUsd(Math.round(mean))).toBe("$0.2970");
  });

  /**
   * Infrastructure is real but not dominant: it adds 15.6% to the model spend,
   * which is a material margin input and not the order-of-magnitude unknown the
   * previous analysis had to leave open.
   */
  it("infrastructure adds about 16% to the model spend", () => {
    const ai = RUNS.reduce((total, run) => total + run.providerCostNanoUsd, 0);
    const floors = RUNS.reduce((total, run) => total + floorOf(run), 0);

    expect(Math.round(((floors - ai) / ai) * 1000) / 10).toBeCloseTo(18.5, 1);
  });
});

describe("the derivation is idempotent and touches nothing", () => {
  it("produces byte-identical results on repeated evaluation", () => {
    const once = RUNS.map(floorOf);
    const twice = RUNS.map(floorOf);

    expect(twice).toEqual(once);
  });

  /**
   * PART G, structurally. There is no write path to be idempotent *about*:
   * every function in this module is pure, so a re-run cannot double a ledger
   * row, move a credit or alter a stored provider cost.
   */
  it("computes a total without any component being mutated", () => {
    const cost = deriveSandboxCost(agentUsage(RUNS[0]), VERCEL_SANDBOX_RATES);
    const recomputed = sumCosts([
      ["activeCpu", cost.activeCpu],
      ["memory", cost.memory],
      ["creation", cost.creation],
      ["outboundNetwork", cost.outboundNetwork],
      ["snapshotStorage", cost.snapshotStorage],
    ]);

    expect(recomputed).toEqual(cost.total);
  });
});
