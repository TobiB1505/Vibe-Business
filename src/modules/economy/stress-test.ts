import {
  CREDIT_RATE_CARD_SCENARIOS,
  RETAIL_NANO_USD_PER_CREDIT,
  historicalRunCostInput,
  simulateCreditRateCard,
  type CreditRateCardModel,
  type CreditRateCardScenario,
} from "./credit-rate-card";
import {
  FAILED_ATTEMPT_COSTS,
  calculateDeliveredRunMargin,
  computeHistoricalFailureEconomics,
} from "./failure-economics";
import { HISTORICAL_CLASSIFICATIONS, HISTORICAL_RUNS } from "./historical-runs";

/**
 * Stress testing (Sprint 0052, Credit Economics v1, PARTS I/J).
 *
 * ## What varies, and what stays fixed
 *
 * A stress scenario never changes which Execution Pricing Class a run gets —
 * that classification is a structural, pre-execution fact (PART C/L), not an
 * economic one, so it is not a lever this file touches. What it varies is
 * cost: the failure rate (how often an attempt is thrown away before
 * delivering anything), and two independent inflation multipliers — AI
 * provider price and infrastructure price — applied separately because they
 * are separate real risks with separate causes (Anthropic once had a 50%
 * Sonnet 5 rise scheduled for 2026-09-01 and withdrew it before it took
 * effect; a sandbox price change is a different provider's decision entirely,
 * and neither one predicts the other).
 *
 * ## Where the per-attempt components come from
 *
 * `historical-runs.ts` carries each delivered run's `providerCostNanoUsd`
 * split out from its floor; `failure-economics.ts` carries the same split for
 * every failed attempt. Both are real, already-tested figures — this file
 * only re-weights them under a hypothetical failure rate and hypothetical
 * inflation, it does not invent new base costs.
 *
 * ## The failure-rate model
 *
 * A failure rate `f` (failed attempts as a share of *all* attempts) implies
 * `f / (1 - f)` failed attempts per delivered run — the algebra behind "20%
 * of attempts fail" is "for every 4 that deliver, 1 fails". At `f = 0` that
 * is zero extra attempts; it is undefined at `f = 1`, which is why 100% is
 * not one of the sprint's five stress points.
 */

export const INFLATION_FACTORS = ["current", "+25%", "+50%", "+100%"] as const;
export type InflationFactor = (typeof INFLATION_FACTORS)[number];

const INFLATION_MULTIPLIERS: Record<InflationFactor, number> = {
  current: 1,
  "+25%": 1.25,
  "+50%": 1.5,
  "+100%": 2,
};

/** The real, observed historical failure rate (5 failed / 11 total attempts) — see `failure-economics.ts`. */
export const HISTORICAL_FAILURE_RATE = computeHistoricalFailureEconomics().historicalFailureRate;

export type StressScenario = {
  label: string;
  /** Failed attempts as a share of all attempts, in [0, 1). */
  failureRate: number;
  aiInflation: InflationFactor;
  infraInflation: InflationFactor;
};

type BaseComponents = {
  providerPerDeliveredRunNanoUsd: number;
  infraPerDeliveredRunNanoUsd: number;
  providerPerFailedAttemptNanoUsd: number;
  infraPerFailedAttemptNanoUsd: number;
};

/** The real historical per-attempt AI/infra split, averaged — computed once, not cached across calls. */
function baseComponents(): BaseComponents {
  const deliveredProviderSum = HISTORICAL_RUNS.reduce((sum, r) => sum + r.providerCostNanoUsd, 0);
  const deliveredFloorSum = HISTORICAL_RUNS.reduce((sum, r) => sum + r.economicCostFloorNanoUsd, 0);
  const deliveredInfraSum = deliveredFloorSum - deliveredProviderSum;

  const failedProviderSum = FAILED_ATTEMPT_COSTS.reduce((sum, f) => sum + f.providerCostNanoUsd, 0);
  const failedInfraSum = FAILED_ATTEMPT_COSTS.reduce((sum, f) => sum + f.infrastructureCostNanoUsd, 0);

  return {
    providerPerDeliveredRunNanoUsd: deliveredProviderSum / HISTORICAL_RUNS.length,
    infraPerDeliveredRunNanoUsd: deliveredInfraSum / HISTORICAL_RUNS.length,
    providerPerFailedAttemptNanoUsd: failedProviderSum / FAILED_ATTEMPT_COSTS.length,
    infraPerFailedAttemptNanoUsd: failedInfraSum / FAILED_ATTEMPT_COSTS.length,
  };
}

