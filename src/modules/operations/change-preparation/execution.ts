import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getLatestSuccessfulSnapshot, getSnapshotById } from "@/modules/repository-intelligence/store";
import { getAuditCurrency } from "@/modules/business-audit/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { resolveExecutionCapability } from "@/modules/execution/capabilities";
import { generateSeoFoundations } from "@/modules/execution/generators/nextjs-seo-foundations";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import { prepareChangeOnBranch } from "@/modules/execution/github-writer";
import { branchNameFor, computeExecutionIdentity } from "@/modules/execution/identity";
import { runExecutionPreflight } from "@/modules/execution/preflight";
import {
  capabilityVersionFor,
  type ExecutionFailureCode,
} from "@/modules/execution/schema";
import {
  claimPreparedChange,
  findPreparedChangeByOperation,
  markPreparedChangeFailed,
  markPreparedChangePrepared,
} from "@/modules/execution/store";
import type { OperationFailureCode } from "../failures";
import {
  claimResultForOperation,
  completeOperationRun,
  failOperationRun,
  getOperationRunById,
  setOperationStage,
  type StoredOperationRun,
} from "../store";

/**
 * Durable step bodies for change preparation (Sprint 9B §11, §12).
 *
 * ## The revalidation happens here, not at start
 *
 * The service checks eligibility before creating an operation, but that check
 * is a *courtesy* — it stops an obviously doomed run from being queued. It is
 * not the safety boundary.
 *
 * The safety boundary is here, immediately before the write. A durable
 * operation can sit queued while the repository moves, a teammate adds the
 * files, or the site starts serving them. Trusting the start-time check would
 * mean writing a change that was correct when the button was pressed and wrong
 * by the time it landed (§12).
 *
 * Ports are injected, so every one of these paths is testable without GitHub.
 */

export type PreparationDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /** Built per step from the operation's own project — never from input. */
  resolveTarget: (operation: StoredOperationRun) => Promise<PreparationTarget | null>;
};

export type PreparationTarget = {
  owner: string;
  repo: string;
  productionOrigin: string | null;
  appRoot: string | null;
  git: GitWritePort;
  probe: ExecutionProbePort;
};

export type StepOutcome<T> = ({ ok: true } & T) | { ok: false; failureCode: OperationFailureCode };

async function loadOperation(
  supabase: SupabaseClient,
  operationId: string,
): Promise<StepOutcome<{ operation: StoredOperationRun }>> {
  const operation = await getOperationRunById(supabase, operationId);
  if (!operation) return { ok: false, failureCode: "operation_not_found" };

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", operation.projectId)
    .maybeSingle();

  if (!project || (project as { user_id: string }).user_id !== operation.userId) {
    return { ok: false, failureCode: "project_not_found" };
  }

  return { ok: true, operation };
}

/**
 * Step 1 — preflight against live state, then claim the preparation.
 *
 * The claim happens *after* the preflight and *before* the write. That order
 * is what makes the whole thing idempotent: a row exists before a branch does,
 * so a re-entry has something to find (§14).
 */
