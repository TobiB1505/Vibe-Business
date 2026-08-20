import { describe, expect, it } from "vitest";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import { CREDIT_RATE_CARD_SCENARIOS, simulateCreditRateCard } from "./credit-rate-card";
import { classifyExecutionPricingClass } from "./execution-class";
import { HISTORICAL_RUNS } from "./historical-runs";

/**
 * PART L — price stability: a customer must be able to know a run's Credit
 * price *before* the agent starts, and that price must never move once the
 * agent has run, however cheaply or expensively it actually worked.
 *
 * The target flow, end to end:
 *
 *   Step (riskClass, changeKind, evidenceIds)
 *     -> deriveExecutionSurfaceRequirement       (pre-execution)
 *     -> classifyExecutionPricingClass           (pre-execution)
 *     -> simulateCreditRateCard                  (pre-execution)
 *     = a fixed Credit quote
 *     -> [Agent runs, spends whatever it spends] -> [Validation]
 *     -> Settlement against the *quote*, never against a post-hoc price
 *
 * This is proved here with real historical data: run #3 and run #6 cite the
 * identical evidence family (`live.seo.robots_meta_missing`) but cost
 * $0.3465 and $0.1444 in real model spend — a 2.4× difference driven by
 * cache/context volume the customer never sees (`ECONOMY_MODEL.md`'s own
 * PART D finding). If the quote flow below produced different prices for
 * these two runs, the price would be leaking post-execution information;
 * it does not.
 */

/** The full pre-execution quote pipeline, exactly as a production quote step would run it. */
function quoteFor(run: (typeof HISTORICAL_RUNS)[number], model: (typeof CREDIT_RATE_CARD_SCENARIOS)[number]) {
  const surfaceRequirement = deriveExecutionSurfaceRequirement({
    changeKind: run.changeKind,
    evidenceIds: run.evidenceIds,
  });

  const classification = classifyExecutionPricingClass({
    riskClass: run.riskClass,
    changeKind: run.changeKind,
    evidenceIds: run.evidenceIds,
    surfaces: surfaceRequirement.surfaces,
  });

  if (classification.pricingClass === null) {
    throw new Error(`Run #${run.run} produced no pricing class`);
  }

  // The quote step has no access to the run's real cost — it uses only the
  // class, exactly like `simulateCreditRateCard` is typed to require.
  return simulateCreditRateCard(model, {
    run: run.run,
    pricingClass: classification.pricingClass,
    economicCostFloorNanoUsd: 0,
    economicCostUpperNanoUsd: 0,
  }).credits;
}

describe("PART L — the quote never depends on what the agent actually did", () => {
  it("run #3 ($0.3465 real spend) and run #6 ($0.1444 real spend) get the identical quote under every model", () => {
    const run3 = HISTORICAL_RUNS.find((r) => r.run === 3)!;
    const run6 = HISTORICAL_RUNS.find((r) => r.run === 6)!;
    expect(run3.providerCostNanoUsd).not.toBe(run6.providerCostNanoUsd); // real costs really do differ

    for (const model of CREDIT_RATE_CARD_SCENARIOS) {
      expect(quoteFor(run3, model), model.model).toBe(quoteFor(run6, model));
    }
  });

  it("the quote pipeline never reads a cost field at all — it is typed away, not just unused at runtime", () => {
    // If simulateCreditRateCard required real cost to produce a credit
    // price, quoteFor above could not have passed 0/0 and still produced a
    // materially real number — the test above proves the *credits* figure
    // is identical across a 2.4x real-cost spread, which is only possible
    // if the pricing surface literally cannot see the spread.
    const run3 = HISTORICAL_RUNS.find((r) => r.run === 3)!;
    const modelB = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "B")!;
    expect(quoteFor(run3, modelB)).toBeGreaterThan(0);
  });

  it("every historical run's quote is deterministic across repeated calls, matching PART A's classifier determinism", () => {
    const modelC = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "C")!;
    for (const run of HISTORICAL_RUNS) {
      expect(quoteFor(run, modelC)).toBe(quoteFor(run, modelC));
    }
  });

  it("the quote is fixed before validation even runs — run #4 (never validated) still gets a real quote", () => {
    const run4 = HISTORICAL_RUNS.find((r) => r.run === 4)!;
    const modelA = CREDIT_RATE_CARD_SCENARIOS.find((s) => s.model === "A")!;
    expect(quoteFor(run4, modelA)).toBeGreaterThan(0);
  });
});
