import { CREDIT_RATE_CARD_SCENARIOS, type CreditRateCardModel } from "../credit-rate-card";
import type { RepositoryContextSize } from "../cost-drivers";
import {
  INFLATION_FACTORS,
  type InflationFactor,
  stressTestCreditEconomics,
} from "../stress-test";
import { resolveEconomyModel, type EconomyModelVersion } from "./model-version";
import { deriveRepositoryComplexity } from "./repository-signal";

/**
 * What breaks the economics, and how far away it is (Sprint 0054, PART M).
 *
 * ## What this adds to `stress-test.ts`
 *
 * That file already varies provider inflation, infrastructure inflation and
 * failure rate — the three axes Sprint 0052 could see. It cannot vary the
 * fourth, because the fourth did not exist yet: **repository growth**.
 *
 * That omission mattered. Run #9 cost 2.16x run #6 for a byte-identical step
 * against a repository that had grown, at an identical quote. A stress model
 * that cannot express "the customer's product got bigger" cannot see the one
 * cost movement Vibe has actually observed in production.
 *
 * ## Why growth enters through the complexity signal
 *
 * Not as a cost line — the same refusal as everywhere else in this layer.
 * Growth scales the repository the estimator measures, the complexity
 * multiplier responds, and the *multiplier* scales the cost. So the simulation
 * inherits whatever bounds `repositoryPolicy` sets, and a growth factor cannot
 * produce a cost the estimator itself would never predict.
 *
 * ## Why the recommendation is a word and not a decision
 *
 * `risk` and `recommendation` describe a scenario against the model version's
 * own margin target. They activate nothing, and the rate cards being compared
 * are `credit-rate-card.ts`'s hypothetical A/B/C — `CREDIT_RATE_CARDS` in
 * `credits/rating.ts` is `[]` before and after every function here.
 */

export const REPOSITORY_GROWTH_FACTORS = [1, 2, 5, 10] as const;
export type RepositoryGrowthFactor = (typeof REPOSITORY_GROWTH_FACTORS)[number];

export const SIMULATION_RISKS = ["acceptable", "watch", "unsustainable"] as const;
export type SimulationRisk = (typeof SIMULATION_RISKS)[number];

export type EconomySimulationScenario = {
  label: string;
  aiInflation: InflationFactor;
  infraInflation: InflationFactor;
  failureRate: number;
  repositoryGrowth: RepositoryGrowthFactor;
};

export type EconomySimulationResult = {
  scenario: EconomySimulationScenario;
  model: CreditRateCardModel;
  /** The complexity multiplier this much growth produces. Bounded by the repository policy. */
  repositoryMultiplier: number;
  effectiveCostPerDeliveredRunNanoUsd: number;
  averageRevenuePerDeliveredRunNanoUsd: number;
  grossMargin: number;
  risk: SimulationRisk;
  recommendation: string;
};

/** The reference repository this layer calibrates against, at the scale one growth factor implies. */
function grownRepository(
  factor: RepositoryGrowthFactor,
  model: EconomyModelVersion,
): RepositoryContextSize {
  const policy = model.repositoryPolicy;

  return {
    treeEntries: policy.referenceTreeEntries * factor,
    filesAnalyzed: null,
    bytesAnalyzed: null,
    routesDetected: policy.referenceRoutes * factor,
    surfacesDetected: null,
    candidatesAvailable: policy.referenceCandidates * factor,
    // The brief cap does not grow with the repository, which is precisely why
    // a bigger product costs more: more of what matters stops fitting.
    candidatesSent: policy.referenceCandidates,
  };
}

export function repositoryGrowthMultiplier(
  factor: RepositoryGrowthFactor,
  model: EconomyModelVersion,
): number {
  return deriveRepositoryComplexity(grownRepository(factor, model), model.repositoryPolicy).multiplier ?? 1;
}

