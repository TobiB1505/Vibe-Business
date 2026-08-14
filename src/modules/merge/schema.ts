/**
 * The merge domain (Sprint 11C §2, §5, §12, §28).
 *
 * ## The first Vibe-authorized write to a default branch
 *
 * Every previous repository write went to an isolated `vibe/…` branch nobody
 * was running. This one moves the branch a customer's deployments come from,
 * which makes it a different kind of act, not a bigger one — and the whole
 * shape of this module is a reaction to that.
 *
 * ```
 * repository_write_verified   the bytes on the branch are the bytes we meant
 * sandbox_validation_passed   those bytes install, typecheck, test and build
 * preview_available           that exact artifact ran and was reachable
 * review_artifact_available   a controlled before/after comparison exists
 * human_approved              a person looked at one commit and said yes
 * merged                      ← this sprint: the default branch moved
 * deployed                    still does not exist
 * ```
 *
 * ## Two authorities, both required
 *
 * A merge needs **immutable human intent** and **fresh external state**, and
 * neither substitutes for the other:
 *
 *  - The approval says a person approved commit X. It is history, it cannot
 *    change, and a push to `main` does not unmake it (ADR 0018 §6).
 *  - GitHub says where the default branch is *right now*. It is current, it can
 *    change between the click and the write, and it is never inferred from a
 *    stored snapshot.
 *
 * An approval alone would write bytes onto a branch that has moved. Live state
 * alone would write bytes nobody approved. So both are checked, and the second
 * is checked again inside the step that writes.
 */

/**
 * What "merged" was checked against (§5).
 *
 * Versioned for the same reason the sandbox and approval policies are: it fixes
 * *what the product verified* before moving someone's default branch — an active
 * exact approval, current GitHub truth, a fast-forward-only shape, no force, no
 * history rewrite, and an independent read-back afterwards.
 *
 * Change any of that and a stored `merged` row would come to mean something it
 * was never checked against, so the version is part of the merge's identity and
 * old rows keep their original meaning.
 */
export const MERGE_POLICY_VERSION = "merge-policy-v1" as const;

/**
 * The one supported merge shape (§6, §12).
 *
 * Not a strategy the user picks — there is nothing to pick between. V0.1
 * supports exactly the class of change Vibe's own execution capability
 * produces: a single commit whose parent is the base it was prepared against,
 * merged only while the default branch is still at that base.
 *
 * That makes the merge a **fast-forward**: the default ref moves to a commit
 * that already contains its current tip. No merge commit is created, no content
 * is generated, no history is rewritten, and there is nothing to resolve —
 * which is why it is the honest first merge capability rather than a general
 * merge engine with the hard cases missing.
 */
