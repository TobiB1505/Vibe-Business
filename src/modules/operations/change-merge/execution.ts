import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findActiveApprovalForCurrentArtifact } from "@/modules/approvals/service";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange } from "@/modules/execution/store";
import type { MergeApprovedChangePort } from "@/modules/merge/git-port";
import { runMergePreflight } from "@/modules/merge/preflight";
import type { ChangeMerge, MergeFailureCode } from "@/modules/merge/schema";
import {
  findMergeByOperation,
  markMergeBlocked,
  markMergeFailed,
  markMergeVerified,
  markMergeWriteAttempted,
  recordMergePreflight,
} from "@/modules/merge/store";
import { completeOperationRun, failOperationRun, getOperationRunById, setOperationStage } from "../store";

/**
 * Durable steps for a safe merge (Sprint 11C §18, §19, §20, §21, §22).
 *
 * ```
 * authorize ─▶ write ─▶ verify ─▶ complete
 *     │          │         │
 *     └──────────┴─────────┴─────▶ blocked / failed
 * ```
 *
 * ## Why the preflight runs again here
 *
 * Because the one that rendered the button is not the one that authorizes the
 * write (§17). Between a page render, a click, a dialog, a confirmation and a
 * queue there is easily a minute — and a minute is plenty for somebody to push
 * to `main`. Stored evidence is a routing signal, never permission (CLAUDE.md
 * rule 55), and that includes evidence this product itself produced 40 seconds
 * ago.
 *
 * ## Why the write step reads before it writes
 *
 * Three separate reasons, all satisfied by the same read:
 *
 *  1. **Re-entrancy.** A replayed workflow must not issue a second write. If
 *     the branch is already at the approved commit, there is nothing to do and
 *     the step converges to success (§20, §38).
 *  2. **Freshness.** It is the last possible moment to check that the branch is
 *     still where the approval expects it.
 *  3. **Recovery.** The same read is what resolves an ambiguous outcome
 *     afterwards, so the logic exists once rather than twice (§19).
 *
 * ## What is not here
 *
 * No merge commit, no rebase, no cherry-pick, no conflict resolution, no branch
 * deletion, no force, no model call, no sandbox, no browser, and no deployment
 * provider. A merge in V0.1 moves one ref to one existing commit or refuses.
 */

export type MergeDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The merge capability, built per operation from the persisted repository
   * connection. Injected so every path here is testable with an in-memory
   * double that touches no repository.
   */
  resolvePort: (merge: ChangeMerge) => Promise<MergeApprovedChangePort | null>;
};

export type MergeStepOutcome =
  | { ok: true }
  /** Refused before any write. The repository was not touched. */
  | { ok: false; kind: "blocked"; failureCode: MergeFailureCode }
  /** A write was attempted and did not end verified. */
  | { ok: false; kind: "failed"; failureCode: MergeFailureCode; observedHead?: string | null };

type MergeContext = {
  merge: ChangeMerge;
  port: MergeApprovedChangePort;
  projectId: string;
  userId: string;
};

/**
 * Loads the merge this operation owns.
 *
 * Ownership comes from the persisted operation row, never from an argument: the
 * service-role client bypasses RLS entirely, so every query below has to assert
 * the project itself (CLAUDE.md rule 53).
 */
async function loadContext(deps: MergeDeps, operationId: string): Promise<MergeContext | null> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return null;

  const merge = await findMergeByOperation(deps.supabase, operationId);
  if (!merge || merge.projectId !== operation.projectId) return null;

  const port = await deps.resolvePort(merge);
  if (!port) return null;

  return { merge, port, projectId: operation.projectId, userId: operation.userId };
}

/**
 * Runs the full preflight against live GitHub state and the current approval.
 *
 * Shared by the authorize step and the write step. The write step calls it
 * again rather than trusting its own predecessor, which is the difference
 * between "we checked" and "we checked immediately before we wrote".
 */
