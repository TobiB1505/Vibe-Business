import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { SandboxUsage } from "./sandbox-cost";
import {
  HISTORICAL_RUNS,
  type ClassificationConfidence,
  type HistoricalRun,
} from "./historical-runs";
import { deriveActualExecutionEconomics } from "./intelligence/actual-economics";
import { VERCEL_FUNCTIONS_RATES, VERCEL_SANDBOX_RATES } from "./infrastructure-rates";
import { AGENT_WORKFLOW_FIXED_STEPS, workflowEventCount } from "./workflow-invocation-cost";

/**
 * Runs Vibe has actually completed, projected from its own observation rows.
 *
 * ## The defect this closes
 *
 * `historical-runs.ts` is a hand-transcribed constant. Its own docblock says
 * so: *"Read directly from Supabase on 2026-08-20 by this sprint"* — read once,
 * by a person, and typed into the repository. It has no database access and it
 * cannot acquire any, so the estimator behind the Run button has been reasoning
 * from a frozen sample since that morning while the runs themselves kept
 * accumulating.
 *
 * The 2026-08-21 intelligence architecture review named this in the abstract:
 *
 * > Around ninety observation columns per run, thirty-eight event types,
 * > validation results, outcome checks — none of it feeds any future decision
 * > except the unwired economy island.
 *
 * The island is wired now (the pre-run forecast reads it), which makes the
 * frozen dataset the remaining half of the same sentence: the loop is
 * connected at one end and to a constant at the other.
 *
 * ## Why the seed stays
 *
 * The transcribed runs are not scaffolding to be deleted. They are measured,
 * published in `ECONOMY_MODEL.md`, pinned by `run-economics.test.ts`, and they
 * are the reference data the rate card and the stress tests are built on —
 * none of which may move when a customer runs an agent. So this **adds** to
 * them rather than replacing them, and the seed keeps its separate job.
 *
 * That makes double counting the first thing to get right: the seed rows *are*
 * this account's runs #3–#9, so reading the database naively would count them
 * twice and report a sample twice its real size.
 *
 * They are matched on `createdAt` **truncated to the second**, and the missing
 * millisecond is not laziness. Read against production, two of the seven
 * transcribed timestamps are one millisecond off the rows they describe —
 * `…17:16:38.566Z` against `…565Z`, `…18:45:03.611Z` against `…610Z` — because
 * a person copied them. Exact matching would have silently double-counted
 * those two and reported a larger sample than exists, which is the failure
 * this deduplication is for. A second is safe as a key because an agent run
 * takes minutes and an account starts them serially.
 *
 * ## What a missing component does
 *
 * Not a zero. `deriveActualExecutionEconomics` already treats an absent
 * component as absent — the total becomes a floor and the confidence drops —
 * and that is the behaviour relied on here rather than worked around. A run
 * whose validation never happened contributes what it did cost, labelled as a
 * floor, instead of contributing a number nobody measured (rule 44).
 *
 * ## Pure
 *
 * No database access, in keeping with the rest of `economy/`. The caller reads
 * the rows; this decides what they mean.
 */

/** One completed run, as its own observation rows describe it. */
export type MeasuredRunObservation = {
  /** The run's own id. Ordering only — never rendered, never a classification input. */
  id: string;
  createdAt: string;
  title: string;
  riskClass: ExecutionRiskClass;
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
  /** Exact integer nanodollars from `ai_usage_events`. Null when nothing was billed. */
  providerCostNanoUsd: number | null;
  agentSandbox: SandboxUsage | null;
  validationSandbox: SandboxUsage | null;
  /** False when the change was never validated — an absence, not a zero. */
  validationAttempted: boolean;
  /**
   * How long the run took, or null when it was not recorded.
   *
   * The duration rather than a step count, so the arithmetic that turns one
   * into the other stays inside `economy/` with the rest of the cost model. A
   * reader that computed steps itself would be a second opinion about what a
   * Workflow invocation is.
   */
  durationMs: number | null;
};

/**
 * A run with no model spend recorded contributes nothing and is dropped.
 *
 * Every other component can be absent and still leave a usable floor, because
 * the sandbox halves are rate-derived and their absence is recorded as such.
 * Model spend is different: it is the dominant component and the only measured
 * one, so a run without it is not a cheap run — it is a run whose cost is
 * unknown, and averaging it in would drag the expectation toward zero.
 */
export function hasMeasuredModelSpend(observation: MeasuredRunObservation): boolean {
  return observation.providerCostNanoUsd !== null && observation.providerCostNanoUsd > 0;
}

/**
 * How confident the classification behind a projected run is.
 *
 * Always `confirmed`, and that is not optimism. The seed distinguishes
 * `confirmed` from `limited` because some of its rows were reconstructed from
 * documents after the fact; these are read from `execution_specs`, which is the
 * immutable document the run was actually executed against.
 */
const PROJECTED_CLASSIFICATION_CONFIDENCE: ClassificationConfidence = "confirmed";