export const MERGE_STRATEGIES = ["fast_forward_exact_commit"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

export const FAST_FORWARD_EXACT_COMMIT = "fast_forward_exact_commit" as const;

/**
 * Merge lifecycle (§2).
 *
 * Five states, and the boundary between the first two is the one that matters:
 * `preflight` means **no write has been attempted**, `merging` means one may
 * already have happened. Everything about ambiguity recovery hangs off that
 * distinction, which is why it is a persisted status rather than an inference
 * from timestamps.
 */
export const MERGE_STATUSES = [
  /** Requested and authorized by a human; nothing has been written yet. */
  "preflight",
  /**
   * The default-branch update has been attempted.
   *
   * Set *before* the call, never after. A row that reaches this status and stops
   * there is exactly the ambiguous case §19 exists for: the only safe next move
   * is to read the branch, never to write again.
   */
  "merging",
  /** The default branch was read back independently and equals the approved commit. */
  "merged",
  /** Refused before any write. The repository was not touched. */
  "blocked",
  /** A write was attempted and did not end in a verified merge. */
  "failed",
] as const;
export type MergeStatus = (typeof MERGE_STATUSES)[number];

/** True once a default-branch write may already have taken effect (§19). */
export function mayHaveWritten(status: MergeStatus): boolean {
  return status === "merging" || status === "merged" || status === "failed";
}

/** Statuses from which nothing further happens to this row. */
export function isMergeTerminal(status: MergeStatus): boolean {
  return status === "merged" || status === "blocked" || status === "failed";
}

/**
 * Every way a merge can refuse or fail (§28).
 *
 * A closed set, each mapping to copy that says what happened and — where it is
 * true — what the user can do about it. Provider prose never reaches a user, and
 * never reaches this union either.
 */
export const MERGE_FAILURE_CODES = [
  /** No active approval exists for this exact artifact (§3). */
  "merge_approval_required",
  /** An approval exists but names a different commit, base or artifact (§3). */
  "merge_approval_invalid",
  /** The default branch is no longer at the base this change was prepared on (§7). */
  "merge_repository_changed",
  /** The approved commit no longer exists in the repository (§13). */
  "merge_prepared_commit_missing",
  /** The Vibe branch no longer points at the approved commit (§13). */
  "merge_prepared_branch_changed",
  /** The installation no longer carries the permission the write needs (§10). */
  "merge_permission_missing",
  /** Repository rules rejected the direct update. Vibe did not bypass them (§11). */
  "merge_protected_branch",
  /** The approved commit is not a direct child of the recorded base (§6). */
  "merge_not_fast_forward",
  /** GitHub answered and refused; the branch was not moved. */
  "merge_write_failed",
  /**
   * The write's outcome could not be determined, and reading afterwards found a
   * third state — neither the old base nor the approved commit (§19).
   *
   * Terminal on purpose. Something moved the branch concurrently, and no
   * automatic action is safe on a default branch in that condition.
   */
  "merge_ambiguous_write",
  /** GitHub accepted the write, but the read-back was not the approved commit (§22). */
  "merge_verification_failed",
  /** GitHub could not be reached at all. Nothing was attempted. */
  "merge_provider_unavailable",
  /** No repository connection, or the project has none. */
  "merge_repository_unavailable",
  /** The action reached the server without an explicit human confirmation (§16). */
  "merge_confirmation_required",
  /** The caller does not hold merge authority over this project. */
  "merge_not_authorized",
  "merge_failed",
] as const;
export type MergeFailureCode = (typeof MERGE_FAILURE_CODES)[number];

/**
 * One attempt to move one default branch to one approved commit.
 *
 * Everything that says *what was merged, from where, to where, and under which
 * rules* is copied onto the row rather than joined later — the same discipline
 * as the approval, and for the same reason. A merge record that answers "what
 * happened?" with a join is a record that changes its answer when something
 * else changes.
 */
export type ChangeMerge = {
  id: string;
  projectId: string;
  /** The human who requested the merge. Server-resolved from the session. */
  userId: string;

  preparedChangeId: string;
  /** The exact approval that authorized this. Never "the latest" (§3). */
  changeApprovalId: string;
  repositoryConnectionId: string;

  /** The approved commit, and the base it was prepared against. */
  preparedCommitSha: string;
  preparedBaseSha: string;

  /** The default branch as GitHub reported it at preflight, never from a snapshot. */
  defaultBranch: string;
  /**
   * Where the default branch was immediately before the write was attempted.
   *
   * Recorded so a merge can say what it moved *from*. Without it, a `merged`
   * row cannot distinguish "we fast-forwarded main" from "main was already
   * there and we did nothing".
   */
  observedDefaultHeadBefore: string | null;

  mergePolicyVersion: string;
  mergeStrategy: MergeStrategy;
  /** Deterministic hash of the artifact, the approval and the policy (§20). */
  mergeIdentity: string;

  operationRunId: string | null;

  status: MergeStatus;
  /** The default-branch head read back independently after the write (§22). */
  resultingDefaultHeadSha: string | null;
  failureCode: MergeFailureCode | null;

  preflightCheckedAt: string | null;
  startedAt: string | null;
  mergedAt: string | null;
  failedAt: string | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * **A merge is not a deployment** (§25, §26).
 *
 * Named as a function so the distinction lives in code rather than only in
 * prose, and so anything tempted to render `merged` as "live" walks past this
 * comment first.
 *
 * `merged` means one sentence: *the repository's default branch now points at
 * the approved commit, and Vibe read it back to confirm.*
 *
 * It does not mean the application was built, deployed, or is serving anything.
 * Vibe calls no deployment provider — but the honest statement is not "no
 * production effect" either: moving a default branch may well trigger the
 * customer's own CI/CD, which is why the confirmation says so before the click
 * rather than the result page apologising after it.
 */
export function mergeIsNotDeployment(): true {
  return true;
}