export function simulateEconomy(
  scenario: EconomySimulationScenario,
  model: CreditRateCardModel,
  economyModel: EconomyModelVersion = resolveEconomyModel(new Date("2026-08-21T00:00:00Z")),
): EconomySimulationResult {
  const rateCard = CREDIT_RATE_CARD_SCENARIOS.find((entry) => entry.model === model);
  if (!rateCard) throw new Error(`Unknown rate card scenario: ${model}`);

  const stress = stressTestCreditEconomics(
    {
      label: scenario.label,
      failureRate: scenario.failureRate,
      aiInflation: scenario.aiInflation,
      infraInflation: scenario.infraInflation,
    },
    rateCard,
  );

  const repositoryMultiplier = repositoryGrowthMultiplier(scenario.repositoryGrowth, economyModel);

  // Growth moves the work, and the work is the model spend and the sandbox time
  // that carries it. Revenue does not move: the class is the same class, which
  // is the entire point of pricing by class.
  const effectiveCostPerDeliveredRunNanoUsd = Math.round(
    stress.effectiveCostPerDeliveredRunNanoUsd * repositoryMultiplier,
  );
  const revenue = stress.averageRevenuePerDeliveredRunNanoUsd;
  const grossMargin = (revenue - effectiveCostPerDeliveredRunNanoUsd) / revenue;

  return {
    scenario,
    model,
    repositoryMultiplier,
    effectiveCostPerDeliveredRunNanoUsd,
    averageRevenuePerDeliveredRunNanoUsd: revenue,
    grossMargin,
    risk: riskOf(grossMargin, economyModel.marginTarget),
    recommendation: recommendationFor(grossMargin, economyModel.marginTarget, scenario),
  };
}

function riskOf(grossMargin: number, target: number): SimulationRisk {
  if (grossMargin <= 0) return "unsustainable";
  return grossMargin >= target ? "acceptable" : "watch";
}

function recommendationFor(
  grossMargin: number,
  target: number,
  scenario: EconomySimulationScenario,
): string {
  if (grossMargin <= 0) {
    return `loses money under ${scenario.label}; this rate card cannot absorb it`;
  }
  if (grossMargin >= target) {
    return `holds the ${Math.round(target * 100)}% target under ${scenario.label}`;
  }
  return `survives ${scenario.label} at ${Math.round(grossMargin * 100)}%, below the ${Math.round(target * 100)}% target`;
}

/** One axis at a time, then the compound case. */
export const ECONOMY_SIMULATION_SCENARIOS: readonly EconomySimulationScenario[] = [
  ...INFLATION_FACTORS.map((factor) => ({
    label: `AI provider ${factor}`,
    aiInflation: factor,
    infraInflation: "current" as const,
    failureRate: 0,
    repositoryGrowth: 1 as const,
  })),
  ...INFLATION_FACTORS.filter((factor) => factor !== "current").map((factor) => ({
    label: `infrastructure ${factor}`,
    aiInflation: "current" as const,
    infraInflation: factor,
    failureRate: 0,
    repositoryGrowth: 1 as const,
  })),
  ...[0.1, 0.2, 0.4].map((rate) => ({
    label: `failure rate ${Math.round(rate * 100)}%`,
    aiInflation: "current" as const,
    infraInflation: "current" as const,
    failureRate: rate,
    repositoryGrowth: 1 as const,
  })),
  ...REPOSITORY_GROWTH_FACTORS.filter((factor) => factor !== 1).map((factor) => ({
    label: `repository ${factor}x`,
    aiInflation: "current" as const,
    infraInflation: "current" as const,
    failureRate: 0,
    repositoryGrowth: factor,
  })),
  {
    label: "everything at once",
    aiInflation: "+50%",
    infraInflation: "+50%",
    failureRate: 0.4,
    repositoryGrowth: 5,
  },
];

export function runEconomySimulations(): readonly EconomySimulationResult[] {
  return CREDIT_RATE_CARD_SCENARIOS.flatMap((rateCard) =>
    ECONOMY_SIMULATION_SCENARIOS.map((scenario) => simulateEconomy(scenario, rateCard.model)),
  );
}
