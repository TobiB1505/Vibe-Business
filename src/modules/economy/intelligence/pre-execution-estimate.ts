import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { ValidationDepth } from "@/modules/validation/depth";
import { type CostAmount, estimated, unknown } from "../cost";
import type { RepositoryContextSize } from "../cost-drivers";
import type { ExecutionPricingClass, ExecutionPricingClassReason } from "../execution-class";
import type { HistoricalRun } from "../historical-runs";
import { type EstimateConfidence, combineConfidence } from "./confidence";
import {
  type HistoricalExpectation,
  type HistoricalWeighting,
  findSimilarRuns,
} from "./historical-similarity";
import type { EconomyModelVersion } from "./model-version";
import type { ModelProviderRates } from "./provider-rates";
import { type RepositoryDriftSignal, NO_PRIOR_EXECUTION } from "./repository-drift";
import { type RepositoryComplexitySignal, deriveRepositoryComplexity } from "./repository-signal";

/**
 * What this improvement will probably cost (Sprint 0054, PART C).
 *
 * ## The one rule this file exists to keep
 *
 * It may only see what exists **before** the agent starts. Not tokens, not
 * runtime, not sandbox milliseconds, not a single row of `ai_usage_events`.
 *
 * That is not fastidiousness. A quote computed from a run's own outcome is not
 * a quote, it is a bill — and an estimator that can reach actuals will
 * eventually be "improved" into one, at which point the prediction/reality
 * comparison that makes the whole layer worth having compares a number against
 * itself and reports perfect accuracy forever.
 *
 * `pre-execution-estimate.test.ts` scans this source for the forbidden
 * identifiers, because a rule that lives only in a comment is a rule that lasts
 * until the next person in a hurry.
 *
 * ## Why learning arrives as a scalar
 *
 * The layer is supposed to get better as runs accumulate — that is the point of
 * `prediction-bias.ts`. But if this function read the learning dataset directly,
 * it would read outcomes, and the rule above would be gone.
 *
 * So the correction is computed elsewhere, from cohorts, and passed in as one
 * number. The estimator stays a pure function of pre-execution inputs; the loop
 * still closes; and re-running an old estimate with its recorded correction
 * reproduces it exactly.
 *
 * ## Why the output is a `CostAmount`
 *
 * Because "no comparable runs and no rate for this model" has an answer, and
 * the answer is not zero. `cost.ts` already refuses to let an absence be summed
 * as a number, and an estimate is exactly where that refusal matters most: a
 * confident $0.00 is the most expensive number this system could produce.
 */

export const ESTIMATE_REASONS = [
  "historical_neighbours",
  "no_comparable_runs",
  "repository_measured",
  "repository_unmeasured",
  "context_pressure_high",
  "repository_drift_high",
  "validation_depth_assumed",
  "validation_depth_unknown",
  "cohort_correction_applied",
  "not_a_mutating_change",
  "model_rate_unavailable",
] as const;
export type EstimateReason = (typeof ESTIMATE_REASONS)[number];

export const COST_DRIVER_EFFECTS = ["raises", "lowers", "neutral", "unknown"] as const;
export type CostDriverEffect = (typeof COST_DRIVER_EFFECTS)[number];

export type EstimateCostDriver = {
  driver: "historical_baseline" | "repository_complexity" | "context_pressure" | "repository_drift" | "validation_depth" | "cohort_correction";
  effect: CostDriverEffect;
  /** A short, deterministic label. Never model prose. */
  detail: string;
};

/** Which inputs were actually present. Carried so an estimate can explain its own weakness. */
export type EstimateProvenance = {
  hadHistoricalNeighbours: boolean;
  hadRepositoryContext: boolean;
  hadRepositoryDrift: boolean;
  hadValidationDepth: boolean;
  hadModelRates: boolean;
};

