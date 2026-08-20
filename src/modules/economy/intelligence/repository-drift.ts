import type { RepositoryContextSize } from "../cost-drivers";

/**
 * How much the repository moved between two executions (Sprint 0054, PART E').
 *
 * ## The run this exists because of
 *
 * Run #6 and run #9 executed the same Action Step — byte-identical `step_key`,
 * same risk class, same change kind, same pricing class. Run #6 cost $0.1444 of
 * model spend. Run #9 cost $0.3115, 2.16x as much, for the same quote.
 *
 * Nothing about the task changed. The repository had grown three files the step
 * genuinely needed, the compiler's candidate list went 6 -> 12 against a cap of
 * 12, and the agent correctly read what was there. Complexity did not explain
 * it, because at any single commit the repository looked ordinary. What
 * explained it was the *delta*.
 *
 * ## Why this is a signal and not a price factor
 *
 * Same reason as `repository-signal.ts`: there is no `nanoUsd` in this file. A
 * customer whose product is growing should be *understood* differently from one
 * on day one; charging them differently is a pricing decision nobody has made,
 * and this layer does not get to make it by returning an amount.
 *
 * ## Why an unmeasured axis is never "stable"
 *
 * `stable` is a claim: the repository did not move. Two nulls support no such
 * claim — they say nobody looked. Returning `stable` there would turn the
 * absence of measurement into evidence of absence, and would make run #6 -> #9
 * read as an unexplained cost spike in a repository that "did not change".
 * So an axis with either side missing is excluded from `measurable`, and a
 * drift with nothing measurable is `unknown`.
 */

export const DRIFT_LEVELS = ["unknown", "stable", "changed", "high_change"] as const;
export type DriftLevel = (typeof DRIFT_LEVELS)[number];

export const DRIFT_AXES = ["files", "bytes", "candidates", "routes"] as const;
export type DriftAxis = (typeof DRIFT_AXES)[number];

/** Fractional movement above which a repository counts as changed / heavily changed. */
const CHANGED_FRACTION = 0.05;
const HIGH_CHANGE_FRACTION = 0.25;

export type RepositoryDriftSignal = {
  changedFilesSinceLastExecution: number | null;
  changedBytesSinceLastExecution: number | null;
  /**
   * Movement in what the Context Compiler found *relevant*, not in the tree at
   * large. The run #6 -> #9 axis, and the one that correlates with spend.
   */
  newRelevantCandidates: number | null;
  changedRoutes: number | null;
  driftLevel: DriftLevel;
  /** The axes that had a value on both sides. An empty list means `unknown`. */
  measurable: readonly DriftAxis[];
  /** The largest fractional movement across the measurable axes. Null when none were. */
  largestRelativeChange: number | null;
};

function delta(previous: number | null | undefined, current: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  if (current === null || current === undefined) return null;
  return current - previous;
}

function relativeChange(previous: number | null | undefined, change: number | null): number | null {
  if (change === null) return null;
  if (previous === null || previous === undefined || previous === 0) {
    // Growth from nothing is real movement, but it has no meaningful ratio.
    // Treating it as infinite would let one axis dominate; treating it as zero
    // would erase it. It counts as high change and stops there.
    return change === 0 ? 0 : HIGH_CHANGE_FRACTION;
  }
  return Math.abs(change) / previous;
}

export function deriveRepositoryDrift(
  previous: RepositoryContextSize | null,
  current: RepositoryContextSize | null,
): RepositoryDriftSignal {
  const changedFiles = delta(previous?.filesAnalyzed, current?.filesAnalyzed);
  const changedBytes = delta(previous?.bytesAnalyzed, current?.bytesAnalyzed);
  const newCandidates = delta(previous?.candidatesAvailable, current?.candidatesAvailable);
  const changedRoutes = delta(previous?.routesDetected, current?.routesDetected);

  const axes: readonly (readonly [DriftAxis, number | null, number | null | undefined])[] = [
    ["files", changedFiles, previous?.filesAnalyzed],
    ["bytes", changedBytes, previous?.bytesAnalyzed],
    ["candidates", newCandidates, previous?.candidatesAvailable],
    ["routes", changedRoutes, previous?.routesDetected],
  ];

  const measurable: DriftAxis[] = [];
  let largestRelativeChange: number | null = null;

  for (const [axis, change, base] of axes) {
    if (change === null) continue;
    measurable.push(axis);

    const relative = relativeChange(base, change);
    if (relative === null) continue;
    largestRelativeChange = largestRelativeChange === null ? relative : Math.max(largestRelativeChange, relative);
  }

  return {
    changedFilesSinceLastExecution: changedFiles,
    changedBytesSinceLastExecution: changedBytes,
    newRelevantCandidates: newCandidates,
    changedRoutes,
    driftLevel: driftLevel(measurable, largestRelativeChange),
    measurable,
    largestRelativeChange,
  };
}

function driftLevel(measurable: readonly DriftAxis[], largest: number | null): DriftLevel {
  if (measurable.length === 0 || largest === null) return "unknown";
  if (largest >= HIGH_CHANGE_FRACTION) return "high_change";
  return largest >= CHANGED_FRACTION ? "changed" : "stable";
}

/** No previous execution to compare against. Distinct from "compared and found unchanged". */
export const NO_PRIOR_EXECUTION: RepositoryDriftSignal = {
  changedFilesSinceLastExecution: null,
  changedBytesSinceLastExecution: null,
  newRelevantCandidates: null,
  changedRoutes: null,
  driftLevel: "unknown",
  measurable: [],
  largestRelativeChange: null,
};