/** Average revenue per delivered run under one rate card, from the real historical class mix — never varies with a stress scenario. */
function averageRevenuePerDeliveredRunNanoUsd(rateCard: CreditRateCardScenario): number {
  const total = HISTORICAL_CLASSIFICATIONS.reduce((sum, c) => {
    if (c.pricingClass === null) {
      throw new Error(`Run #${c.run} has no pricing class; cannot compute stress-test revenue.`);
    }
    return sum + rateCard.creditsByClass[c.pricingClass] * RETAIL_NANO_USD_PER_CREDIT;
  }, 0);
  return total / HISTORICAL_CLASSIFICATIONS.length;
}

export type StressTestResult = {
  scenario: StressScenario;
  model: CreditRateCardModel;
  effectiveCostPerDeliveredRunNanoUsd: number;
  averageRevenuePerDeliveredRunNanoUsd: number;
  grossProfitPerDeliveredRunNanoUsd: number;
  grossMargin: number;
};

/**
 * One rate card, evaluated under one hypothetical stress scenario.
 *
 * `f / (1 - f)` expected failed attempts per delivered run, each costing the
 * historical average failed-attempt cost inflated the same way delivered
 * cost is. This is the same effective-cost shape
 * `computeHistoricalFailureEconomics` uses for the real data, generalised to
 * a hypothetical failure rate and hypothetical prices.
 */
export function stressTestCreditEconomics(
  scenario: StressScenario,
  rateCard: CreditRateCardScenario,
): StressTestResult {
  if (scenario.failureRate < 0 || scenario.failureRate >= 1) {
    throw new Error(`failureRate must be in [0, 1); received ${scenario.failureRate}`);
  }

  const base = baseComponents();
  const aiMultiplier = INFLATION_MULTIPLIERS[scenario.aiInflation];
  const infraMultiplier = INFLATION_MULTIPLIERS[scenario.infraInflation];

  const deliveredRunCostNanoUsd =
    base.providerPerDeliveredRunNanoUsd * aiMultiplier + base.infraPerDeliveredRunNanoUsd * infraMultiplier;

  const failedAttemptsPerDeliveredRun = scenario.failureRate / (1 - scenario.failureRate);
  const perFailedAttemptCostNanoUsd =
    base.providerPerFailedAttemptNanoUsd * aiMultiplier + base.infraPerFailedAttemptNanoUsd * infraMultiplier;

  const effectiveCostPerDeliveredRunNanoUsd = Math.round(
    deliveredRunCostNanoUsd + failedAttemptsPerDeliveredRun * perFailedAttemptCostNanoUsd,
  );

  const revenue = averageRevenuePerDeliveredRunNanoUsd(rateCard);
  const grossProfitPerDeliveredRunNanoUsd = revenue - effectiveCostPerDeliveredRunNanoUsd;

  return {
    scenario,
    model: rateCard.model,
    effectiveCostPerDeliveredRunNanoUsd,
    averageRevenuePerDeliveredRunNanoUsd: revenue,
    grossProfitPerDeliveredRunNanoUsd,
    grossMargin: grossProfitPerDeliveredRunNanoUsd / revenue,
  };
}

/* ---------------------------------------------------------------------------
 * The named scenario sets the sprint specified (PART I)
 * ------------------------------------------------------------------------ */

export const FAILURE_RATE_STRESS_SCENARIOS: readonly StressScenario[] = [0.1, 0.2, 0.3, 0.4, 0.5].map(
  (rate) => ({
    label: `Failure rate ${Math.round(rate * 100)}%`,
    failureRate: rate,
    aiInflation: "current",
    infraInflation: "current",
  }),
);