export type EstimateExecutionEconomicsInput = {
  /**
   * Injected rather than read from the clock, so the same inputs produce the
   * same estimate on any day and a past estimate can be replayed.
   */
  at: Date;
  pricingClass: ExecutionPricingClass | null;
  pricingClassReason: ExecutionPricingClassReason;
  riskClass: ExecutionRiskClass;
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
  surfaces: readonly string[];
  repositoryContext: RepositoryContextSize | null;
  /** Movement since the last execution against this project. `NO_PRIOR_EXECUTION` when there was none. */
  repositoryDrift?: RepositoryDriftSignal;
  expectedValidationDepth: ValidationDepth | null;
  modelRates: ModelProviderRates | null;
  economyModel: EconomyModelVersion;
  historicalRuns?: readonly HistoricalRun[];
  historicalWeighting?: HistoricalWeighting;
  /** From `correctionForCohort`. 1 means no cohort evidence, which is today's answer for every cohort. */
  cohortCorrection?: number;
};

export type ExecutionEconomicsEstimate = {
  /** The class this estimate was made for. Null for a step that changes nothing. */
  pricingClass: ExecutionPricingClass | null;
  pricingClassReason: ExecutionPricingClassReason;
  estimatedCost: CostAmount;
  /** The same estimate against the historical upper bound. Null when unassessable. */
  estimatedCostUpperNanoUsd: number | null;
  confidence: EstimateConfidence;
  costDrivers: readonly EstimateCostDriver[];
  reasons: readonly EstimateReason[];
  economyModelVersion: string;
  providerPricingVersion: string | null;
  repositorySignal: RepositoryComplexitySignal;
  repositoryDrift: RepositoryDriftSignal;
  historicalExpectation: HistoricalExpectation;
  cohortCorrection: number;
  provenance: EstimateProvenance;
};

/** Drift is a signal about risk, not a cost multiplier of its own — it nudges, gently. */
const DRIFT_MULTIPLIERS: Record<RepositoryDriftSignal["driftLevel"], number> = {
  unknown: 1,
  stable: 1,
  changed: 1.05,
  high_change: 1.15,
};

export function estimateExecutionEconomics(
  input: EstimateExecutionEconomicsInput,
): ExecutionEconomicsEstimate {
  const drift = input.repositoryDrift ?? NO_PRIOR_EXECUTION;
  const cohortCorrection = input.cohortCorrection ?? 1;

  const repositorySignal = deriveRepositoryComplexity(
    input.repositoryContext,
    input.economyModel.repositoryPolicy,
  );

  const historicalExpectation = findSimilarRuns(
    {
      pricingClass: input.pricingClass,
      changeKind: input.changeKind,
      riskClass: input.riskClass,
      evidenceIds: input.evidenceIds,
    },
    { dataset: input.historicalRuns, weighting: input.historicalWeighting, at: input.at },
  );

  const reasons: EstimateReason[] = [];
  const costDrivers: EstimateCostDriver[] = [];

  if (input.pricingClass === null) reasons.push("not_a_mutating_change");
  if (!input.modelRates) reasons.push("model_rate_unavailable");

  const validationMultiplier = validationTerm(input, reasons, costDrivers);
  const repositoryMultiplier = repositoryTerm(repositorySignal, reasons, costDrivers);
  const driftMultiplier = driftTerm(drift, reasons, costDrivers);

  if (cohortCorrection !== 1) {
    reasons.push("cohort_correction_applied");
    costDrivers.push({
      driver: "cohort_correction",
      effect: cohortCorrection > 1 ? "raises" : "lowers",
      detail: `cohort correction ${cohortCorrection.toFixed(2)}x`,
    });
  }

  const multiplier = repositoryMultiplier * driftMultiplier * validationMultiplier * cohortCorrection;

  const base = historicalExpectation.expectedFloorNanoUsd;
  const upperBase = historicalExpectation.expectedUpperNanoUsd;

  if (base === null) {
    reasons.push("no_comparable_runs");
    costDrivers.push({
      driver: "historical_baseline",
      effect: "unknown",
      detail: "no comparable run has ever been executed",
    });
  } else {
    reasons.push("historical_neighbours");
    costDrivers.push({
      driver: "historical_baseline",
      effect: "neutral",
      detail: `${historicalExpectation.sampleSize} comparable run(s), ${historicalExpectation.basis}`,
    });
  }

  // The historical floor is Vibe's own money, already spent, on work of this
  // shape. Without one there is nothing to scale, and no amount of repository
  // measurement invents a baseline — which is what keeps repository size alone
  // from producing a price.
  const estimatedCost: CostAmount =
    base === null ? unknown("not_measured") : estimated(Math.round(base * multiplier));

  return {
    pricingClass: input.pricingClass,
    pricingClassReason: input.pricingClassReason,
    estimatedCost,
    estimatedCostUpperNanoUsd: upperBase === null ? null : Math.round(upperBase * multiplier),
    confidence: combineConfidence({
      historicalData: historicalExpectation.confidence,
      repositorySignal: repositorySignal.measured ? "high" : "none",
      providerPricing: input.modelRates ? "high" : "none",
      sampleSize: historicalExpectation.sampleSize,
    }),
    costDrivers,
    reasons,
    economyModelVersion: input.economyModel.version,
    providerPricingVersion: input.modelRates?.pricingVersion ?? null,
    repositorySignal,
    repositoryDrift: drift,
    historicalExpectation,
    cohortCorrection,
    provenance: {
      hadHistoricalNeighbours: historicalExpectation.sampleSize > 0,
      hadRepositoryContext: repositorySignal.measured,
      hadRepositoryDrift: drift.measurable.length > 0,
      hadValidationDepth: input.expectedValidationDepth !== null,
      hadModelRates: input.modelRates !== null,
    },
  };
}

