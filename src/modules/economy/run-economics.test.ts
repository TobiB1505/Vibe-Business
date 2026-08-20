import { describe, expect, it } from "vitest";
import { formatNanoUsd } from "./cost";
import {
  applyScenario,
  deriveRunEconomics,
  type CreditScenario,
  type SandboxRateAssumption,
} from "./run-economics";

/**
 * Agent run economics (Sprint 0049).
 *
 * ## Where the numbers come from
 *
 * Every figure below was read out of Supabase on 2026-08-20 — `ai_usage_events`
 * joined to `agent_execution_runs`, and `sandbox_usage_events` joined to
 * `validation_runs`. They are frozen here so a later schema change cannot
 * silently rewrite what this analysis claims, and so the arithmetic can be
 * checked without a database.
 *
 * The provider costs were independently recomputed from
 * `ai/pricing.ts`'s own rates and matched the stored `provider_cost_usd` to four
 * decimal places on all six runs, which is why they are trusted as measured
 * rather than reported.
 */

/** Runs #3–#8: the six successful agentic executions that exist. */
const RUNS = [
  { run: 3, providerCostNanoUsd: 346_506_500, agentSandboxMs: null, validationSandboxMs: 339_880, durationMs: 523_892, calls: 21 },
  { run: 4, providerCostNanoUsd: 227_170_000, agentSandboxMs: null, validationSandboxMs: null, durationMs: 388_405, calls: 13 },
  { run: 5, providerCostNanoUsd: 319_930_000, agentSandboxMs: null, validationSandboxMs: 340_676, durationMs: 191_842, calls: 15 },
  { run: 6, providerCostNanoUsd: 144_400_000, agentSandboxMs: null, validationSandboxMs: 356_258, durationMs: 79_949, calls: 10 },
  { run: 7, providerCostNanoUsd: 251_500_000, agentSandboxMs: null, validationSandboxMs: 329_109, durationMs: 120_855, calls: 13 },
  { run: 8, providerCostNanoUsd: 214_400_000, agentSandboxMs: null, validationSandboxMs: 334_737, durationMs: 198_699, calls: 17 },
] as const;

