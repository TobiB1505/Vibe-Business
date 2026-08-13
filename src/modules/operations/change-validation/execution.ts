import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange } from "@/modules/execution/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { computeValidationIdentity } from "@/modules/validation/identity";
import {
  runValidation,
  type SourceManifestPort,
  type ValidationTarget,
} from "@/modules/validation/orchestrator";
import { resolveValidationProfile } from "@/modules/validation/profile";
import type { SandboxProvider } from "@/modules/validation/sandbox-port";
import {
  SANDBOX_POLICY_VERSION,
  validationProfileVersionFor,
  type ValidationFailureCode,
} from "@/modules/validation/schema";
import {
  claimValidationRun,
  completeValidationRun,
  findValidationRunByOperation,
  recordSandboxUsage,
  setValidationStage,
} from "@/modules/validation/store";
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
 * Durable steps for isolated change validation (Sprint 10A §20).
 *
 * The fourth operation type on the Sprint 7 foundation, and the first that
 * spends *infrastructure* rather than inference. That difference shapes the
 * step boundaries:
 *
 *  - A repeated AI call double-bills a token count. A repeated sandbox run
 *    provisions a second microVM, so the claim happens before any provisioning
 *    and the execute step never retries (`maxRetries = 0` in the workflow).
 *  - The sandbox itself must be torn down on every path. `runValidation` owns
 *    that in a `finally`-shaped helper, so even a persistence failure here
 *    cannot leave a paid VM running (§23).
 *
 * Nothing in this file calls a model, and no `ai_usage_events` row is written —
 * none is earned. Sandbox spend goes to its own ledger (§25).
 */

export type ValidationDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The sandbox provider.
   *
   * Injected so tests can supply a fake that executes nothing. There is no
   * local-execution implementation and there must never be one (§4).
   */
  provider: SandboxProvider;
  /** Rebuilt from the operation's own project — never from client input. */
  resolveTarget: (operation: StoredOperationRun) => Promise<ValidationRepositoryTarget | null>;
};

export type ValidationRepositoryTarget = {
  repositoryUrl: string;
  /**
   * Resolves file bytes from GitHub at an exact commit.
   *
   * Used to verify the build identity against the pinned revision, which is
   * what replaced the `git rev-parse` check the provider cannot support.
   */
  manifest: SourceManifestPort;
  /**
   * A short-lived GitHub installation token, scoped to source acquisition only.
   *
   * Minted immediately before the clone and destroyed inside the sandbox
   * before any repository-controlled command runs. Never persisted, never
   * placed in the sandbox environment (§7).
   */
  cloneCredential: { username: string; password: string } | null;
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
 * Step 1 — establish eligibility and claim the run. No sandbox yet.
 *
 * Everything that can refuse without spending money refuses here (§34).
 */
export async function prepareValidationStep(
  deps: ValidationDeps,
  operationId: string,
): Promise<StepOutcome<{ validationRunId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  // A replay after the claim: reuse rather than claiming twice.
  const existing = await findValidationRunByOperation(deps.supabase, operationId);
  if (existing) return { ok: true, validationRunId: existing.id };

  await setOperationStage(deps.supabase, { operationId, stage: "preparing", markRunning: true });

  if (!operation.subjectId) return { ok: false, failureCode: "missing_required_context" };

  const prepared = await getPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    preparedChangeId: operation.subjectId,
  });
  if (!prepared) return { ok: false, failureCode: "prepared_change_not_ready" };

  // Only a completed preparation has a commit to validate.
  if (prepared.status !== "prepared" || prepared.commitSha === null) {
    return { ok: false, failureCode: "prepared_change_not_ready" };
  }

  // Validation is artifact-centric (§28): the snapshot is consulted for the
  // repository's *shape* — framework, package manager, workspace layout —
  // never to decide whether the artifact is still current. A prepared commit
  // stays validatable after newer intelligence arrives.
  const snapshot = await getLatestSuccessfulSnapshot(deps.supabase, operation.projectId);
  if (!snapshot?.result) return { ok: false, failureCode: "validation_not_supported" };

  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, failureCode: profile.reason };

  const identity = computeValidationIdentity({
    preparedChangeId: prepared.id,
    preparedCommitSha: prepared.commitSha,
    validationProfile: profile.profile,
    validationProfileVersion: validationProfileVersionFor(profile.profile),
    sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
  });

  const claim = await claimValidationRun(deps.supabase, {
    projectId: operation.projectId,
    userId: operation.userId,
    preparedChangeId: prepared.id,
    operationRunId: operationId,
    validationProfile: profile.profile,
    validationProfileVersion: validationProfileVersionFor(profile.profile),
    sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
    sandboxProvider: deps.provider.id,
    packageManager: profile.packageManager,
    preparedCommitSha: prepared.commitSha,
    validationIdentity: identity,
  });

  if (!claim.ok) {
    return {
      ok: false,
      failureCode: claim.error === "already_active" ? "already_running" : "validation_run_failed",
    };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: claim.validationRun.id });

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "change_validation.started",
    metadata: {
      projectId: operation.projectId,
      operationId,
      validationRunId: claim.validationRun.id,
      preparedChangeId: prepared.id,
      profile: profile.profile,
      sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
    },
  });

  return { ok: true, validationRunId: claim.validationRun.id };
}

