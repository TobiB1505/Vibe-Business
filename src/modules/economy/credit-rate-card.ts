import { formatNanoUsd } from "./cost";
import type { ExecutionPricingClass } from "./execution-class";
import { HISTORICAL_CLASSIFICATIONS, HISTORICAL_RUNS, type HistoricalRun } from "./historical-runs";

/**
 * Credit Rate Card simulation (Sprint 0052, Credit Economics v1, PARTS E-G).
 *
 * ## Nothing here is active
 *
 * `credits/rating.ts`'s `CREDIT_RATE_CARDS` stays `[]`. This module produces
 * **scenarios** — candidate commercial policies, evaluated against real
 * historical cost — never a rate a customer could be charged. Filling
 * `CREDIT_RATE_CARDS` is a separate, later, explicitly human decision.
 *
 * ## Why $0.01/Credit is a retail constant, not an infra number
 *
 * `RETAIL_NANO_USD_PER_CREDIT` prices what a customer buys a Credit *for* —
 * a product/sales decision, simulated here at the value this sprint's charter
 * specifies. It is not, and must never be read as, what a Credit costs Vibe
 * to deliver. `economy/run-economics.ts`'s `CreditScenario` already keeps
 * this same separation for its own, differently-shaped scenarios
 * (`usdPerCredit` there is likewise a sale price, not a cost); this module
 * is the same discipline applied to the three-tier model instead of a flat
 * cost-plus-margin one.
 */

export const RETAIL_NANO_USD_PER_CREDIT = 10_000_000; // $0.01

export const CREDIT_RATE_CARD_MODELS = ["A", "B", "C"] as const;
export type CreditRateCardModel = (typeof CREDIT_RATE_CARD_MODELS)[number];

export type CreditRateCardScenario = {
  model: CreditRateCardModel;
  label: string;
  creditsByClass: Record<ExecutionPricingClass, number>;
};

/**
 * Three simulated scenarios (PART F). Values are exactly the sprint's own
 * stated scenarios — "these are scenarios, not a decision" — kept unmodified
 * so the simulation below is checkable against the prompt that specified
 * them, rather than against numbers this file invented.
 */
export const CREDIT_RATE_CARD_SCENARIOS: readonly CreditRateCardScenario[] = [
  {
    model: "A",
    label: "Model A — Entry / Aggressive",
    creditsByClass: { small: 100, standard: 200, complex: 350 },
  },
  {
    model: "B",
    label: "Model B — Balanced",
    creditsByClass: { small: 150, standard: 250, complex: 450 },
  },
  {
    model: "C",
    label: "Model C — Margin Focused",
    creditsByClass: { small: 200, standard: 300, complex: 500 },
  },
];

export type RunEconomicCost = {
  run: number;
  pricingClass: ExecutionPricingClass;
  economicCostFloorNanoUsd: number;
  economicCostUpperNanoUsd: number;
};

export type RunMarginSimulation = {
  run: number;
  model: CreditRateCardModel;
  pricingClass: ExecutionPricingClass;
  credits: number;
  retailRevenueNanoUsd: number;
  economicCostFloorNanoUsd: number;
  economicCostUpperNanoUsd: number;
  /** Revenue minus the cost floor — the best-case margin, since the true cost is at least the floor. */
  grossProfitFloorNanoUsd: number;
  /** Revenue minus the upper bound — the worst-case margin within what is actually known. */
  grossProfitUpperNanoUsd: number;
  grossMarginFloor: number;
  grossMarginUpper: number;
};

/**
 * What one rate-card scenario would have charged and earned on one run
 * (PART G).
 *
 * Two margins are returned, not one, because every historical run's cost is
 * itself a range (`economy/sandbox-cost.ts`'s floor/upper-bound split, not
 * yet a point estimate for these six runs — Sprint 0051's fix applies only
 * forward). Collapsing that range to a single number here would manufacture
 * a precision the underlying data does not have.
 */
export function simulateCreditRateCard(
  scenario: CreditRateCardScenario,
  run: RunEconomicCost,
): RunMarginSimulation {
  const credits = scenario.creditsByClass[run.pricingClass];
  const retailRevenueNanoUsd = credits * RETAIL_NANO_USD_PER_CREDIT;
  const grossProfitFloorNanoUsd = retailRevenueNanoUsd - run.economicCostFloorNanoUsd;
  const grossProfitUpperNanoUsd = retailRevenueNanoUsd - run.economicCostUpperNanoUsd;

  return {
    run: run.run,
    model: scenario.model,
    pricingClass: run.pricingClass,
    credits,
    retailRevenueNanoUsd,
    economicCostFloorNanoUsd: run.economicCostFloorNanoUsd,
    economicCostUpperNanoUsd: run.economicCostUpperNanoUsd,
    grossProfitFloorNanoUsd,
    grossProfitUpperNanoUsd,
    grossMarginFloor: grossProfitFloorNanoUsd / retailRevenueNanoUsd,
    grossMarginUpper: grossProfitUpperNanoUsd / retailRevenueNanoUsd,
  };
}

/**
 * The historical run's pricing class, cost floor and cost upper bound,
 * joined for simulation. Exported so `failure-economics.ts` can build the
 * same per-run cost input without a second lookup of
 * `HISTORICAL_CLASSIFICATIONS` that could drift from this one.
 */
export function historicalRunCostInput(run: HistoricalRun): RunEconomicCost {
  const classification = HISTORICAL_CLASSIFICATIONS.find((c) => c.run === run.run);
  if (!classification || classification.pricingClass === null) {
    // Every run reaching this table executed, which requires a mutating
    // changeKind, which always produces a class — this branch is a real
    // invariant violation, not a data gap to paper over with a fallback.
    throw new Error(`Run #${run.run} has no reconstructed pricing class; cannot simulate a rate card.`);
  }

  return {
    run: run.run,
    pricingClass: classification.pricingClass,
    economicCostFloorNanoUsd: run.economicCostFloorNanoUsd,
    economicCostUpperNanoUsd: run.economicCostUpperNanoUsd,
  };
}

/**
 * Every historical run under every scenario — 6 runs × 3 models, 18 rows
 * (PART G's full table). Nothing here writes anything; it is read by the
 * documentation generator's own test and by `ECONOMY_MODEL.md`'s table,
 * kept in sync via the pinning test rather than retyped by hand.
 */
export function simulateAllHistoricalRuns(): readonly RunMarginSimulation[] {
  const costs = HISTORICAL_RUNS.map(historicalRunCostInput);
  return CREDIT_RATE_CARD_SCENARIOS.flatMap((scenario) =>
    costs.map((cost) => simulateCreditRateCard(scenario, cost)),
  );
}

/** For a report table: `"$2.00"` style formatting of a Credit price at the simulated retail value. */
export function formatCreditRetailValue(credits: number): string {
  return formatNanoUsd(credits * RETAIL_NANO_USD_PER_CREDIT, 2);
}
