import { AGENTIC_EXECUTION_CONFIG } from "@/modules/ai/operations";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { RepositoryContextSize } from "@/modules/economy/cost-drivers";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import { resolveStepPricingClass } from "@/modules/execution-contract/pricing-class";
import { learningRecordsFor } from "@/modules/economy/intelligence/learning-dataset";
import { measuredRunDataset, type MeasuredRunObservation } from "@/modules/economy/measured-runs";
import { resolveEconomyModel } from "@/modules/economy/intelligence/model-version";
import {
  estimateExecutionEconomics,
  type CostDriverEffect,
  type EstimateCostDriver,
} from "@/modules/economy/intelligence/pre-execution-estimate";
import { correctionForCohort, detectCohortBias } from "@/modules/economy/intelligence/prediction-bias";
import { anthropicRates } from "@/modules/economy/intelligence/provider-rates";
import type { ConfidenceLevel } from "@/modules/economy/intelligence/confidence";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";

/**
 * What stands behind the ceiling on the Run button (ADR 0072).
 *
 * ## The number this does not produce
 *
 * A predicted price. `economy/intelligence/quote-simulation.ts` had already
 * written down why, and this file obeys it rather than re-deciding it:
 *
 * > `credits = cost * factor` would make a quote for the same work move every
 * > time the repository grew — which is exactly what run #6 → #9 did, at 2.16x,
 * > for an identical step.
 *
 * The Credit figure a founder sees stays the **execution class ceiling**, which
 * is what actually bounds their spend and does not drift with the tree. The
 * estimator's job is the other one: to say how much evidence stands behind that
 * ceiling, and what about *this* run pushes toward the top of it.
 *
 * ## Why not the estimated cost, once, as a second number
 *
 * Because the estimator's own backtest says it is not good enough to quote.
 * Leave-one-out over the runs Vibe has paid for gives a **24.3% mean absolute
 * error across 7 comparable runs**, worst case +51%, and
 * `repositoryContextAvailableFor` is **0** — the repository term, one of its
 * main drivers, has never been validated against a real outcome. A dollar
 * figure on a founder's screen with that behind it would be a precision claim
 * Vibe cannot make, and [rule 78](../../../CLAUDE.md) exists for exactly this.
 *
 * So the estimate is consumed for its *structure* — sample size, confidence,
 * named drivers — and never for its magnitude. Nothing here returns money.
 *
 * ## What this changes for the estimator itself
 *
 * The pre-run screen is the first caller that can give it a repository. The
 * backtest had none for any run, and the brief's own `repositoryScale` is not
 * computed until a run starts — so the same snapshot the run will be pinned to
 * is projected here through the compiler's own derivation, never a second one.
 * `candidatesAvailable` stays 0 because the Context Compiler has not run;
 * `deriveRepositoryComplexity` excludes a non-positive axis from its average
 * rather than reading it as zero, so that is an absent measurement and not a
 * small one.
 *
 * ## Free, and still offline
 *
 * Pure over the dataset it is handed plus the snapshot the page already holds.
 * No provider call, no network, no database read *of its own*, no clock beyond
 * the one passed in. Rendering the Agent screen must spend nothing, and that
 * stays true — the caller does the reading, once, and this decides what it
 * means.
 *
 * ## Where the dataset comes from, and why that is the point
 *
 * `dataset` was a default parameter over `HISTORICAL_RUNS` and nothing ever
 * passed anything else. That constant was read out of Supabase by a person on
 * 2026-08-20 and typed into the repository, so every "comparable runs" sentence
 * a founder has read since was counted against that morning — while the runs
 * kept accumulating in a table nothing read back. The 2026-08-21 intelligence
 * review called this the missing learning loop; the loop was connected at this
 * end and to a constant at the other.
 */

export type RunForecastInput = {
  /** Injected, so the same inputs forecast the same way on any day. */
  at: Date;
  /**
   * The step the Run button would start.
   *
   * The whole step rather than a pre-computed class, so this classifies through
   * `resolveStepPricingClass` — the same function that selects the Credit
   * ceiling being displayed. A forecast about a different class than the price
   * it sits under would be worse than none.
   */
  step: Pick<ActionPlanStep, "changeKind" | "evidenceIds">;
  riskClass: ExecutionRiskClass;
  /** The snapshot this run would be pinned to. Null when none resolved. */
  snapshot: RepositoryIntelligenceSnapshot | null;
  /**
   * Completed runs the caller read back, as raw observations.
   *
   * Required rather than defaulted, and observations rather than a finished
   * dataset. The default is what let the estimator go on answering from a
   * frozen sample for a fortnight without anybody having to decide that it
   * should — nothing failed, nothing looked wrong, and the number on the
   * screen simply stopped moving. A caller with nothing to add passes `[]`.
   *
   * Raw observations, because assembling them carries cost figures and this
   * file is the one sanctioned to hold those (`sprint-0054-safety.test.ts`). A
   * caller that assembled the dataset itself would be a page holding
   * nanodollars, which is the shape that suite exists to prevent.
   */
  observations: readonly MeasuredRunObservation[];
};