function repositoryTerm(
  signal: RepositoryComplexitySignal,
  reasons: EstimateReason[],
  drivers: EstimateCostDriver[],
): number {
  if (!signal.measured || signal.multiplier === null) {
    reasons.push("repository_unmeasured");
    drivers.push({
      driver: "repository_complexity",
      effect: "unknown",
      detail: "the repository was never measured at this commit",
    });
    return 1;
  }

  reasons.push("repository_measured");
  drivers.push({
    driver: "repository_complexity",
    effect: signal.multiplier > 1 ? "raises" : signal.multiplier < 1 ? "lowers" : "neutral",
    detail: `complexity ${signal.multiplier.toFixed(2)}x against the reference repository`,
  });

  if (signal.pressure.signal === "severe" || signal.pressure.signal === "moderate") {
    reasons.push("context_pressure_high");
    drivers.push({
      driver: "context_pressure",
      effect: "raises",
      detail: `${signal.pressure.signal} pressure; relevant context did not fit the brief`,
    });
  }

  return signal.multiplier;
}

function driftTerm(
  drift: RepositoryDriftSignal,
  reasons: EstimateReason[],
  drivers: EstimateCostDriver[],
): number {
  const multiplier = DRIFT_MULTIPLIERS[drift.driftLevel];

  if (drift.driftLevel === "high_change") {
    reasons.push("repository_drift_high");
    drivers.push({
      driver: "repository_drift",
      effect: "raises",
      detail: "the repository moved substantially since the last execution",
    });
  }

  return multiplier;
}

/**
 * Validation depth, applied to the validation share and nothing else.
 *
 * The historical baseline is a whole run — model spend, agent sandbox and
 * whatever validation that run did. Multiplying all of it by a depth ratio
 * would reprice the model spend because the test suite got shorter, which is
 * both wrong and, at `fast`, wrong by about 20% of the answer.
 *
 * So the ratio moves only `assumedValidationCostShare` of the estimate. At
 * `standard` the ratio is 1 and the term vanishes, which is the correct
 * behaviour: the baseline runs were mostly validated at what standard now means.
 */
function validationTerm(
  input: EstimateExecutionEconomicsInput,
  reasons: EstimateReason[],
  drivers: EstimateCostDriver[],
): number {
  const depth = input.expectedValidationDepth;

  if (depth === null) {
    reasons.push("validation_depth_unknown");
    drivers.push({
      driver: "validation_depth",
      effect: "unknown",
      detail: "the depth this change will validate at is not yet resolved",
    });
    return 1;
  }

  const assumptions = input.economyModel.validationAssumptions;
  const ratio = assumptions[depth].expectedWallMs / assumptions.standard.expectedWallMs;
  const share = input.economyModel.assumedValidationCostShare;
  const multiplier = 1 + share * (ratio - 1);

  reasons.push("validation_depth_assumed");
  drivers.push({
    driver: "validation_depth",
    effect: multiplier > 1 ? "raises" : multiplier < 1 ? "lowers" : "neutral",
    detail: `${depth}: ${assumptions[depth].label}`,
  });

  return multiplier;
}