function projectRun(observation: MeasuredRunObservation, index: number): HistoricalRun | null {
  const providerCostNanoUsd = observation.providerCostNanoUsd;
  // Narrowed here rather than asserted at the bottom: `isUsable` is the rule
  // and this is the same rule written so the compiler can see it.
  if (providerCostNanoUsd === null || providerCostNanoUsd <= 0) return null;

  const economics = deriveActualExecutionEconomics({
    providerCostNanoUsd,
    agentSandbox: observation.agentSandbox,
    validationSandbox: observation.validationSandbox,
    validationAttempted: observation.validationAttempted,
    workflowSteps:
      observation.durationMs === null
        ? null
        : AGENT_WORKFLOW_FIXED_STEPS + workflowEventCount(observation.durationMs),
    rates: VERCEL_SANDBOX_RATES,
    functionsRates: VERCEL_FUNCTIONS_RATES,
    usageSource: "ai_usage_events",
  });

  const floor = economics.actualCost.knownFloorNanoUsd;

  return {
    // Numbered above the seed rather than renumbered into it. The seed's own
    // numbers are cited in `ECONOMY_MODEL.md` and in sprint records, and a
    // projection that renumbered them would make those citations point at
    // different runs on a different day.
    run: SEED_RUN_NUMBER_CEILING + index + 1,
    title: observation.title,
    createdAt: observation.createdAt,
    riskClass: observation.riskClass,
    changeKind: observation.changeKind,
    evidenceIds: observation.evidenceIds,
    classificationConfidence: PROJECTED_CLASSIFICATION_CONFIDENCE,
    confidenceNote:
      "Classification read from the execution spec this run was executed against, not reconstructed.",
    economicCostFloorNanoUsd: floor,
    // The upper bound is the floor plus whatever the sandboxes would have cost
    // at full CPU. Absent bounds fall back to the floor, which is what "we
    // could not tell how much more this might have been" means here.
    economicCostUpperNanoUsd:
      floor +
      (economics.agentSandboxUpperBoundNanoUsd === null
        ? 0
        : Math.max(0, economics.agentSandboxUpperBoundNanoUsd - agentFloor(economics))) +
      (economics.validationSandboxUpperBoundNanoUsd === null
        ? 0
        : Math.max(0, economics.validationSandboxUpperBoundNanoUsd - validationFloor(economics))),
    providerCostNanoUsd,
    // True: a component was rate-derived rather than provider-reported, which
    // is what this flag has always meant. Sprint 0051's point-estimate fix
    // applies forward, and every projected run is forward of it.
    costIsPointEstimate: economics.confidence !== "high",
  };
}

function agentFloor(economics: ReturnType<typeof deriveActualExecutionEconomics>): number {
  const amount = economics.components.agentSandbox;
  return amount.known ? amount.nanoUsd : 0;
}

function validationFloor(economics: ReturnType<typeof deriveActualExecutionEconomics>): number {
  const amount = economics.components.validation;
  return amount.known ? amount.nanoUsd : 0;
}

/**
 * An instant to the second, as the deduplication key.
 *
 * Invalid input returns the original string, which cannot match a parsed one —
 * so an unreadable timestamp fails towards *keeping* the run rather than
 * silently dropping it against a key nobody can see.
 */
function toSecond(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(Math.floor(parsed / 1000) * 1000).toISOString();
}

/** The highest run number the transcribed seed uses. */
const SEED_RUN_NUMBER_CEILING = HISTORICAL_RUNS.reduce(
  (highest, run) => Math.max(highest, run.run),
  0,
);

/**
 * The seed plus every completed run it does not already describe.
 *
 * Order is seed first, then observations oldest to newest, because the
 * estimator's similarity weighting is stable under order and its reports read
 * better chronologically. Deduplication is by `createdAt` and nothing else:
 * the seed carries the exact millisecond it was copied from, and two distinct
 * runs cannot share one.
 */
export function measuredRunDataset(
  observations: readonly MeasuredRunObservation[],
  seed: readonly HistoricalRun[] = HISTORICAL_RUNS,
): readonly HistoricalRun[] {
  /*
   * One key set, filled as it goes, so an observation is measured against the
   * seed *and* against every observation before it.
   *
   * Checking only against the seed was the first version and it counted one
   * run twice when two rows described it — caught by the forecast's own "counts
   * one run once" test rather than by reading. The store returns one row per
   * run today, but a public function that takes an array cannot rest on its
   * caller being careful: the number this feeds sits under a button that
   * spends money.
   */
  const seen = new Set(seed.map((run) => toSecond(run.createdAt)));
  const projected: HistoricalRun[] = [];

  for (const observation of observations) {
    const key = toSecond(observation.createdAt);
    if (seen.has(key)) continue;

    const run = projectRun(observation, projected.length);
    // Claimed only once the run is usable, so a dropped run does not shadow a
    // later, usable row describing the same instant.
    if (run === null) continue;

    seen.add(key);
    projected.push(run);
  }

  return [...seed, ...projected];
}
