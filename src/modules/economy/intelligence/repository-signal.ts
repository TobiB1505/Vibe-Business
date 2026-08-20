import type { RepositoryContextSize } from "../cost-drivers";
import { type ContextPressure, deriveContextPressure } from "./context-pressure";
import type { RepositoryComplexityPolicy } from "./model-version";

/**
 * How large the technical space is (Sprint 0054, PART E).
 *
 * ## Why this returns a multiplier and not an amount
 *
 * The tempting design is a cost line: model cost, sandbox cost, *repository
 * cost*. It is a category error and an expensive one — nobody invoices Vibe for
 * tree entries. `cost-drivers.ts` already refuses to give repository size a
 * slice of measured spend for that reason; this is the same refusal on the
 * predictive side.
 *
 * The real chain is:
 *
 *     larger repository -> more relevant context -> more agent work -> more spend
 *
 * Every step of that is a *probability*, not an invoice. So this file produces a
 * dimensionless, bounded multiplier and has no `nanoUsd` anywhere in it. A
 * `RepositoryComplexitySignal` cannot be rendered as money by accident, because
 * it does not contain money.
 *
 * ## Why the multiplier is bounded
 *
 * A signal may nudge an estimate; it may not dominate one. Vibe has executed
 * against exactly one repository, so the true relationship between size and
 * spend is unmeasured — the honest form of an unmeasured relationship is a
 * gentle, clamped correction, not a confident curve. The bounds live in the
 * economy model version, so widening them later is a version bump rather than
 * an edit.
 *
 * ## Complexity is not volatility
 *
 * This file answers "how big is this thing?" — a snapshot at one commit.
 * `repository-drift.ts` answers "how much does it move between runs?", which is
 * a different question with a different answer, and run #6 -> #9 was the second
 * one. Fusing them into a single repository score would have made that run
 * unexplainable.
 */

export const REPOSITORY_COMPLEXITY_REASONS = [
  "not_measured",
  "tree_size",
  "route_count",
  "candidate_supply",
  "context_pressure",
  "at_reference_scale",
] as const;
export type RepositoryComplexityReason = (typeof REPOSITORY_COMPLEXITY_REASONS)[number];

export type RepositoryComplexitySignal = {
  /** False when nothing about the repository was recorded. Not the same as "small". */
  measured: boolean;
  /**
   * Dimensionless. 1 is the reference repository; 2 is roughly twice as much
   * technical space to reason about. Null when unmeasured.
   */
  complexityIndex: number | null;
  /** Clamped to the policy bounds. Null when unmeasured — never 1, which would claim a measurement. */
  multiplier: number | null;
  pressure: ContextPressure;
  reasons: readonly RepositoryComplexityReason[];
};

/**
 * Log-scaled so an order of magnitude matters and a rounding does not.
 *
 * The alternative — a linear ratio — makes a 100,000-entry tree twenty times a
 * 5,000-entry one, and there is no evidence a repository twenty times larger
 * costs twenty times more to change one file in. Logs keep the signal
 * directional without pretending to a precision nobody has measured.
 */
function ratioTerm(observed: number | null, reference: number): number | null {
  if (observed === null || observed <= 0 || reference <= 0) return null;
  return Math.log2(observed / reference);
}

export function deriveRepositoryComplexity(
  size: RepositoryContextSize | null,
  policy: RepositoryComplexityPolicy,
): RepositoryComplexitySignal {
  const pressure = deriveContextPressure(size);

  const terms: readonly (readonly [RepositoryComplexityReason, number | null])[] = [
    ["tree_size", ratioTerm(size?.treeEntries ?? null, policy.referenceTreeEntries)],
    ["route_count", ratioTerm(size?.routesDetected ?? null, policy.referenceRoutes)],
    ["candidate_supply", ratioTerm(size?.candidatesAvailable ?? null, policy.referenceCandidates)],
  ];

  const present = terms.filter((term): term is readonly [RepositoryComplexityReason, number] => term[1] !== null);

  if (present.length === 0) {
    return { measured: false, complexityIndex: null, multiplier: null, pressure, reasons: ["not_measured"] };
  }

  // Mean of the axes that were measured, so a repository with routes but no
  // tree count is still assessable on what it does have. An absent axis is
  // excluded from the average rather than counted as being at reference scale.
  const meanTerm = present.reduce((sum, [, value]) => sum + value, 0) / present.length;

  const reasons: RepositoryComplexityReason[] = present.map(([reason]) => reason);
  if (pressure.signal === "moderate" || pressure.signal === "severe") reasons.push("context_pressure");
  if (reasons.length === present.length && Math.abs(meanTerm) < 0.05) reasons.push("at_reference_scale");

  // Pressure is added to the size term rather than multiplied into it: a
  // repository that is merely large and a repository whose relevant context did
  // not fit are different problems, and the second is the one that costs money.
  const pressureTerm = pressure.candidatePressure === null ? 0 : Math.log2(Math.max(1, pressure.candidatePressure));

  const raw = 1 + policy.sensitivity * (meanTerm + pressureTerm);
  const multiplier = Math.min(policy.maxMultiplier, Math.max(policy.minMultiplier, raw));

  return {
    measured: true,
    complexityIndex: Math.pow(2, meanTerm),
    multiplier,
    pressure,
    reasons,
  };
}