export async function preflightStep(
  deps: PreparationDeps,
  operationId: string,
): Promise<StepOutcome<{ preparedChangeId: string; branchName: string; baseSha: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  // A replay after the claim: reuse it rather than claiming twice.
  const existing = await findPreparedChangeByOperation(deps.supabase, operationId);
  if (existing) {
    return {
      ok: true,
      preparedChangeId: existing.id,
      branchName: existing.branchName,
      baseSha: existing.baseSha,
    };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "preflight", markRunning: true });

  const target = await deps.resolveTarget(operation);
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  const [snapshot, opportunities, currency] = await Promise.all([
    getLatestSuccessfulSnapshot(deps.supabase, operation.projectId),
    getLatestOpportunities(deps.supabase, operation.projectId),
    getAuditCurrency(deps.supabase, operation.projectId),
  ]);

  if (!snapshot?.result) return { ok: false, failureCode: "stale_repository_intelligence" };
  if (!opportunities) return { ok: false, failureCode: "unsupported_opportunity" };

  // The operation carries the opportunity it was created for. Re-resolved from
  // the current set, so an opportunity that no longer exists blocks.
  const opportunity = opportunities.set.opportunities.find(
    (entry) => entry.id === operation.subjectId,
  );
  if (!opportunity) return { ok: false, failureCode: "stale_opportunity" };

  const head = await target.probe.getHead();

  const capability = resolveExecutionCapability({
    opportunity,
    repository: snapshot.result,
    hasProductionOrigin: target.productionOrigin !== null,
  });
  if (!capability.supported) return { ok: false, failureCode: "unsupported_opportunity" };

  // Probe live state for the exact paths this capability would write.
  // Only the paths matter here, and paths do not depend on route selection or
  // origin — so a placeholder origin and no routes are deliberate.
  const candidateFiles =
    target.appRoot === null
      ? []
      : generateSeoFoundations({
          origin: target.productionOrigin ?? "https://example.invalid",
          appRoot: target.appRoot,
          routes: [],
        });

  const [existingTargetPaths, liveRobotsServed, liveSitemapServed, hasWritePermission] = await Promise.all([
    target.probe.findExistingPaths(candidateFiles.map((file) => file.path)),
    target.probe.isServed("/robots.txt"),
    target.probe.isServed("/sitemap.xml"),
    target.probe.hasWritePermission(),
  ]);

  const preflight = runExecutionPreflight({
    opportunity,
    repository: snapshot.result,
    repositorySnapshotId: snapshot.id,
    latestRepositorySnapshotId: snapshot.id,
    snapshotCommitSha: snapshot.result.source.commitSha,
    auditCurrent: currency.upToDate,
    opportunitySetCurrent: !opportunities.stale,
    productionOrigin: target.productionOrigin,
    appRoot: target.appRoot,
    probe: { head, existingTargetPaths, liveRobotsServed, liveSitemapServed, hasWritePermission },
  });

  if (!preflight.eligible) return { ok: false, failureCode: preflight.reason };

  const identity = computeExecutionIdentity({
    projectId: operation.projectId,
    opportunitySetId: opportunities.set.id,
    opportunityId: opportunity.id,
    capability: preflight.capability,
    capabilityVersion: capabilityVersionFor(preflight.capability),
    repositorySnapshotId: snapshot.id,
    baseSha: preflight.baseSha,
  });

  const claim = await claimPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    userId: operation.userId,
    operationRunId: operationId,
    opportunitySetId: opportunities.set.id,
    opportunityId: opportunity.id,
    capability: preflight.capability,
    capabilityVersion: capabilityVersionFor(preflight.capability),
    repositorySnapshotId: snapshot.id,
    baseBranch: preflight.baseBranch,
    baseSha: preflight.baseSha,
    branchName: branchNameFor(identity),
    executionIdentity: identity,
  });

  if (!claim.ok) {
    return {
      ok: false,
      failureCode: claim.error === "already_active" ? "already_running" : "change_preparation_failed",
    };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: claim.preparedChange.id });

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "change_preparation.started",
    metadata: {
      projectId: operation.projectId,
      operationId,
      preparedChangeId: claim.preparedChange.id,
      opportunityId: opportunity.id,
      capability: preflight.capability,
    },
  });

  return {
    ok: true,
    preparedChangeId: claim.preparedChange.id,
    branchName: claim.preparedChange.branchName,
    baseSha: claim.preparedChange.baseSha,
  };
}

/**
 * Step 2 — generate, write, verify and persist, as one step.
 *
 * One step for the same reason the paid AI steps are: splitting the write from
 * its persistence would create a window where a branch exists that nothing
 * records. The write is idempotent by branch inspection, so re-entry is safe.
 */
