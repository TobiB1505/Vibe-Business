import { type CostAmount, measured, sumCosts, unknown } from "../cost";
import { HISTORICAL_RUNS, type HistoricalRun } from "../historical-runs";
import { reconstructHistoricalClassification } from "../historical-runs";
import type { ActualExecutionEconomics } from "./actual-economics";
import { resolveEconomyModel, type EconomyModelVersion } from "./model-version";
import {
  type EstimateExecutionEconomicsInput,
  type ExecutionEconomicsEstimate,
  estimateExecutionEconomics,
} from "./pre-execution-estimate";
import { anthropicRates } from "./provider-rates";
import { NO_PRIOR_EXECUTION } from "./repository-drift";
import { type EconomicsComparison, compareEstimateToActual } from "./reconciliation";

/**
 * What the estimator would have said about the runs Vibe has already paid for
 * (Sprint 0054, PART O).
 *
 * ## Leave-one-out, or the answer is meaningless
 *
 * A backtest that lets a run predict itself is a memory test. Run #9's cost is
 * in `HISTORICAL_RUNS`, so estimating run #9 against the full dataset would
 * quote a number partly composed of run #9 and then congratulate itself on the
 * accuracy.
 *
 * So each run is estimated against the dataset **without** it. That is the only
 * form of this that says anything about a run Vibe has not done yet, which is
 * the only kind it will ever be asked about.
 *
 * ## What this cannot show, and says so
 *
 * Every record here carries `repositoryContextAvailable: false`, and it is a
 * literal type rather than a value that happens to be false. The `repo_*`
 * columns were added at 2026-08-20T20:00Z; run #9, the newest, was created at
 * 2026-08-20T15:07Z. **No run in this dataset has repository size**, so the
 * backtest exercises the historical and validation terms and cannot exercise
 * the repository or drift terms at all.
 *
 * That is a gap in the evidence, not a defect in the engine, and the difference
 * matters: the fix is twenty runs with repository context, not a code change.
 *
 * ## `HISTORICAL_RUNS` is read and never written
 *
 * The learning records are a new array in a new file. Nothing in this module
 * mutates the dataset, back-fills it, or corrects it — "historische Daten
 * niemals überschreiben" is enforced by there being no write to overwrite with.
 */

export type LearningRecord = {
  run: number;
  /** Reconstructed from pre-execution fields only — never from what the run went on to cost. */
  input: EstimateExecutionEconomicsInput;
  prediction: ExecutionEconomicsEstimate;
  actualFloorNanoUsd: number;
  actualUpperNanoUsd: number;
  comparison: EconomicsComparison;
  /**
   * Always false, as a type. See the module comment: no delivered run predates
   * the migration that records repository size.
   */
  repositoryContextAvailable: false;
};

/**
 * The economy model version the backtest is run under.
 *
 * The runs predate every version, so this is explicitly "what v1 would have
 * said", not "what Vibe said at the time". Vibe said nothing at the time; the
 * estimator did not exist.
 */
export const BACKTEST_MODEL_VERSION = "economy-model.v1";

const BACKTEST_AT = new Date("2026-08-21T00:00:00Z");

function backtestInput(
  run: HistoricalRun,
  dataset: readonly HistoricalRun[],
  model: EconomyModelVersion,
): EstimateExecutionEconomicsInput {
  const classification = reconstructHistoricalClassification(run);

  return {
    at: BACKTEST_AT,
    pricingClass: classification.pricingClass,
    pricingClassReason: classification.reason,
    riskClass: run.riskClass,
    changeKind: run.changeKind,
    evidenceIds: run.evidenceIds,
    surfaces: classification.surfaces,
    // The honest value, and the one the module comment explains.
    repositoryContext: null,
    repositoryDrift: NO_PRIOR_EXECUTION,
    // Every delivered run predates risk-adaptive depth, so none of them recorded
    // one. `standard` would be a guess; null is what Vibe actually knows.
    expectedValidationDepth: null,
    modelRates: anthropicRates("claude-sonnet-5", BACKTEST_AT),
    economyModel: model,
    historicalRuns: dataset,
    // No cohort has ever cleared the sample floor, so there is no correction to
    // apply and applying one would be fitting to seven points.
    cohortCorrection: 1,
  };
}