async function preflight(deps: MergeDeps, context: MergeContext) {
  const { merge, port, projectId } = context;

  const prepared = await getPreparedChange(deps.supabase, {
    projectId,
    preparedChangeId: merge.preparedChangeId,
  });

  if (!prepared) {
    return { outcome: "blocked", reason: "merge_approval_invalid" } as const;
  }

  // Re-resolved, not read from `merge.changeApprovalId`. An approval revoked
  // between the click and this moment must stop the write, and a row id that
  // was valid when it was stored says nothing about whether it still stands
  // (§3, §35).
  const approval = await findActiveApprovalForCurrentArtifact(deps.supabase, {
    projectId,
    preparedChangeId: merge.preparedChangeId,
  });

  // The approval that authorized *this* merge must be the one still standing.
  // A different active approval — a re-approval of a regenerated artifact — is
  // authority for something else, and must not silently authorize this row.
  if (approval !== null && approval.id !== merge.changeApprovalId) {
    return { outcome: "blocked", reason: "merge_approval_invalid" } as const;
  }

  const [defaultBranch, preparedBranchHead, preparedCommitParents, hasContentsWritePermission] =
    await Promise.all([
      port.getDefaultBranch(),
      port.getBranchHead(prepared.branchName),
      port.getCommitParents(merge.preparedCommitSha),
      port.hasContentsWritePermission(),
    ]);

  return runMergePreflight({
    approval: approval
      ? {
          id: approval.id,
          status: approval.status,
          preparedChangeId: approval.preparedChangeId,
          preparedCommitSha: approval.preparedCommitSha,
          preparedBaseSha: approval.preparedBaseSha,
        }
      : null,
    prepared: {
      id: prepared.id,
      branchName: prepared.branchName,
      commitSha: prepared.commitSha,
      baseSha: prepared.baseSha,
    },
    probe: {
      defaultBranch,
      preparedBranchHead,
      preparedCommitParents,
      hasContentsWritePermission,
    },
  });
}

/**
 * Step 1 — revalidate human intent against live GitHub state (§9).
 *
 * Writes nothing to GitHub. Its only side effects are recording what was
 * observed and, on refusal, marking the merge blocked — which is a state that
 * means, precisely, *the repository was not touched*.
 */
export async function authorizeMergeStep(
  deps: MergeDeps,
  operationId: string,
): Promise<MergeStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, kind: "blocked", failureCode: "merge_failed" };

  await setOperationStage(deps.supabase, {
    operationId,
    stage: "authorizing",
    markRunning: true,
  });

  const result = await preflight(deps, context);

  if (result.outcome === "blocked") {
    return { ok: false, kind: "blocked", failureCode: result.reason };
  }

  // The branch is already at the approved commit. Not a merge to perform — an
  // outcome to record (§20). Falls through to verification, which reads the
  // branch independently and is the only thing allowed to say `merged`.
  if (result.outcome === "already_applied") {
    await recordMergePreflight(deps.supabase, {
      mergeId: context.merge.id,
      projectId: context.projectId,
      defaultBranch: result.defaultBranch,
      observedDefaultHead: result.targetSha,
    });
    return { ok: true };
  }

  await recordMergePreflight(deps.supabase, {
    mergeId: context.merge.id,
    projectId: context.projectId,
    defaultBranch: result.defaultBranch,
    observedDefaultHead: result.observedDefaultHead,
  });

  await recordAuditEvent(deps.supabase, {
    userId: context.userId,
    eventType: "change_merge.preflight_passed",
    metadata: {
      project_id: context.projectId,
      change_merge_id: context.merge.id,
      prepared_change_id: context.merge.preparedChangeId,
      change_approval_id: context.merge.changeApprovalId,
      default_branch: result.defaultBranch,
      base_sha: result.observedDefaultHead,
      target_sha: result.targetSha,
      merge_policy_version: context.merge.mergePolicyVersion,
    },
  });

  return { ok: true };
}

/**
 * Step 2 — the consequential write (§19, §21, §22).
 *
 * The only step in this product that can move a customer's default branch, and
 * the shortest one, because everything it might have decided was decided
 * before it or is decided by reading afterwards.
 */