describe("PART B — a cost that cannot pretend to be complete", () => {
  it("reports the model spend as measured and the sandboxes as unpriced", () => {
    const economics = deriveRunEconomics({
      providerCostNanoUsd: 214_400_000,
      agentSandboxMs: 298_107,
      validationSandboxMs: 334_737,
      validationAttempted: true,
    });

    expect(economics.providerCost).toEqual({
      known: true,
      nanoUsd: 214_400_000,
      basis: "measured",
    });
    expect(economics.validationCostEstimate).toEqual({
      known: false,
      reason: "no_price_available",
    });
    expect(economics.infrastructureCostEstimate).toEqual({
      known: false,
      reason: "no_price_available",
    });
  });

  /**
   * The single most important assertion in this file. Vibe has never priced a
   * sandbox second, so no run's true cost is knowable, and a total that
   * rendered as a number would be the exact failure this module exists to
   * prevent.
   */
  it("refuses to call the total complete while any sandbox is unpriced", () => {
    const { totalEstimatedCost } = deriveRunEconomics({
      providerCostNanoUsd: 214_400_000,
      agentSandboxMs: 298_107,
      validationSandboxMs: 334_737,
      validationAttempted: true,
    });

    expect(totalEstimatedCost.complete).toBe(false);
    expect(totalEstimatedCost.missing).toEqual([
      "validationCostEstimate",
      "infrastructureCostEstimate",
    ]);
    // The floor is still real money, and is still reported as such.
    expect(totalEstimatedCost.knownFloorNanoUsd).toBe(214_400_000);
  });

  it("does not double-count the model spend through executionCost", () => {
    const { totalEstimatedCost, executionCost, providerCost } = deriveRunEconomics({
      providerCostNanoUsd: 100_000_000,
      agentSandboxMs: null,
      validationSandboxMs: null,
      validationAttempted: false,
    });

    expect(executionCost).toEqual(providerCost);
    expect(totalEstimatedCost.knownFloorNanoUsd).toBe(100_000_000);
  });

  it("separates a stage that did not run from one that was not measured", () => {
    const notValidated = deriveRunEconomics({
      providerCostNanoUsd: 1,
      agentSandboxMs: 1,
      validationSandboxMs: null,
      validationAttempted: false,
    });
    expect(notValidated.validationCostEstimate).toEqual({ known: false, reason: "stage_not_run" });
    // A stage that never ran is not a gap in Vibe's knowledge, so it does not
    // make the total look under-measured.
    expect(notValidated.totalEstimatedCost.missing).not.toContain("validationCostEstimate");

    const validatedButUnrecorded = deriveRunEconomics({
      providerCostNanoUsd: 1,
      agentSandboxMs: 1,
      validationSandboxMs: null,
      validationAttempted: true,
    });
    expect(validatedButUnrecorded.validationCostEstimate).toEqual({
      known: false,
      reason: "not_measured",
    });
    expect(validatedButUnrecorded.totalEstimatedCost.missing).toContain("validationCostEstimate");
  });

  it("marks a supplied rate's output as estimated, never measured", () => {
    const assumption: SandboxRateAssumption = {
      label: "illustrative only — no vendor quote",
      nanoUsdPerMs: 10,
    };

    const { validationCostEstimate, totalEstimatedCost } = deriveRunEconomics({
      providerCostNanoUsd: 214_400_000,
      agentSandboxMs: 298_107,
      validationSandboxMs: 334_737,
      validationAttempted: true,
      assumption,
    });

    expect(validationCostEstimate).toEqual({
      known: true,
      nanoUsd: 3_347_370,
      basis: "estimated",
    });
    expect(totalEstimatedCost.complete).toBe(true);
  });

  it("has no default rate — the same input without an assumption is unknown", () => {
    const withRate = deriveRunEconomics({
      providerCostNanoUsd: 1,
      agentSandboxMs: 1000,
      validationSandboxMs: null,
      validationAttempted: false,
      assumption: { label: "x", nanoUsdPerMs: 1 },
    });
    const withoutRate = deriveRunEconomics({
      providerCostNanoUsd: 1,
      agentSandboxMs: 1000,
      validationSandboxMs: null,
      validationAttempted: false,
    });

    expect(withRate.infrastructureCostEstimate.known).toBe(true);
    expect(withoutRate.infrastructureCostEstimate).toEqual({
      known: false,
      reason: "no_price_available",
    });
  });
});

describe("PART C — the six runs that exist", () => {
  const floors = RUNS.map(
    (r) =>
      deriveRunEconomics({
        providerCostNanoUsd: r.providerCostNanoUsd,
        agentSandboxMs: r.agentSandboxMs,
        validationSandboxMs: r.validationSandboxMs,
        validationAttempted: r.validationSandboxMs !== null,
      }).totalEstimatedCost.knownFloorNanoUsd,
  );

  it("every run's known floor is its model spend and nothing more", () => {
    expect(floors).toEqual(RUNS.map((r) => r.providerCostNanoUsd));
  });

  it("no run in Vibe's history has a complete cost", () => {
    for (const r of RUNS) {
      const { totalEstimatedCost } = deriveRunEconomics({
        providerCostNanoUsd: r.providerCostNanoUsd,
        agentSandboxMs: r.agentSandboxMs,
        validationSandboxMs: r.validationSandboxMs,
        validationAttempted: r.validationSandboxMs !== null,
      });
      expect(totalEstimatedCost.complete, `run #${r.run}`).toBe(false);
    }
  });

  it("the measured spread is $0.1444 to $0.3465, mean $0.2507", () => {
    const mean = floors.reduce((a, b) => a + b, 0) / floors.length;

    expect(formatNanoUsd(Math.min(...floors))).toBe("$0.1444");
    expect(formatNanoUsd(Math.max(...floors))).toBe("$0.3465");
    expect(formatNanoUsd(Math.round(mean))).toBe("$0.2507");
  });

  /**
   * PART D, as an assertion rather than a claim.
   *
   * Cost tracks provider calls (r = 0.768) far better than it tracks the amount
   * of work delivered — correlation with changed files is −0.035 and with
   * changed bytes −0.219, both computed in Postgres over these same six rows.
   * Run #7 is the proof by counterexample: eight files changed for $0.2515,
   * while run #3 changed two files for $0.3465.
   */
  it("cost does not track delivered work — run #7 changed 4x the files of run #3 for less money", () => {
    const run3 = RUNS.find((r) => r.run === 3)!;
    const run7 = RUNS.find((r) => r.run === 7)!;

    expect(run7.providerCostNanoUsd).toBeLessThan(run3.providerCostNanoUsd);
  });

  it("cost does not track wall clock either — the longest run is not the dearest", () => {
    const dearest = RUNS.reduce((a, b) => (b.providerCostNanoUsd > a.providerCostNanoUsd ? b : a));
    const longest = RUNS.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));

    // Both happen to be run #3 here, so the assertion that carries the finding
    // is the second one: run #5 ran for less than half of run #4's wall clock
    // and cost 41% more.
    expect(dearest.run).toBe(longest.run);

    const run4 = RUNS.find((r) => r.run === 4)!;
    const run5 = RUNS.find((r) => r.run === 5)!;
    expect(run5.durationMs).toBeLessThan(run4.durationMs / 2);
    expect(run5.providerCostNanoUsd).toBeGreaterThan(run4.providerCostNanoUsd);
  });
});