/**
 * A delivered run's cost as an `ActualExecutionEconomics`.
 *
 * The floor is `measured` in the sense that matters here: it is the figure
 * `ECONOMY_MODEL.md`'s re-analysed table pinned from real ledger rows, and
 * `historical-runs.ts` is its single source. Nothing is re-derived, because a
 * second derivation is a second answer.
 */
function actualFor(run: HistoricalRun): ActualExecutionEconomics {
  const model: CostAmount = measured(run.providerCostNanoUsd);
  const infrastructure: CostAmount = measured(run.economicCostFloorNanoUsd - run.providerCostNanoUsd);

  return {
    actualCost: sumCosts([
      ["model", model],
      ["infrastructure", infrastructure],
    ]),
    components: {
      model,
      // The dataset carries one combined non-model figure per run; splitting it
      // into agent and validation halves would invent a division the table does
      // not contain.
      agentSandbox: unknown("not_measured"),
      validation: unknown("not_measured"),
      infrastructure,
    },
    confidence: "medium",
    provenance: null,
    agentSandboxUpperBoundNanoUsd: null,
    validationSandboxUpperBoundNanoUsd: run.economicCostUpperNanoUsd - run.economicCostFloorNanoUsd,
    // The dataset already carries both ends, so the bracket is the pinned pair
    // rather than something re-derived from sandbox dimensions this table does
    // not hold.
    bracketLowNanoUsd: run.economicCostFloorNanoUsd,
    bracketHighNanoUsd: run.economicCostUpperNanoUsd,
  };
}

/** One run, estimated against every other run. */
export function backtestRun(
  run: HistoricalRun,
  dataset: readonly HistoricalRun[] = HISTORICAL_RUNS,
  model: EconomyModelVersion = resolveEconomyModel(BACKTEST_AT),
): LearningRecord {
  const withoutSelf = dataset.filter((entry) => entry.run !== run.run);
  const input = backtestInput(run, withoutSelf, model);
  const prediction = estimateExecutionEconomics(input);

  return {
    run: run.run,
    input,
    prediction,
    actualFloorNanoUsd: run.economicCostFloorNanoUsd,
    actualUpperNanoUsd: run.economicCostUpperNanoUsd,
    comparison: compareEstimateToActual(prediction, actualFor(run)),
    repositoryContextAvailable: false,
  };
}

/**
 * Every run in a dataset, each estimated without itself (leave-one-out).
 *
 * Takes the dataset rather than closing over the transcribed constant, so a
 * caller that has read the completed runs back out of the database measures
 * bias on the same runs it forecasts from. A correction derived from one set
 * and applied to another is a correction for somebody else's runs.
 */
export function learningRecordsFor(dataset: readonly HistoricalRun[]): readonly LearningRecord[] {
  return dataset.map((run) => backtestRun(run, dataset));
}

/** Every delivered run in the transcribed seed. Derived at module load; nothing is stored. */
export const HISTORICAL_LEARNING_RECORDS: readonly LearningRecord[] =
  learningRecordsFor(HISTORICAL_RUNS);

export type LearningSummary = {
  runs: number;
  /** Records the comparison was able to use. */
  comparable: number;
  meanAbsoluteRelativeError: number | null;
  medianRelativeError: number | null;
  worstRelativeError: number | null;
  /** Runs the estimator under-predicted, i.e. that cost more than expected. */
  underPredicted: number;
  overPredicted: number;
  repositoryContextAvailableFor: number;
};

export function learningSummary(
  records: readonly LearningRecord[] = HISTORICAL_LEARNING_RECORDS,
): LearningSummary {
  const errors = records
    .filter((record) => record.comparison.comparable)
    .map((record) => record.comparison.relativeError)
    .filter((error): error is number => error !== null);

  const sorted = [...errors].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return {
    runs: records.length,
    comparable: errors.length,
    meanAbsoluteRelativeError:
      errors.length === 0
        ? null
        : errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    medianRelativeError:
      sorted.length === 0
        ? null
        : sorted.length % 2 === 1
          ? (sorted[middle] ?? null)
          : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
    worstRelativeError:
      errors.length === 0 ? null : errors.reduce((worst, error) => (Math.abs(error) > Math.abs(worst) ? error : worst), 0),
    underPredicted: errors.filter((error) => error > 0).length,
    overPredicted: errors.filter((error) => error < 0).length,
    repositoryContextAvailableFor: records.filter((record) => record.repositoryContextAvailable).length,
  };
}