export async function writeMergeStep(
  deps: MergeDeps,
  operationId: string,
): Promise<MergeStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, kind: "blocked", failureCode: "merge_failed" };
  const { merge, port, projectId } = context;

  await setOperationStage(deps.supabase, { operationId, stage: "writing_default_ref" });

  // Immediately before the write, not inherited from step 1 (§17).
  const result = await preflight(deps, context);

  if (result.outcome === "blocked") {
    return { ok: false, kind: "blocked", failureCode: result.reason };
  }

  // Already there. A replay, or a hand merge of the same commit. Either way the
  // one thing that must not happen is a second write (§20, §38).
  if (result.outcome === "already_applied") return { ok: true };

  // The row is the lock. Marking the attempt *before* making it is what makes an
  // interrupted merge legible afterwards, and the conditional update is what
  // makes it happen at most once: a replay finds the row already `merging` and
  // gets null, which means "do not write — read the branch" (§19, rule 50).
  const claimed = await markMergeWriteAttempted(deps.supabase, {
    mergeId: merge.id,
    projectId,
  });

  if (!claimed) {
    // Something already attempted this write. Do not repeat it; let
    // verification read the branch and decide what actually happened.
    return { ok: true };
  }

  const outcome = await port.fastForwardDefaultBranch({
    branch: result.defaultBranch,
    toSha: result.targetSha,
  });

  if (outcome.kind === "rejected") {
    // GitHub answered and refused. Definitive: the branch was not moved.
    const failureCode: MergeFailureCode =
      outcome.reason === "protected_branch"
        ? "merge_protected_branch"
        : outcome.reason === "not_fast_forward"
          ? "merge_not_fast_forward"
          : outcome.reason === "permission_denied"
            ? "merge_permission_missing"
            : "merge_write_failed";

    return { ok: false, kind: "failed", failureCode, observedHead: null };
  }

  if (outcome.kind === "ambiguous") {
    // **Never retry a consequential write on an ambiguous transport error.**
    // Read the branch and let the observed state decide (§19).
    const after = await port.getDefaultBranch();

    if (after === null) {
      // Still cannot see GitHub. Terminal, and deliberately not retried: a
      // second write here is exactly how a system turns "we do not know" into
      // "we did it twice".
      return { ok: false, kind: "failed", failureCode: "merge_provider_unavailable" };
    }

    if (after.commitSha === result.targetSha) {
      // The write landed. Verification will confirm it independently.
      await recordAuditEvent(deps.supabase, {
        userId: context.userId,
        eventType: "change_merge.default_branch_updated",
        metadata: {
          project_id: projectId,
          change_merge_id: merge.id,
          default_branch: result.defaultBranch,
          base_sha: result.observedDefaultHead,
          target_sha: result.targetSha,
          // Recorded because "we could not tell, so we looked" is the single
          // most useful line in the postmortem of an interrupted merge.
          resolved_by: "read_after_ambiguous_write",
        },
      });
      return { ok: true };
    }

    if (after.commitSha === result.observedDefaultHead) {
      // The branch is untouched, so the write did not land. Not retried
      // automatically: recovery from an ambiguous default-branch write is a
      // fresh, explicit human action, which re-runs this entire preflight. That
      // is the explicit safe retry policy §19 asks for — and it is safe
      // precisely because it is not automatic.
      return { ok: false, kind: "failed", failureCode: "merge_write_failed", observedHead: after.commitSha };
    }

    // A third state: somebody else moved the branch while we were writing to
    // it. Stop. Nothing automatic is safe on a default branch in this
    // condition, and guessing would be worse than saying so.
    return {
      ok: false,
      kind: "failed",
      failureCode: "merge_ambiguous_write",
      observedHead: after.commitSha,
    };
  }

  await recordAuditEvent(deps.supabase, {
    userId: context.userId,
    eventType: "change_merge.default_branch_updated",
    metadata: {
      project_id: projectId,
      change_merge_id: merge.id,
      prepared_change_id: merge.preparedChangeId,
      change_approval_id: merge.changeApprovalId,
      default_branch: result.defaultBranch,
      base_sha: result.observedDefaultHead,
      target_sha: result.targetSha,
      merge_strategy: merge.mergeStrategy,
      merge_policy_version: merge.mergePolicyVersion,
    },
  });

  return { ok: true };
}

/**
 * Step 3 — independent read-back (§22).
 *
 * A 2xx from the write is a claim about a request. This is the observation, and
 * it is the only thing in the system permitted to produce `merged`. The
 * database agrees: its constraint refuses a `merged` row whose observed result
 * is anything other than the approved commit, so removing this check cannot
 * silently start reporting successes.
 */