/**
 * One reason this run may sit high or low in its class.
 *
 * Deliberately **not** `EstimateCostDriver`. That type carries a `detail`
 * string the estimator writes for its own calibration reports — "complexity
 * 1.34x against the reference repository" — and re-exporting it would put the
 * estimator's own figures one `.detail` away from a screen. What crosses this
 * boundary is two closed enums and nothing else, so there is no number to
 * render by accident and none to be tempted into rendering on purpose.
 */
export type RunForecastDriver = {
  driver: EstimateCostDriver["driver"];
  effect: CostDriverEffect;
};

/**
 * What Vibe knows about a run before it starts, with every amount removed.
 *
 * Four fields, none of which is money, and `sprint-0054-safety.test.ts` reads
 * this file's source to keep it that way. The estimator's cost, its upper
 * bound, its multipliers and its provider rates all stop here.
 */
export type RunForecast = {
  /** Comparable runs behind the historical component. Zero is a real answer. */
  comparableRuns: number;
  /** The weakest of the estimator's three axes. Never an average. */
  confidence: ConfidenceLevel;
  /** Whether the repository behind this run was measured at all. */
  repositoryMeasured: boolean;
  /**
   * The reasons worth naming, in the estimator's own fixed order. Neutral
   * drivers are dropped — one that changes nothing is not worth a founder's
   * attention above a button that spends money.
   */
  drivers: readonly RunForecastDriver[];
};

/**
 * The compiler's own projection of a snapshot's size, so the pre-run forecast
 * and the run's brief cannot disagree about the tree.
 *
 * Deliberately not a second derivation. Two functions computing "how big is
 * this repository" from the same snapshot is how the estimate a founder was
 * shown stops describing the run they started.
 */
export function forecastRepositoryContext(
  snapshot: RepositoryIntelligenceSnapshot | null,
): RepositoryContextSize | null {
  if (!snapshot) return null;

  return {
    treeEntries: snapshot.metrics.treeEntriesConsidered,
    filesAnalyzed: snapshot.metrics.filesFetched,
    bytesAnalyzed: snapshot.metrics.bytesFetched,
    routesDetected: snapshot.routes.routes.length,
    surfacesDetected: snapshot.businessSurfaces.length,
    // The Context Compiler has not run, so neither figure exists yet. Zero
    // rather than a guess: `ratioTerm` drops a non-positive axis, so this is
    // excluded from the complexity average instead of read as "no candidates".
    candidatesAvailable: 0,
    candidatesSent: null,
  };
}

/**
 * What Vibe knows about this run's cost before it starts.
 *
 * Null for a step that changes nothing — there is no execution to forecast, and
 * an empty forecast rendered beside a button is worse than no forecast.
 */
export function forecastRun(input: RunForecastInput): RunForecast | null {
  const classification = resolveStepPricingClass({ step: input.step, riskClass: input.riskClass });
  if (classification.pricingClass === null) return null;

  const surfaceRequirement = deriveExecutionSurfaceRequirement({
    changeKind: input.step.changeKind,
    evidenceIds: input.step.evidenceIds,
  });

  const economyModel = resolveEconomyModel(input.at);
  // The published seed plus the caller's completed runs, deduplicated. Built
  // here so no amount crosses back out to whoever did the reading.
  const dataset = measuredRunDataset(input.observations);

  const estimate = estimateExecutionEconomics({
    at: input.at,
    pricingClass: classification.pricingClass,
    pricingClassReason: classification.reason,
    riskClass: input.riskClass,
    changeKind: input.step.changeKind,
    evidenceIds: input.step.evidenceIds,
    surfaces: surfaceRequirement.surfaces,
    repositoryContext: forecastRepositoryContext(input.snapshot),
    // Resolved only once a Prepared Change exists. Null, never a guess — the
    // estimator records `validation_depth_unknown` and says so in its reasons.
    expectedValidationDepth: null,
    modelRates: anthropicRates(AGENTIC_EXECUTION_CONFIG.model, input.at),
    economyModel,
    // Exactly 1 for every cohort today, and computed rather than hard-coded so
    // the first cohort that earns a correction gets it here without a change.
    historicalRuns: dataset,
    // Derived from the same dataset, so a correction and the sample it was
    // measured on can never describe different sets of runs.
    cohortCorrection: correctionForCohort(
      detectCohortBias(learningRecordsFor(dataset), economyModel.adjustmentPolicy),
      {
        pricingClass: classification.pricingClass,
        changeKind: input.step.changeKind,
        riskClass: input.riskClass,
      },
    ),
  });

  return {
    comparableRuns: estimate.confidence.sampleSize,
    confidence: estimate.confidence.overall,
    repositoryMeasured: estimate.repositorySignal.measured,
    drivers: estimate.costDrivers
      .filter((costDriver) => costDriver.effect !== "neutral")
      // Projected field by field rather than spread, so a field the estimator
      // grows later cannot arrive here without somebody deciding it should.
      .map((costDriver) => ({ driver: costDriver.driver, effect: costDriver.effect })),
  };
}