export const INFRASTRUCTURE_INFLATION_SCENARIOS: readonly StressScenario[] = INFLATION_FACTORS.map(
  (factor) => ({
    label: `Infrastructure ${factor}`,
    failureRate: HISTORICAL_FAILURE_RATE,
    aiInflation: "current",
    infraInflation: factor,
  }),
);

export const AI_INFLATION_STRESS_SCENARIOS: readonly StressScenario[] = INFLATION_FACTORS.map((factor) => ({
  label: `AI provider ${factor}`,
  failureRate: HISTORICAL_FAILURE_RATE,
  aiInflation: factor,
  infraInflation: "current",
}));

export const COMBINED_STRESS_SCENARIO: StressScenario = {
  label: "Combined stress — AI +50%, Infrastructure +50%, Failure rate 40%",
  failureRate: 0.4,
  aiInflation: "+50%",
  infraInflation: "+50%",
};

export const ALL_STRESS_SCENARIOS: readonly StressScenario[] = [
  ...FAILURE_RATE_STRESS_SCENARIOS,
  ...INFRASTRUCTURE_INFLATION_SCENARIOS,
  ...AI_INFLATION_STRESS_SCENARIOS,
  COMBINED_STRESS_SCENARIO,
];

/** Every scenario × every rate card — the full PART I table. */
export function runAllStressTests(): readonly StressTestResult[] {
  return ALL_STRESS_SCENARIOS.flatMap((scenario) =>
    CREDIT_RATE_CARD_SCENARIOS.map((rateCard) => stressTestCreditEconomics(scenario, rateCard)),
  );
}

/* ---------------------------------------------------------------------------
 * PART J — margin targets
 * ------------------------------------------------------------------------ */

export const MARGIN_TARGETS = [0.7, 0.75, 0.8, 0.85] as const;

export type MarginTargetEvaluation = {
  model: CreditRateCardModel;
  averageGrossMargin: number;
  medianGrossMargin: number;
  worstCaseRunMargin: number;
  failureAdjustedGrossMargin: number;
  combinedStressMargin: number;
  /** Which of MARGIN_TARGETS each of the five margins above clears. */
  meetsTarget: Record<(typeof MARGIN_TARGETS)[number], boolean>;
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * The five margin figures PART J asks for, per rate card, evaluated against
 * each of the four candidate target margins.
 */
export function evaluateMarginTargets(rateCard: CreditRateCardScenario): MarginTargetEvaluation {
  const perRunMargins = HISTORICAL_RUNS.map(
    (run) => simulateCreditRateCard(rateCard, historicalRunCostInput(run)).grossMarginUpper,
  );
  const averageGrossMargin = perRunMargins.reduce((sum, m) => sum + m, 0) / perRunMargins.length;
  const medianGrossMargin = median(perRunMargins);
  const worstCaseRunMargin = Math.min(...perRunMargins);

  const failureAdjustedGrossMargin = calculateDeliveredRunMargin(rateCard).grossMargin;
  const combinedStressMargin = stressTestCreditEconomics(COMBINED_STRESS_SCENARIO, rateCard).grossMargin;

  const marginsToCheck = [
    averageGrossMargin,
    medianGrossMargin,
    worstCaseRunMargin,
    failureAdjustedGrossMargin,
    combinedStressMargin,
  ];

  const meetsTarget = Object.fromEntries(
    MARGIN_TARGETS.map((target) => [target, marginsToCheck.every((m) => m >= target)]),
  ) as Record<(typeof MARGIN_TARGETS)[number], boolean>;

  return {
    model: rateCard.model,
    averageGrossMargin,
    medianGrossMargin,
    worstCaseRunMargin,
    failureAdjustedGrossMargin,
    combinedStressMargin,
    meetsTarget,
  };
}

export function evaluateAllMarginTargets(): readonly MarginTargetEvaluation[] {
  return CREDIT_RATE_CARD_SCENARIOS.map(evaluateMarginTargets);
}
