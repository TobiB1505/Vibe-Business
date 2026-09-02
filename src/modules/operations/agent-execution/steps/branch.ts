import "server-only";

import { rebuildVerifiedCandidate } from "./verify";
import { AgentExecutionDeps, StepOutcome, recordLifecycle, loadRun, loadSpec } from "./shared";
import {
  computeAgentChangeIdentity,
  computeCandidateDigest,
} from "@/modules/coding-agent/identity";
import { loadPlanStep } from "@/modules/execution-context/service";
import { agentBranchNameFor } from "@/modules/execution/identity";
import { prepareChangeOnBranch } from "@/modules/execution/github-writer";
import { compileCommitMessage, renderCommitMessage } from "@/modules/execution/commit-message";
import { AGENTIC_EXECUTION_CAPABILITY, capabilityVersionFor } from "@/modules/execution/schema";
import {
  claimPreparedChange,
  findPreparedChangeByOperation,
  markPreparedChangeFailed,
  markPreparedChangePrepared,
} from "@/modules/execution/store";
import { setOperationStage } from "../../store";
/* ---------------------------------------------------------------------------
 * Step 4 — trusted Vibe infrastructure writes the branch (§30)
 * ------------------------------------------------------------------------ */

export async function writeAgentBranchStep(
  deps: AgentExecutionDeps,
  operationId: string,
  /** Paths, not bytes — see {@link ExtractOutcome} (VB-017). */
  observedPaths: readonly string[] | null,
  candidateDigest: string,
): Promise<StepOutcome<{ preparedChangeId: string; commitSha: string; branchName: string }>> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  const spec = await loadSpec(deps, run);
  if (!spec) return { ok: false, failureCode: "missing_required_context" };

  const target = await deps.resolveTarget(operation, { withCloneCredential: false });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  // A replay after the branch was written: adopt, never write twice. Checked
  // before the rebuild, so a replay costs no sandbox reads.
  const existing = await findPreparedChangeByOperation(deps.supabase, operationId);
  if (existing?.status === "prepared" && existing.commitSha !== null) {
    return {
      ok: true,
      preparedChangeId: existing.id,
      commitSha: existing.commitSha,
      branchName: existing.branchName,
    };
  }

  /*
   * The bytes, rebuilt here rather than carried here (VB-017).
   *
   * They used to arrive as this step's argument, which meant they had crossed
   * the Vercel Workflow log — a third-party durable store holding a customer's
   * repository content, against rules 26 and 52 and against ADR 0013's own
   * claim that only identifiers travel.
   *
   * Reading them back out of the sandbox is not merely equivalent, it is
   * stricter. `candidateDigest` used to travel *beside* the files and was never
   * compared against them, so this step wrote whatever the log handed it. Now
   * the digest is the only thing that travels and the bytes have to earn it.
   */
  const rebuilt = await rebuildVerifiedCandidate(deps, { run, spec, target, observedPaths });
  if (!rebuilt.ok) return rebuilt;

  if (
    !rebuilt.verification.accepted ||
    (rebuilt.verification.files.length === 0 && rebuilt.verification.deletions.length === 0)
  ) {
    // The first pass accepted this change, so a refusal here means the
    // workspace is no longer what was verified. Refusing is the only safe
    // reading; nothing is written.
    return { ok: false, failureCode: "agent_change_rejected" };
  }

  const files = rebuilt.verification.files;
  const deletions = rebuilt.verification.deletions;

  if (computeCandidateDigest(files, deletions) !== candidateDigest) {
    // Same shape as a moved base: what was approved and what is here are not
    // the same thing, so this refuses rather than reasoning about the
    // difference (Rule 56's posture, applied to the workspace).
    return { ok: false, failureCode: "agent_change_rejected" };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "writing_repository" });

  // The last chance to notice the world moved. A durable operation can sit
  // queued while the repository changes, and a change written onto a moved base
  // is a change against a tree nobody reviewed (§54, Rule 56).
  const head = await target.probe.getHead();
  if (head.commitSha !== run.baseSha) {
    return { ok: false, failureCode: "repository_changed" };
  }

  if (!(await target.probe.hasWritePermission())) {
    return { ok: false, failureCode: "github_write_permission_required" };
  }

  const identity = computeAgentChangeIdentity({
    projectId: run.projectId,
    agentRunIdentity: run.runIdentity,
    baseSha: run.baseSha,
    candidateDigest,
  });

  const prepared =
    existing ??
    (await (async () => {
      const claim = await claimPreparedChange(deps.supabase, {
        projectId: run.projectId,
        userId: run.userId,
        operationRunId: operationId,
        // An agentic change traces to a plan step, not to an opportunity set.
        // The spec carries the Move it descends from, and the columns are
        // nullable for exactly this case.
        opportunitySetId: null,
        opportunityId: null,
        capability: AGENTIC_EXECUTION_CAPABILITY,
        capabilityVersion: capabilityVersionFor(AGENTIC_EXECUTION_CAPABILITY),
        repositorySnapshotId: spec.spec.repository.repositorySnapshotId,
        baseBranch: spec.spec.repository.defaultBranch,
        baseSha: run.baseSha,
        branchName: agentBranchNameFor(identity),
        executionIdentity: identity,
      });
      return claim.ok ? claim.preparedChange : null;
    })());

  if (!prepared) return { ok: false, failureCode: "change_preparation_failed" };

  /*
   * The commit message, compiled before the write (Sprint 0046, PART H).
   *
   * `loadPlanStep` is the same trusted lookup `execution-context/service.ts`
   * already uses — fixture registry first, then the project's real plan — so
   * this opens no second source of truth. A step it cannot find (an unusual,
   * legitimate case: a plan reworded or removed since the run started)
   * compiles to `null`, and the compiler's own fallback produces a generic but
   * still-real Conventional Commit rather than failing the write.
   *
   * Title, purpose and doneWhen come from this same step, not from
   * `spec.spec.objective` — the two describe the same field in production
   * (the objective was copied from this exact step when the spec was built),
   * but reading one source rather than two avoids a second place either could
   * ever drift from the other.
   */
  const trustedStep = await loadPlanStep({
    supabase: deps.supabase,
    projectId: run.projectId,
    spec: spec.spec,
  });

  const compiledMessage = compileCommitMessage(
    trustedStep
      ? {
          title: trustedStep.title,
          purpose: trustedStep.purpose,
          doneWhen: trustedStep.completionCriteria,
          changeKind: trustedStep.changeKind,
          evidenceIds: trustedStep.evidenceIds,
        }
      : null,
    {
      executionId: run.id,
      stepKey: spec.spec.stepKey,
      preparedChangeId: prepared.id,
    },
  );

  await recordLifecycle(
    deps,
    run,
    "commit_message_compiled",
    compiledMessage.fallback
      ? "Could not classify this change; using the generic commit message"
      : `Commit message: ${compiledMessage.type}${compiledMessage.scope ? `(${compiledMessage.scope})` : ""}`,
    {
      compilerVersion: compiledMessage.compilerVersion,
      type: compiledMessage.type,
      scope: compiledMessage.scope,
      subject: compiledMessage.subject,
      fallback: compiledMessage.fallback,
      fallbackReason: compiledMessage.fallbackReason,
    },
  );

  const write = await prepareChangeOnBranch(
    target.git,
    {
      owner: target.owner,
      repo: target.repo,
      baseBranch: prepared.baseBranch,
      baseSha: prepared.baseSha,
      branchName: prepared.branchName,
      capability: AGENTIC_EXECUTION_CAPABILITY,
      commitMessage: renderCommitMessage(compiledMessage),
    },
    files.map((file) => ({
      path: file.path,
      content: file.content,
      contentHash: file.contentHash,
      bytes: file.bytes,
    })),
    deletions,
  );

  if (!write.ok) {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: write.reason,
    });
    return { ok: false, failureCode: write.reason };
  }

  await markPreparedChangePrepared(deps.supabase, {
    preparedChangeId: prepared.id,
    commitSha: write.commitSha,
    /* The counts come from verification, which held both the workspace bytes
       and the pinned commit's baseline. A file it could not compare stores no
       count rather than a zero (rule 44). */
    files: [
      ...files.map((file) => ({
        path: file.path,
        contentHash: file.contentHash,
        bytes: file.bytes,
        ...(file.linesAdded !== null && file.linesRemoved !== null
          ? { linesAdded: file.linesAdded, linesRemoved: file.linesRemoved }
          : {}),
      })),
      /* A removed path is one of the files this change touched, so it is in the
         same list every reader already walks — the diff, the classification,
         the outcome routes. It carries no hash and no byte count because there
         is nothing to measure, and `status` is what tells them apart. */
      ...deletions.map((path) => ({ path, status: "deleted" as const })),
    ],
  });

  await recordLifecycle(deps, run, "branch_prepared", "Your change is ready to review", {
    branch: prepared.branchName,
    commitSha: write.commitSha,
    files: files.length + deletions.length,
  });

  return {
    ok: true,
    preparedChangeId: prepared.id,
    commitSha: write.commitSha,
    branchName: prepared.branchName,
  };
}