/**
 * Step 2 — provision, validate, tear down, persist.
 *
 * One step on purpose. Splitting provisioning from teardown would create a
 * window where a paid microVM exists that nothing is responsible for stopping.
 */
export async function executeValidationStep(
  deps: ValidationDeps,
  operationId: string,
): Promise<StepOutcome<{ validationRunId: string; status: "passed" | "failed" }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  const run = await findValidationRunByOperation(deps.supabase, operationId);
  if (!run) return { ok: false, failureCode: "validation_run_failed" };

  // A replay of a step that already finished.
  if (run.status === "passed" || run.status === "failed") {
    return { ok: true, validationRunId: run.id, status: run.status };
  }

  const prepared = await getPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    preparedChangeId: run.preparedChangeId,
  });
  if (!prepared || prepared.commitSha === null) {
    return { ok: false, failureCode: "prepared_change_not_ready" };
  }

  const target = await deps.resolveTarget(operation);
  if (!target) return { ok: false, failureCode: "repository_connection_invalid" };

  const snapshot = await getLatestSuccessfulSnapshot(deps.supabase, operation.projectId);
  if (!snapshot?.result) return { ok: false, failureCode: "validation_not_supported" };
  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, failureCode: profile.reason };

  const validationTarget: ValidationTarget = {
    preparedChangeId: prepared.id,
    preparedCommitSha: prepared.commitSha,
    repositoryUrl: target.repositoryUrl,
    cloneCredential: target.cloneCredential,
    profile: profile.profile,
    packageManager: profile.packageManager,
    workspaceRoot: profile.workspaceRoot,
    preparedFiles: prepared.files.map((file) => ({ path: file.path, contentHash: file.contentHash })),
    validationRunId: run.id,
  };

  const outcome = await runValidation(deps.provider, target.manifest, validationTarget, {
    // Stage updates are best-effort progress reporting for a page the user may
    // have left. A failed status write must never abort a running sandbox.
    onStage: async (stage) => {
      try {
        await setValidationStage(deps.supabase, {
          validationRunId: run.id,
          projectId: operation.projectId,
          stage,
        });
        await setOperationStage(deps.supabase, { operationId, stage });
      } catch {
        return;
      }
    },
  });

  // The sandbox is already stopped by this point, whatever happens below.
  await recordSandboxUsage(deps.supabase, {
    projectId: operation.projectId,
    userId: operation.userId,
    validationRunId: run.id,
    provider: deps.provider.id,
    runtime: outcome.sandboxRuntime,
    status: outcome.status,
    sandboxDurationMs: outcome.sandboxDurationMs,
    usage: outcome.usage,
    cleanupStatus: outcome.cleanup,
    failureCode: outcome.failureCode,
    failureDetail: outcome.failureDetail,
  });

  const persisted = await completeValidationRun(deps.supabase, {
    validationRunId: run.id,
    projectId: operation.projectId,
    status: outcome.status,
    stage: outcome.status === "passed" ? "completed" : outcome.stage,
    steps: outcome.steps,
    failureCode: outcome.failureCode,
    failureDetail: outcome.failureDetail,
    sandboxRuntime: outcome.sandboxRuntime,
    sandboxDurationMs: outcome.sandboxDurationMs,
    cleanupStatus: outcome.cleanup,
    sourceIntegrity: outcome.sourceIntegrity,
  });

  if (persisted) {
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: outcome.status === "passed" ? "change_validation.passed" : "change_validation.failed",
      metadata: {
        projectId: operation.projectId,
        operationId,
        validationRunId: run.id,
        preparedChangeId: prepared.id,
        failureCode: outcome.failureCode,
        cleanup: outcome.cleanup,
        failureDetail: outcome.failureDetail,
        sandboxDurationMs: outcome.sandboxDurationMs,
      },
    });
  }

  if (outcome.status === "failed") {
    return {
      ok: false,
      failureCode: (outcome.failureCode ?? "validation_run_failed") as ValidationFailureCode,
    };
  }

  return { ok: true, validationRunId: run.id, status: "passed" };
}

/** Step 3 — finish, idempotently. */
export async function completeValidationStep(
  deps: ValidationDeps,
  operationId: string,
  validationRunId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, {
    operationId,
    resultId: validationRunId,
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

export async function failValidationStep(
  deps: ValidationDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  // A run claimed but never completed — the sandbox step died outside the
  // returned-failure convention. Close the row so the UI is not left waiting.
  const run = await findValidationRunByOperation(deps.supabase, operationId);
  if (run && (run.status === "running" || run.status === "queued")) {
    const operation = await getOperationRunById(deps.supabase, operationId);
    if (operation) {
      await completeValidationRun(deps.supabase, {
        validationRunId: run.id,
        projectId: operation.projectId,
        status: "failed",
        stage: run.stage,
        steps: run.steps,
        failureCode: (failureCode as ValidationFailureCode) ?? "validation_run_failed",
        failureDetail: "the validation step ended without recording a result",
        sourceIntegrity: run.sourceIntegrity,
        sandboxRuntime: run.sandboxRuntime,
        sandboxDurationMs: run.sandboxDurationMs,
        cleanupStatus: run.cleanupStatus ?? "not_provisioned",
      });
    }
  }

  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned) return;

  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.failed",
    metadata: { projectId: operation.projectId, operationId, failureCode },
  });
}