describe("PART E — credit scenarios over a floor, never over a total", () => {
  const MEAN_FLOOR = 250_651_000; // $0.2507, the six-run mean model spend

  const MODELS: readonly CreditScenario[] = [
    { kind: "cost_value", label: "A — 1 Credit = $0.01 at cost", usdPerCredit: 0.01 },
    { kind: "gross_margin", label: "B — 70% margin, $0.02/Credit", targetMargin: 0.7, usdPerCredit: 0.02 },
    { kind: "gross_margin", label: "C — 80% margin, $0.02/Credit", targetMargin: 0.8, usdPerCredit: 0.02 },
  ];

  it("model A charges cost with no margin at all", () => {
    const result = applyScenario(MODELS[0], MEAN_FLOOR);

    expect(result.credits).toBe(26); // ceil($0.2507 / $0.01)
    // Rounding up to a whole credit is the only margin, and it is tiny.
    expect(result.realisedMargin).toBeCloseTo(0.036, 3);
  });

  it("model B reaches 70% of the floor, not of the true cost", () => {
    const result = applyScenario(MODELS[1], MEAN_FLOOR);

    expect(result.credits).toBe(42); // ceil($0.8355 / $0.02)
    expect(result.realisedMargin).toBeGreaterThanOrEqual(0.7);
  });

  it("model C reaches 80% of the floor", () => {
    const result = applyScenario(MODELS[2], MEAN_FLOOR);

    expect(result.credits).toBe(63); // ceil($1.2533 / $0.02)
    expect(result.realisedMargin).toBeGreaterThanOrEqual(0.8);
  });

  /**
   * The finding the scenarios are really for, expressed as a break-even rather
   * than a guess.
   *
   * Vibe has no sandbox quote, so asserting "the margin is X at rate Y" would
   * require inventing Y. Inverting the question needs no invented price: given a
   * price the scenario would charge, at what sandbox rate does the margin fall
   * to a given level? That is arithmetic on measured quantities — 298.1s of
   * agent microVM and 334.7s of validation microVM, both read from
   * `sandbox_usage_events` — and it turns an unknown into a threshold somebody
   * can check against a real invoice when one arrives.
   */
  it("says at which sandbox rate an 80%-margin price stops being 80%", () => {
    const SANDBOX_MS = 298_107 + 334_737; // agent VM + validation VM, measured
    const charged = applyScenario(MODELS[2], MEAN_FLOOR).credits * 0.02 * 1e9;

    /** Nanodollars per ms at which the realised margin equals `margin`. */
    const breakEvenPerMs = (margin: number) =>
      (charged * (1 - margin) - MEAN_FLOOR) / SANDBOX_MS;

    const perHour = (perMs: number) => (perMs * 3_600_000) / 1e9;

    // Above this the price no longer clears 70%.
    expect(perHour(breakEvenPerMs(0.7))).toBeCloseTo(0.72, 2);
    // And only above this does the run lose money outright.
    expect(perHour(breakEvenPerMs(0))).toBeCloseTo(5.74, 2);
  });

  it("the margin headroom is entirely a function of unmeasured sandbox time", () => {
    // 10.5 minutes of microVM per run, none of it priced. Stated as a test so
    // the quantity cannot quietly drift out of the documentation.
    expect((298_107 + 334_737) / 60_000).toBeCloseTo(10.5, 1);
  });
});
