import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { ValidationDepth } from "@/modules/validation/depth";
import type { RepositoryContextSize } from "../cost-drivers";
import { HISTORICAL_RUNS, type HistoricalRun } from "../historical-runs";
import type { ExecutionPricingClass, ExecutionPricingClassReason } from "../execution-class";
import type { EstimateConfidence } from "./confidence";
import type { HistoricalExpectation, WeightingPolicyName } from "./historical-similarity";
import { WEIGHTING_POLICIES } from "./historical-similarity";
import type { EconomyModelVersion } from "./model-version";
import type { ModelProviderRates } from "./provider-rates";
import {
  type EstimateExecutionEconomicsInput,
  type ExecutionEconomicsEstimate,
  estimateExecutionEconomics,
} from "./pre-execution-estimate";
import type { ModelProviderId } from "./provider-rates";
import type { RepositoryDriftSignal } from "./repository-drift";
import type { RepositoryComplexitySignal } from "./repository-signal";
import { type SafetyMargin, deriveSafetyMargin } from "./safety-margin";

/**
 * The complete reasoning behind one estimate (Sprint 0054).
 *
 * ## The question this exists to answer
 *
 * Six months from now: *"why did Economy Intelligence estimate this execution
 * at 350 Credits?"*
 *
 * Without a snapshot the answer is archaeology — find the commit that was
 * deployed that week, guess which pricing row was live, hope the dataset has
 * not grown since. With one it is a lookup, because a snapshot plus its named
 * economy model version is enough to recompute the estimate exactly. A test
 * asserts precisely that: replay every field and the result must equal the
 * estimate the snapshot carries.
 *
 * That property is what "do not create opaque numbers" means operationally.
 * Every figure in here is an input, a named version, or derivable from the two.
 *
 * ## Why nothing persists it
 *
 * Deliberately. This sprint changes no schema, and inventing one before the
 * Credit Settlement sprint knows what it needs to query is how you get a table
 * nobody can use. What the type gives that sprint is a shape to write rather
 * than a shape to design — and, because it is exercised by tests today, one
 * that is known to hold everything an explanation needs.
 *
 * ## Why the matched runs are copied in, and not just their mean
 *
 * Reproduction has to survive the dataset growing. If replay re-queried
 * `HISTORICAL_RUNS`, an estimate made against seven runs would silently
 * recompute against fifty and stop matching its own snapshot — which is exactly
 * the drift the version machinery exists to prevent, reintroduced one level
 * down. So the rows the answer was actually computed from travel with it.
 *
 * ## Why the model rates are copied in
 *
 * `providerPricingVersion` alone identifies the row, but resolving it back
 * requires the price book at that version to still exist. Rates are append-only
 * in `ai/pricing.ts` and are meant to stay so; copying the four numbers costs
 * nothing and makes the snapshot self-contained if that ever slips.
 */

/** The pre-execution facts, exactly as the estimator saw them. */
export type SnapshotInputs = {
  pricingClass: ExecutionPricingClass | null;
  pricingClassReason: ExecutionPricingClassReason;
  riskClass: ExecutionRiskClass;
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
  surfaces: readonly string[];
  repositoryContext: RepositoryContextSize | null;
  expectedValidationDepth: ValidationDepth | null;
};

export type SnapshotModelRates = {
  provider: ModelProviderId;
  model: string;
  pricingVersion: string;
  inputNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
  cacheReadNanoUsdPerToken: number;
  cacheWriteNanoUsdPerToken: number;
} | null;

export type PredictionSnapshot = {
  /** The instant the estimate was made for — from the injected clock, never read from one. */
  at: string;
  economyModelVersion: string;
  providerPricingVersion: string | null;
  infrastructurePricingVersion: string;
  inputs: SnapshotInputs;
  modelRates: SnapshotModelRates;
  repositorySignal: RepositoryComplexitySignal;
  repositoryDrift: RepositoryDriftSignal;
  historicalExpectation: HistoricalExpectation;
  /** The dataset rows the expectation was computed from, so replay never re-queries a grown dataset. */
  matchedRuns: readonly HistoricalRun[];
  weightingPolicy: WeightingPolicyName;
  cohortCorrection: number;
  confidence: EstimateConfidence;
  safetyMargin: SafetyMargin;
  estimate: ExecutionEconomicsEstimate;
};

export function capturePredictionSnapshot(
  input: EstimateExecutionEconomicsInput,
  weightingPolicy: WeightingPolicyName = "similarity_only",
): PredictionSnapshot {
  const estimate = estimateExecutionEconomics({
    ...input,
    historicalWeighting: input.historicalWeighting ?? WEIGHTING_POLICIES[weightingPolicy],
  });

  const matchedNumbers = new Set(estimate.historicalExpectation.matches.map((match) => match.run));
  const dataset = input.historicalRuns ?? HISTORICAL_RUNS;

  return {
    at: input.at.toISOString(),
    economyModelVersion: input.economyModel.version,
    providerPricingVersion: estimate.providerPricingVersion,
    infrastructurePricingVersion: input.economyModel.infrastructurePricingVersion,
    inputs: {
      pricingClass: input.pricingClass,
      pricingClassReason: input.pricingClassReason,
      riskClass: input.riskClass,
      changeKind: input.changeKind,
      evidenceIds: input.evidenceIds,
      surfaces: input.surfaces,
      repositoryContext: input.repositoryContext,
      expectedValidationDepth: input.expectedValidationDepth,
    },
    modelRates: copyRates(input.modelRates),
    repositorySignal: estimate.repositorySignal,
    repositoryDrift: estimate.repositoryDrift,
    historicalExpectation: estimate.historicalExpectation,
    matchedRuns: dataset.filter((run) => matchedNumbers.has(run.run)),
    weightingPolicy,
    cohortCorrection: estimate.cohortCorrection,
    confidence: estimate.confidence,
    safetyMargin: deriveSafetyMargin(estimate, input.economyModel.safetyPolicy),
    estimate,
  };
}

/**
 * Rebuilds the estimator input a snapshot was produced from.
 *
 * Passes the snapshotted rows back rather than re-querying a dataset that has
 * since grown. Runs below the match threshold contributed nothing to the
 * original answer, so restricting the dataset to the matches is not an
 * approximation — it is the same computation with the zero-weight terms removed.
 */
export function replayInput(
  snapshot: PredictionSnapshot,
  economyModel: EconomyModelVersion,
): EstimateExecutionEconomicsInput {
  return {
    at: new Date(snapshot.at),
    ...snapshot.inputs,
    repositoryDrift: snapshot.repositoryDrift,
    modelRates: snapshot.modelRates,
    economyModel,
    historicalRuns: snapshot.matchedRuns,
    historicalWeighting: WEIGHTING_POLICIES[snapshot.weightingPolicy],
    cohortCorrection: snapshot.cohortCorrection,
  };
}

function copyRates(rates: ModelProviderRates | null): SnapshotModelRates {
  if (!rates) return null;
  return {
    provider: rates.provider,
    model: rates.model,
    pricingVersion: rates.pricingVersion,
    inputNanoUsdPerToken: rates.inputNanoUsdPerToken,
    outputNanoUsdPerToken: rates.outputNanoUsdPerToken,
    cacheReadNanoUsdPerToken: rates.cacheReadNanoUsdPerToken,
    cacheWriteNanoUsdPerToken: rates.cacheWriteNanoUsdPerToken,
  };
}
