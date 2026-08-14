import type { ApprovalStatus } from "@/modules/approvals/schema";
import type { MergeFailureCode } from "./schema";

/**
 * Merge preflight (Sprint 11C §3, §4, §6, §7, §9).
 *
 * ## What this file refuses to inherit
 *
 * Everything upstream of it. Repository Intelligence observed a tree. The
 * preparation observed a head. The validation observed a build. The review
 * observed two renderings. The approval observed a human. Every one of those is
 * a **historical observation**, and not one of them is a statement about where
 * the default branch is at the moment of the write.
 *
 * So the preflight is handed live facts and stored facts side by side, and its
 * whole job is to refuse when they disagree:
 *
 * | Check | Source of truth |
 * | --- | --- |
 * | A human approved this exact artifact | the `change_approvals` row |
 * | The approval names *this* commit and base | the prepared change |
 * | The repository is reachable | GitHub, now |
 * | The approved commit still exists | GitHub, now |
 * | It is still a direct child of the base | GitHub, now |
 * | The Vibe branch still points at it | GitHub, now |
 * | The default branch is still at the base | GitHub, now |
 * | The installation may still write | GitHub, now |
 *
 * Pure and probe-injected, so every refusal is a unit test rather than a
 * production incident on someone's default branch.
 *
 * ## Why this runs twice
 *
 * Once to render the merge section, and again **inside the step that writes**
 * (§17). The first is a courtesy so a user is not offered a button that cannot
 * work; it authorizes nothing. Between a page render and a durable step there
 * is a queue, a click, a confirmation dialog and a network — which is more than
 * enough time for `main` to move.
 */

/** Live facts the preflight cannot derive and must be handed (§9). */
export type MergePreflightProbe = {
  /**
   * GitHub's current default branch and head, or null when the repository or
   * installation could not be reached at all.
   */
  defaultBranch: { name: string; commitSha: string } | null;
  /** Where `heads/<prepared branch>` points now, or null when it is gone. */
  preparedBranchHead: string | null;
  /** The approved commit's parents, or null when the commit no longer exists. */
  preparedCommitParents: string[] | null;
  /** Whether the installation currently holds `Contents: write`. */
  hasContentsWritePermission: boolean;
};

export type MergePreflightInput = {
  /**
   * The approval for exactly this artifact, in whatever state it is in.
   *
   * Resolved by identity, never by "the latest approval for this change" (§3).
   * Passed in whatever state it holds so the preflight can distinguish "nobody
   * approved this" from "an approval exists and no longer stands".
   */
  approval: {
    id: string;
    status: ApprovalStatus;
    preparedChangeId: string;
    preparedCommitSha: string;
    preparedBaseSha: string;
  } | null;
  prepared: {
    id: string;
    branchName: string;
    /** Null when the preparation never produced a commit. */
    commitSha: string | null;
    baseSha: string;
  };
  probe: MergePreflightProbe;
};

export type MergePreflightResult =
  | {
      outcome: "eligible";
      defaultBranch: string;
      /** Where the default branch is right now — the base, by definition. */
      observedDefaultHead: string;
      /** The approved commit the branch would move to. */
      targetSha: string;
    }
  /**
   * The default branch is already at the approved commit (§20).
   *
   * Not an error and not a second merge: either a previous attempt succeeded
   * and this is a replay, or somebody merged the same commit by hand. Both are
   * "the outcome exists", and neither is a reason to write again.
   */
  | { outcome: "already_applied"; defaultBranch: string; targetSha: string }
  | { outcome: "blocked"; reason: MergeFailureCode };

export function runMergePreflight(input: MergePreflightInput): MergePreflightResult {
  const { approval, prepared, probe } = input;

  // 1. Human intent, first and unconditionally. Everything below this line is
  //    about *whether the approved thing can still be merged*; without an
  //    approval there is nothing to ask that question about.
  if (approval === null || approval.status !== "approved") {
    return { outcome: "blocked", reason: "merge_approval_required" };
  }

  // 2. And it must be an approval of *this* artifact. A row that names another
  //    prepared change, another commit or another base is not authority here —
  //    it is authority somewhere else (§3).
  if (
    approval.preparedChangeId !== prepared.id ||
    prepared.commitSha === null ||
    approval.preparedCommitSha !== prepared.commitSha ||
    approval.preparedBaseSha !== prepared.baseSha
  ) {
    return { outcome: "blocked", reason: "merge_approval_invalid" };
  }

  const targetSha = approval.preparedCommitSha;
  const baseSha = approval.preparedBaseSha;

  // 3. Nothing below can be answered without GitHub, and guessing is exactly
  //    what this sprint exists not to do.
  if (probe.defaultBranch === null) {
    return { outcome: "blocked", reason: "merge_provider_unavailable" };
  }

  const observedDefaultHead = probe.defaultBranch.commitSha;

  // 4. Before anything else about eligibility: is the outcome already true?
  //    Checked here rather than later because every check below is written for
  //    a branch that has *not* moved, and after a successful merge they would
  //    all correctly report that it has — turning a completed merge into
  //    `merge_repository_changed` (§20).
  if (observedDefaultHead === targetSha) {
    return { outcome: "already_applied", defaultBranch: probe.defaultBranch.name, targetSha };
  }

  // 5. The approved commit must still exist. A rewritten or garbage-collected
  //    branch is not a merge conflict, it is an absence.
  if (probe.preparedCommitParents === null) {
    return { outcome: "blocked", reason: "merge_prepared_commit_missing" };
  }

  // 6. The fast-forward invariant, checked against the commit itself rather
  //    than assumed from how Vibe writes branches (§6). Exactly one parent, and
  //    it is the base: that is what makes moving the default ref to this commit
  //    a fast-forward rather than a merge with the hard cases hidden.
  if (probe.preparedCommitParents.length !== 1 || probe.preparedCommitParents[0] !== baseSha) {
    return { outcome: "blocked", reason: "merge_not_fast_forward" };
  }

  // 7. Approval binds to a commit, not to a branch name (§13). The branch is
  //    checked anyway because merging a commit whose branch has moved on means
  //    the repository contains work nobody reviewed sitting one commit past
  //    what is about to become `main` — worth stopping for, and cheap to see.
  if (probe.preparedBranchHead === null || probe.preparedBranchHead !== targetSha) {
    return { outcome: "blocked", reason: "merge_prepared_branch_changed" };
  }

  // 8. The premise this whole sprint is narrow enough to keep: the default
  //    branch has not moved since the change was prepared. No merge attempt, no
  //    rebase, no conflict reasoning — Vibe refuses and says so (§7).
  if (observedDefaultHead !== baseSha) {
    return { outcome: "blocked", reason: "merge_repository_changed" };
  }

  // 9. Last, following the execution preflight's precedent: it is the only
  //    refusal here a user can resolve by clicking something.
  if (!probe.hasContentsWritePermission) {
    return { outcome: "blocked", reason: "merge_permission_missing" };
  }

  return {
    outcome: "eligible",
    defaultBranch: probe.defaultBranch.name,
    observedDefaultHead,
    targetSha,
  };
}
