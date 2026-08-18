/**
 * The freshness contract (EXECUTION CORE-3 §29, §52).
 *
 * ## The principle this reuses
 *
 * Vibe already draws a hard line between advice and action:
 *
 * > Advice may rely on stored evidence. **Execution must revalidate the
 * > concrete premise against live state immediately before any consequential
 * > write.** (Rule 55, ADR 0014)
 *
 * `execution/preflight.ts` implements that for the one deterministic capability
 * by re-reading GitHub's HEAD, the live tree and the production origin. This
 * file generalises the *contract*: a spec names which premises must be true at
 * the moment work starts, so a future runtime cannot forget one and nothing has
 * to re-derive the list from a comment.
 *
 * ## What it deliberately does not do
 *
 * It does not re-run a Business Audit. §29 is explicit: revalidate the concrete
 * execution premise, not the whole reasoning chain. Re-auditing to change a
 * file would be a paid operation triggered on the user's behalf, which Rule 60
 * forbids outright.
 */

/**
 * The premises a spec can require to be re-checked before work begins.
 *
 * A closed set, because each has to map to something Vibe can actually observe.
 * `deterministic_capability_still_matches` is separate from
 * `repository_snapshot_current` on purpose: a snapshot can be the newest one
 * and still no longer satisfy the capability's own conditions — which is
 * precisely the Sprint 8 failure `execution/preflight.ts` was written for.
 */
export const FRESHNESS_CHECKS = [
  /** GitHub's default-branch HEAD still equals the spec's pinned base SHA (§16). */
  "repository_head_unchanged",
  /** The snapshot the spec named is still the newest successful one. */
  "repository_snapshot_current",
  /** The plan the step came from is still the project's current plan. */
  "action_plan_current",
  /** Every prerequisite step is still finished (§27). */
  "dependencies_still_satisfied",
  /** The registry capability still matches current evidence. */
  "deterministic_capability_still_matches",
  /** The project is still owned by the account the spec was created for. */
  "project_ownership_unchanged",
] as const;
export type FreshnessCheck = (typeof FRESHNESS_CHECKS)[number];

/** The checks any agentic spec must pass. */
export const AGENTIC_FRESHNESS_CHECKS: readonly FreshnessCheck[] = [
  "repository_head_unchanged",
  "repository_snapshot_current",
  "action_plan_current",
  "dependencies_still_satisfied",
  "project_ownership_unchanged",
] as const;

/** Deterministic execution additionally re-checks that its executor still applies. */
export const DETERMINISTIC_FRESHNESS_CHECKS: readonly FreshnessCheck[] = [
  ...AGENTIC_FRESHNESS_CHECKS,
  "deterministic_capability_still_matches",
] as const;

/**
 * What was actually observed, at the moment of asking.
 *
 * Every field is `boolean | null`, and `null` means *not observed* rather than
 * *fine*. That distinction is the whole safety property: an unread HEAD must
 * never be treated as an unchanged HEAD, and a nullable boolean forces the
 * caller to say which it is. `evaluateFreshness` treats null as stale.
 */
export type FreshnessObservation = {
  /** The live default-branch HEAD, or null when it could not be read. */
  observedHeadSha: string | null;
  latestRepositorySnapshotId: string | null;
  actionPlanIsCurrent: boolean | null;
  dependenciesSatisfied: boolean | null;
  capabilityStillMatches: boolean | null;
  projectOwnerUnchanged: boolean | null;
};

export type FreshnessResult =
  | { fresh: true }
  | { fresh: false; stale: readonly FreshnessCheck[] };

/**
 * Whether every required premise still holds (§29, §52).
 *
 * A spec pinned to base SHA A against a repository now at B returns
 * `{ fresh: false, stale: ["repository_head_unchanged"] }` — never a silent
 * execution against B (§52). The caller's job is to re-resolve, producing a new
 * spec with a new identity, which is what §10 requires.
 */
export function evaluateFreshness(
  required: readonly FreshnessCheck[],
  spec: { baseSha: string; repositorySnapshotId: string },
  observed: FreshnessObservation,
): FreshnessResult {
  const stale: FreshnessCheck[] = [];

  for (const check of required) {
    switch (check) {
      case "repository_head_unchanged":
        if (observed.observedHeadSha !== spec.baseSha) stale.push(check);
        break;
      case "repository_snapshot_current":
        if (observed.latestRepositorySnapshotId !== spec.repositorySnapshotId) stale.push(check);
        break;
      case "action_plan_current":
        if (observed.actionPlanIsCurrent !== true) stale.push(check);
        break;
      case "dependencies_still_satisfied":
        if (observed.dependenciesSatisfied !== true) stale.push(check);
        break;
      case "deterministic_capability_still_matches":
        if (observed.capabilityStillMatches !== true) stale.push(check);
        break;
      case "project_ownership_unchanged":
        if (observed.projectOwnerUnchanged !== true) stale.push(check);
        break;
    }
  }

  return stale.length === 0 ? { fresh: true } : { fresh: false, stale };
}
