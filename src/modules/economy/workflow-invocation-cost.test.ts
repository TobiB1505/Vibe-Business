import { describe, expect, it } from "vitest";
import { formatNanoUsd } from "./cost";
import { VERCEL_FUNCTIONS_RATES } from "./infrastructure-rates";
import {
  AGENT_POLL_INTERVAL_MS,
  AGENT_WORKFLOW_FIXED_STEPS,
  GENEROUS_STEP_WORK,
  REALISTIC_STEP_WORK,
  VALIDATION_WORKFLOW_STEPS,
  deriveWorkflowInvocationCost,
  workflowEventCount,
} from "./workflow-invocation-cost";

/**
 * PART H, re-opened with real prices (Sprint 0051, founder's second
 * attestation).
 *
 * The step counts below are the same ones Sprint 0051 computed from the real
 * step graph and each historical run's own measured agent wall-clock
 * duration — unchanged, because nothing about Vibe's architecture changed.
 * What changed is that `eventCost` used to be reasoned from an unquoted
 * order-of-magnitude rate and is now `stepCount × $20/1,000,000`, exactly.
 */

const AGENT_WALL_MS: Readonly<Record<number, number>> = {
  3: 523_892,
  4: 388_405,
  5: 191_842,
  6: 79_949,
  7: 120_855,
  8: 198_699,
};

const DELIVERED_RUN_FLOOR_NANO_USD = 475_200_000; // $0.4752, Sprint 0050/0051

describe("the step count is read from the code, not assumed", () => {
  it("matches Sprint 0051's own figures for all six runs", () => {
    const expected: Record<number, number> = { 3: 46, 4: 39, 5: 29, 6: 23, 7: 26, 8: 29 };

    for (const [run, wallMs] of Object.entries(AGENT_WALL_MS)) {
      expect(workflowEventCount(wallMs), `run #${run}`).toBe(expected[Number(run)]);
    }
  });

  it("is the validation steps plus the fixed and polling agent steps", () => {
    const wallMs = AGENT_POLL_INTERVAL_MS * 3; // exactly 3 polls
    expect(workflowEventCount(wallMs)).toBe(AGENT_WORKFLOW_FIXED_STEPS + 3 + VALIDATION_WORKFLOW_STEPS);
  });
});

describe("event cost is now exact, not reasoned", () => {
  it("prices run #3's 46 steps at exactly 46 × $20/1,000,000", () => {
    const cost = deriveWorkflowInvocationCost(46, VERCEL_FUNCTIONS_RATES);

    expect(cost.eventCost).toEqual({ known: true, nanoUsd: 920_000, basis: "estimated" });
    expect(formatNanoUsd(920_000, 6)).toBe("$0.000920");
  });

  it("leaves CPU and memory unknown with no work assumption supplied", () => {
    const cost = deriveWorkflowInvocationCost(46, VERCEL_FUNCTIONS_RATES);

    expect(cost.cpuCost).toEqual({ known: false, reason: "not_measured" });
    expect(cost.memoryCost).toEqual({ known: false, reason: "not_measured" });
    expect(cost.total.complete).toBe(false);
    // The event cost is still a real number even though the total is not complete.
    expect(cost.total.knownFloorNanoUsd).toBe(920_000);
  });

  it("estimates CPU and memory only once a labelled assumption is given", () => {
    const cost = deriveWorkflowInvocationCost(46, VERCEL_FUNCTIONS_RATES, REALISTIC_STEP_WORK);

    expect(cost.cpuCost.known).toBe(true);
    expect(cost.memoryCost.known).toBe(true);
    expect(cost.total.complete).toBe(true);
  });
});

describe("materiality holds under real prices, on both named bounds", () => {
  function shareOfDeliveredRun(agentWallMs: number, assumption: typeof REALISTIC_STEP_WORK) {
    const steps = workflowEventCount(agentWallMs);
    const cost = deriveWorkflowInvocationCost(steps, VERCEL_FUNCTIONS_RATES, assumption);
    return cost.total.knownFloorNanoUsd / DELIVERED_RUN_FLOOR_NANO_USD;
  }

  it("the realistic bound stays under 0.4% on every historical run", () => {
    for (const [run, wallMs] of Object.entries(AGENT_WALL_MS)) {
      const share = shareOfDeliveredRun(wallMs, REALISTIC_STEP_WORK);
      expect(share, `run #${run}`).toBeLessThan(0.004);
    }
  });

  /**
   * The dearest case: run #3, the most polls, at the deliberately pessimistic
   * duration and memory. Still under 1% — the materiality conclusion from
   * Sprint 0051 survives contact with the real price, including in the
   * direction that would have broken it.
   */
  it("even the generous bound on the dearest run stays under 1%", () => {
    const share = shareOfDeliveredRun(AGENT_WALL_MS[3], GENEROUS_STEP_WORK);

    expect(share).toBeLessThan(0.01);
    expect(share).toBeGreaterThan(0.009); // close to the edge, not comfortably clear of it
  });

  it("the event line alone — the only fully-attested component — is negligible on its own", () => {
    // Even at the highest step count observed, the event charge alone is a
    // tenth of a percent. The CPU/memory assumption is what moves the needle,
    // and that assumption is still not attested by anyone.
    const steps = workflowEventCount(AGENT_WALL_MS[3]);
    const eventOnly = deriveWorkflowInvocationCost(steps, VERCEL_FUNCTIONS_RATES).total.knownFloorNanoUsd;

    expect(eventOnly / DELIVERED_RUN_FLOOR_NANO_USD).toBeLessThan(0.002);
  });
});

describe("the rate card behind this is founder-attested, same as the sandbox card", () => {
  it("carries the same provenance discipline", () => {
    expect(VERCEL_FUNCTIONS_RATES.sourceKind).toBe("founder_attested");
    expect(VERCEL_FUNCTIONS_RATES.verified).toBe(true);
    expect(VERCEL_FUNCTIONS_RATES.attestedBy).toBe("founder");
  });

  it("holds every rate as an integer number of nanodollars", () => {
    for (const value of [
      VERCEL_FUNCTIONS_RATES.activeCpuNanoUsdPerCpuHour,
      VERCEL_FUNCTIONS_RATES.memoryNanoUsdPerGbHour,
      VERCEL_FUNCTIONS_RATES.invocationNanoUsd,
      VERCEL_FUNCTIONS_RATES.workflowEventNanoUsd,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  /** The rate that actually moves the number: a Workflow event costs 33⅓× a plain invocation. */
  it("prices a Workflow event far above a plain Function invocation", () => {
    expect(VERCEL_FUNCTIONS_RATES.workflowEventNanoUsd / VERCEL_FUNCTIONS_RATES.invocationNanoUsd).toBeCloseTo(
      33.33,
      1,
    );
  });
});