export async function verifyMergeStep(
  deps: MergeDeps,
  operationId: string,
): Promise<MergeStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, kind: "failed", failureCode: "merge_failed" };
  const { merge, port, projectId } = context;

  await setOperationStage(deps.supabase, { operationId, stage: "verifying_default_ref" });

  const after = await port.getDefaultBranch();

  if (after === null) {
    return { ok: false, kind: "failed", failureCode: "merge_provider_unavailable" };
  }

  // Exact equality with the commit a human approved. Not "the branch changed",
  // not "it moved forward", not "it contains our commit" — those all have
  // readings under which a merge of somebody else's work reports success (§39).
  if (after.commitSha !== merge.preparedCommitSha) {
    return {
      ok: false,
      kind: "failed",
      failureCode: "merge_verification_failed",
      observedHead: after.commitSha,
    };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "converging" });

  const verified = await markMergeVerified(deps.supabase, {
    mergeId: merge.id,
    projectId,
    resultingDefaultHeadSha: after.commitSha,
  });

  if (!verified) {
    // The database refused to record the merge. Reporting success anyway would
    // leave the product claiming something its own store does not say.
    return { ok: false, kind: "failed", failureCode: "merge_verification_failed" };
  }

  await recordAuditEvent(deps.supabase, {
    userId: context.userId,
    eventType: "change_merge.verified",
    metadata: {
      project_id: projectId,
      change_merge_id: merge.id,
      prepared_change_id: merge.preparedChangeId,
      change_approval_id: merge.changeApprovalId,
      default_branch: merge.defaultBranch,
      base_sha: merge.preparedBaseSha,
      // What the branch actually points at now, read independently.
      resulting_default_head_sha: after.commitSha,
      merge_policy_version: merge.mergePolicyVersion,
    },
  });

  return { ok: true };
}

/** Marks the operation complete, pointing at the merge it produced. */
export async function completeMergeStep(deps: MergeDeps, operationId: string): Promise<void> {
  const merge = await findMergeByOperation(deps.supabase, operationId);

  if (!merge) {
    // Completing an operation whose result vanished would leave the UI with a
    // success it cannot show anything for. Failing it is the truthful answer:
    // whatever happened, this operation cannot account for it.
    await failOperationRun(deps.supabase, { operationId, failureCode: "merge_failed" });
    return;
  }

  await completeOperationRun(deps.supabase, { operationId, resultId: merge.id });
}

/**
 * Records a terminal refusal or failure on both the merge and the operation.
 *
 * ## Why the row decides `blocked` versus `failed`, not the caller
 *
 * Because the row is the only thing that *knows*. `blocked` means the
 * repository was never touched, and the single fact that establishes it is
 * whether the write was ever claimed — which is exactly what `status` records,
 * set before the call rather than after it (§19).
 *
 * Deriving it here also makes the catch-all path honest: a step that throws
 * outside the returned-failure convention has no idea how far it got, and
 * having it guess "failed" would report a write that never happened on every
 * unexpected error during authorization. On a default branch, "we refused" and
 * "we tried and something went wrong" are not two shades of one sentence.
 */
export async function abortMergeStep(
  deps: MergeDeps,
  operationId: string,
  failure: { failureCode: MergeFailureCode; observedHead?: string | null },
): Promise<void> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  const merge = await findMergeByOperation(deps.supabase, operationId);

  if (merge && operation && merge.projectId === operation.projectId) {
    const wroteNothing = merge.status === "preflight";

    const recorded = wroteNothing
      ? await markMergeBlocked(deps.supabase, {
          mergeId: merge.id,
          projectId: merge.projectId,
          failureCode: failure.failureCode,
        })
      : await markMergeFailed(deps.supabase, {
          mergeId: merge.id,
          projectId: merge.projectId,
          failureCode: failure.failureCode,
          observedDefaultHead: failure.observedHead ?? null,
        });

    if (recorded) {
      await recordAuditEvent(deps.supabase, {
        userId: operation.userId,
        eventType: wroteNothing ? "change_merge.blocked" : "change_merge.failed",
        metadata: {
          project_id: merge.projectId,
          change_merge_id: merge.id,
          prepared_change_id: merge.preparedChangeId,
          change_approval_id: merge.changeApprovalId,
          default_branch: merge.defaultBranch,
          target_sha: merge.preparedCommitSha,
          failure_code: failure.failureCode,
          // Present only when a recovery read produced one. Never a provider
          // message, never a stack trace.
          observed_default_head: failure.observedHead ?? null,
          merge_policy_version: merge.mergePolicyVersion,
        },
      });
    }
  }

  await failOperationRun(deps.supabase, { operationId, failureCode: failure.failureCode });
}
