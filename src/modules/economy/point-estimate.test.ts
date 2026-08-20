import { describe, expect, it } from "vitest";
import { formatNanoUsd } from "./cost";
import { VERCEL_SANDBOX_RATES } from "./infrastructure-rates";
import { deriveSandboxCost, type SandboxUsage } from "./sandbox-cost";

/**
 * PART F/L — a fixed validation capture now produces a point estimate
 * (Sprint 0051).
 *
 * Sprint 0050 could only give a validation run a floor and an upper bound,
 * because `active_cpu_ms` was never persisted for a passing run. The bug that
 * caused that is fixed at its source in `vercel/provider.ts` — see
 * `provider.test.ts`, "ignores a stale local usage value…" — and this file
 * proves the consequence one layer up: the same `deriveSandboxCost` function,
 * given the usage a fixed capture will now produce, stops needing an upper
 * bound at all.
 *
 * Nothing new was built to make this true. `deriveSandboxCost` already treated
 * `activeCpuMs: null` as the one gap that forced incompleteness; giving it a
 * real value collapses the gap the same way it always would have.
 */

function futureValidationUsage(overrides: Partial<SandboxUsage> = {}): SandboxUsage {
  return {
    purpose: "change_validation",
    wallMs: 300_000,
    activeCpuMs: 171_000, // now captured, via the fixed snapshot() path
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: 1_800_000, // now captured too, from the same fresh read
    snapshot: null, // validation takes none — genuinely nothing to price
    ...overrides,
  };
}

describe("a validation run with the fix in place gets a point estimate", () => {
  it("is complete: no missing component, no upper bound needed", () => {
    const cost = deriveSandboxCost(futureValidationUsage(), VERCEL_SANDBOX_RATES);

    expect(cost.total.complete).toBe(true);
    expect(cost.total.missing).toEqual([]);
    expect(cost.activeCpu.known).toBe(true);
    expect(cost.memory.known).toBe(true);
    expect(cost.creation.known).toBe(true);
    expect(cost.outboundNetwork.known).toBe(true);
  });

  it("the point estimate is a specific number, not a range", () => {
    const cost = deriveSandboxCost(futureValidationUsage(), VERCEL_SANDBOX_RATES);

    // 4 vCPU × 171s active × $0.128/CPU-hr  = $0.02432
    // + 8 GB × (300s/3600s) GB-hours × $0.0212/GB-hr = $0.01413
    // + 1.8 MB egress × $0.15/GB           = $0.00025
    // + 1 creation × $0.0000006            ≈ negligible
    expect(formatNanoUsd(cost.total.knownFloorNanoUsd, 5)).toBe("$0.03871");
  });

  it("still leaves the CPU component unknown for a run the fix predates", () => {
    // The historical shape: no active CPU, no egress, because the capture
    // bug was live when the row was written. This must keep working exactly
    // as it did before the fix — the fix only changes what future rows record.
    const historical = futureValidationUsage({ activeCpuMs: null, outboundBytes: null });
    const cost = deriveSandboxCost(historical, VERCEL_SANDBOX_RATES);

    expect(cost.total.complete).toBe(false);
    expect(cost.activeCpu.known).toBe(false);
    expect(cost.fullActiveCpuUpperBoundNanoUsd).not.toBeNull();
  });
});

describe("agent and validation sandboxes share one cost semantics", () => {
  /**
   * PART L, item 4. There is exactly one `deriveSandboxCost` and it does not
   * branch on `purpose` — an agent-execution VM and a validation VM are priced
   * by the same function from the same usage shape, which is what makes it
   * meaningful to sum their costs into one run total.
   */
  it("prices an agent-purpose and a validation-purpose sandbox identically for identical usage", () => {
    const agent = deriveSandboxCost(
      { ...futureValidationUsage(), purpose: "agent_execution" },
      VERCEL_SANDBOX_RATES,
    );
    const validation = deriveSandboxCost(
      { ...futureValidationUsage(), purpose: "change_validation" },
      VERCEL_SANDBOX_RATES,
    );

    expect(agent.total.knownFloorNanoUsd).toBe(validation.total.knownFloorNanoUsd);
  });
});