export async function writeChangeStep(
  deps: PreparationDeps,
  operationId: string,
): Promise<StepOutcome<{ preparedChangeId: string; commitSha: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  const prepared = await findPreparedChangeByOperation(deps.supabase, operationId);
  if (!prepared) return { ok: false, failureCode: "change_preparation_failed" };

  // Already finished: a replay of a step that completed.
  if (prepared.status === "prepared" && prepared.commitSha !== null) {
    return { ok: true, preparedChangeId: prepared.id, commitSha: prepared.commitSha };
  }
  if (prepared.status === "failed") {
    return { ok: false, failureCode: prepared.failureCode ?? "change_preparation_failed" };
  }

  const target = await deps.resolveTarget(operation);
  if (!target || target.appRoot === null || target.productionOrigin === null) {
    return { ok: false, failureCode: "missing_required_context" };
  }

  // The last chance to notice the world moved. A queued operation can wait
  // while the repository changes (§12).
  const head = await target.probe.getHead();
  if (head.commitSha !== prepared.baseSha) {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: "repository_changed",
    });
    return { ok: false, failureCode: "repository_changed" };
  }

  if (!(await target.probe.hasWritePermission())) {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: "github_write_permission_required",
    });
    return { ok: false, failureCode: "github_write_permission_required" };
  }

  // Route intelligence comes from the exact snapshot this preparation was
  // claimed against, not from "the latest". The snapshot id is part of the
  // execution identity, so reading a newer one here would let the same identity
  // produce different bytes — and silently reuse the earlier branch (§25).
  const snapshot = await getSnapshotById(deps.supabase, {
    snapshotId: prepared.repositorySnapshotId,
    projectId: operation.projectId,
  });
  if (!snapshot?.result) {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: "missing_required_context",
    });
    return { ok: false, failureCode: "missing_required_context" };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "generating_change" });
  const files = generateSeoFoundations({
    origin: target.productionOrigin,
    appRoot: target.appRoot,
    routes: snapshot.result.routes.routes,
  });

  await setOperationStage(deps.supabase, { operationId, stage: "writing_repository" });
  const write = await prepareChangeOnBranch(
    target.git,
    {
      owner: target.owner,
      repo: target.repo,
      baseBranch: prepared.baseBranch,
      baseSha: prepared.baseSha,
      branchName: prepared.branchName,
      capability: prepared.capability,
    },
    files,
  );

  if (!write.ok) {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: write.reason,
    });
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "change_preparation.failed",
      metadata: {
        projectId: operation.projectId,
        operationId,
        preparedChangeId: prepared.id,
        reason: write.reason,
      },
    });
    return { ok: false, failureCode: write.reason };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "verifying_repository" });
  await setOperationStage(deps.supabase, { operationId, stage: "persisting" });

  const persisted = await markPreparedChangePrepared(deps.supabase, {
    preparedChangeId: prepared.id,
    commitSha: write.commitSha,
    files: files.map((file) => ({ path: file.path, contentHash: file.contentHash, bytes: file.bytes })),
  });

  // Only emit the domain event when this call performed the transition, so a
  // replay produces no second completion (§26).
  if (persisted) {
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "change_preparation.completed",
      metadata: {
        projectId: operation.projectId,
        operationId,
        preparedChangeId: prepared.id,
        capability: prepared.capability,
        recovered: write.recovered,
        fileCount: files.length,
      },
    });
  }

  return { ok: true, preparedChangeId: prepared.id, commitSha: write.commitSha };
}

/** Step 3 — finish, idempotently. */
export async function completePreparationStep(
  deps: PreparationDeps,
  operationId: string,
  preparedChangeId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, {
    operationId,
    resultId: preparedChangeId,
  });
  if (!transitioned) return;

  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.completed",
    metadata: { projectId: operation.projectId, operationId, operationType: operation.operationType },
  });
}

export async function failPreparationStep(
  deps: PreparationDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  const prepared = await findPreparedChangeByOperation(deps.supabase, operationId);
  if (prepared && prepared.status === "preparing") {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: failureCode as ExecutionFailureCode,
    });
  }

  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned) return;

  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.failed",
    metadata: {
      projectId: operation.projectId,
      operationId,
      operationType: operation.operationType,
      reason: failureCode,
    },
  });
}
