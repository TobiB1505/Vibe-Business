import type { CostAmount, UnknownCostReason } from "./cost";
import type { RunEconomics } from "./run-economics";

/**
 * Where a run's money went, and what made it go there (Sprint 0053).
 *
 * ## The question this exists to answer
 *
 * Production run `5ea8a9a0` re-ran the same Action Step as run #6, at the same
 * pricing class, and cost 2.16× as much — $0.1444 → $0.3115 of model spend.
 * Nothing about the task changed. The repository had grown three files the step
 * genuinely needed, and the agent correctly read them.
 *
 * Pricing has to survive that. A Credit whose cost is a function of repository
 * state, and nobody measured the repository state, is a Credit that gets
 * repriced by surprise. So this module splits the *measured* spend across the
 * components that are actually metered, and carries repository size alongside
 * it as the driver.
 *
 * ## Why repository size is a correlate and never a fourth share
 *
 * The tempting output is "50% Repository Context, 30% Model, 10% Validation,
 * 10% Infrastructure". It is a category error, and an expensive one.
 *
 * Repository size is **not a billed component**. Nobody invoices Vibe for tree
 * entries. Its entire cost effect is already inside the model share: a larger
 * repository produces a longer brief and more file reads, which is spend the
 * provider already charged for and which `providerCost` already contains.
 * Giving it a slice of the same pie counts that money twice, and the resulting
 * "model = 30%" would under-state the one component that dominates every run in
 * Vibe's history.
 *
 * The honest statement, once n is large enough, is a regression of model spend
 * against repository size — "each additional 100 routes costs about $X" — and
 * that requires the two to be *separate* quantities on the same row. Which is
 * exactly the shape below, and exactly what a fake fourth slice would destroy.
 *
 * ## Read-only, and no rate of its own
 *
 * Derives from a `RunEconomics` a caller already built. Writes nothing, prices
 * nothing, and is not wired to billing, credits, quoting or settlement.
 * `CREDIT_RATE_CARDS` stays empty.
 */

/**
 * How large the repository was at the commit a run worked against.
 *
 * Mirrors the `repo_*` and `context_candidates_available` columns on
 * `agent_execution_runs`. Every field nullable for the same reason they are:
 * a run without a fresh snapshot has no size *at its own commit*, and null says
 * "not measured" where a zero would claim an empty repository.
 */
export type RepositoryContextSize = {
  treeEntries: number | null;
  filesAnalyzed: number | null;
  bytesAnalyzed: number | null;
  routesDetected: number | null;
  surfacesDetected: number | null;
  /**
   * Candidates the Context Compiler had before `BRIEF_BUDGET.maxCandidates`
   * cut the list.
   *
   * The reason this field exists at all: `candidatesSent` saturates at the cap,
   * and run #9 sent exactly 12 of 12. Without the available count, "the brief
   * was clipped" is indistinguishable from "the repository offered twelve".
   */
  candidatesAvailable: number | null;
  candidatesSent: number | null;
};

export const COST_DRIVER_COMPONENTS = ["model", "validation", "infrastructure"] as const;
export type CostDriverComponent = (typeof COST_DRIVER_COMPONENTS)[number];

/** A component that could not enter the split, and why. */
export type UnattributedComponent = {
  component: CostDriverComponent;
  reason: UnknownCostReason;
};

export type CostDriverAttribution = {
  /** Nanodollars per component. Null where the component is not known. */
  modelNanoUsd: number | null;
  validationNanoUsd: number | null;
  infrastructureNanoUsd: number | null;
  /** The sum of the components that were known. Never a partial passed as a total. */
  attributedNanoUsd: number;
  /**
   * Fractions of `attributedNanoUsd`, one per known component.
   *
   * Deliberately a partial map rather than a record with zeros: a component
   * that could not be priced is absent, and a reader iterating this cannot
   * mistake "unpriced" for "cost nothing". `unattributed` names each absence.
   */
  shares: Partial<Record<CostDriverComponent, number>>;
  /**
   * Components left out of the denominator, with their reason.
   *
   * This is the field that keeps the shares honest. Every sandbox second in
   * Vibe's history is unpriced, so a naive split would read "model = 100%" and
   * be quoted as evidence that infrastructure is free. Non-empty means the
   * shares are shares of an incomplete total, and must be reported as such.
   */
  unattributed: readonly UnattributedComponent[];
  /**
   * Repository size at the pinned commit, when the run recorded it.
   *
   * A correlate of the model share, never a share of its own — see the module
   * comment. Null when the run recorded no size, which is not zero.
   */
  repositoryContext: RepositoryContextSize | null;
};

function amount(cost: CostAmount): number | null {
  return cost.known ? cost.nanoUsd : null;
}

/**
 * Splits one run's measured spend, and attaches what drove it.
 *
 * Pure. Takes economics a caller already derived rather than re-deriving them,
 * so there is exactly one place in this codebase that turns sandbox
 * milliseconds into money.
 */
export function deriveCostDrivers(input: {
  economics: RunEconomics;
  repositoryContext?: RepositoryContextSize | null;
}): CostDriverAttribution {
  const pairs: readonly (readonly [CostDriverComponent, CostAmount])[] = [
    ["model", input.economics.providerCost],
    ["validation", input.economics.validationCostEstimate],
    ["infrastructure", input.economics.infrastructureCostEstimate],
  ];

  const unattributed: UnattributedComponent[] = [];
  let attributedNanoUsd = 0;

  for (const [component, cost] of pairs) {
    if (cost.known) attributedNanoUsd += cost.nanoUsd;
    else unattributed.push({ component, reason: cost.reason });
  }

  const shares: Partial<Record<CostDriverComponent, number>> = {};
  if (attributedNanoUsd > 0) {
    for (const [component, cost] of pairs) {
      if (cost.known) shares[component] = cost.nanoUsd / attributedNanoUsd;
    }
  }

  return {
    modelNanoUsd: amount(input.economics.providerCost),
    validationNanoUsd: amount(input.economics.validationCostEstimate),
    infrastructureNanoUsd: amount(input.economics.infrastructureCostEstimate),
    attributedNanoUsd,
    shares,
    unattributed,
    repositoryContext: input.repositoryContext ?? null,
  };
}

/**
 * Whether two runs of the same step are comparable on repository size.
 *
 * The narrow question run #9 raised: the same step cost 2.16× more, and the
 * candidate count went 6 → 12 against a cap of 12. Answering "was the brief
 * clipped?" needs `candidatesAvailable`, and a run recorded before Sprint 0053
 * does not have it. Saying so is the point — an unanswerable comparison must
 * not silently return `false`, which would read as "the brief was not clipped".
 */
export function briefWasClipped(size: RepositoryContextSize | null): boolean | null {
  if (!size || size.candidatesAvailable === null || size.candidatesSent === null) return null;
  return size.candidatesAvailable > size.candidatesSent;
}
