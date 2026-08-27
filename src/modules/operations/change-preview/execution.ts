import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  restoreValidatedArtifact,
  startPreviewServer,
  teardownPreview,
  verifyRestoredArtifact,
  type PreviewTarget,
  type PreviewTeardown,
} from "@/modules/change-preview/orchestrator";
import {
  completePreviewSession,
  findPreviewByOperation,
  getValidatedArtifact,
  getValidationSourceIntegrity,
  markPreviewRunning,
  markValidatedArtifactDeleted,
  recordPreviewSandboxUsage,
  setPreviewStage,
} from "@/modules/change-preview/store";
import {
  isPreviewExpired,
  type PreviewFailureCode,
  type PreviewSession,
  type PreviewStage,
} from "@/modules/change-preview/schema";
import { getPreparedChange } from "@/modules/execution/store";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { resolveValidationProfile } from "@/modules/validation/profile";
import type { SandboxProvider } from "@/modules/validation/sandbox-port";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { OperationFailureCode } from "../failures";
import {
  completeOperationRun,
  failOperationRun,
  getProjectOperationRunById,
  setOperationStage,
  type ProjectOperationRun,
} from "../store";

/**
 * Durable steps for a temporary change preview (Sprint 10B-2 §23).
 *
 * ## The step graph
 *
 * ```
 * restore ─▶ verify ─▶ start+health ─▶ complete
 *    │          │            │
 *    └──────────┴────────────┴────▶ cleanup ─▶ abort
 * ```
 *
 * Shorter than validation's, and deliberately so. Validation is six
 * repository-controlled commands each racing a platform ceiling; a preview
 * restores a filesystem, checks it, and starts one server that is already
 * built. The one step that could plausibly run long — boot plus health — has a
 * 90-second budget inside a 300-second ceiling.
 *
 * ## Why start and health are one step
 *
 * A detached process handle cannot cross a durable step boundary without either
 * serializing provider connection material into a third-party log (refused,
 * CLAUDE.md rule 52) or re-deriving it through an SDK method marked internal.
 * So the server is started and watched in one invocation, and re-entry is made
 * safe by a property that needs no handle: **if the port already answers, the
 * work is done**. A replay never starts a second server.
 *
 * ## What a completed operation means
 *
 * The operation reaches `completed` when the PreviewSession becomes `running` —
 * that is, when the restored artifact answered a health check on the exposed
 * port. From that moment the session owns its own TTL, and the operation has no
 * further part in it. An operation that stayed open for the preview's lifetime
 * would be a fifteen-minute workflow doing nothing.
 *
 * Nothing in this file calls a model, and no `ai_usage_events` row is written —
 * none is earned. Sandbox spend goes to its own ledger (§27).
 */

export type PreviewDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The sandbox provider.
   *
   * Injected so tests can supply a fake that executes nothing and exposes no
   * port. There is no local-execution implementation and there must never be
   * one (ADR 0015 §4).
   */
  provider: SandboxProvider;
};

export type PreviewStepOutcome = { ok: true } | { ok: false; failureCode: PreviewFailureCode };

async function loadOperation(
  supabase: SupabaseClient,
  operationId: string,
): Promise<{ ok: true; operation: ProjectOperationRun } | { ok: false }> {
  const operation = await getProjectOperationRunById(supabase, operationId);
  if (!operation) return { ok: false };

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", operation.projectId)
    .maybeSingle();

  if (!project || (project as { user_id: string }).user_id !== operation.userId) {
    return { ok: false };
  }

  return { ok: true, operation };
}

/**
 * Everything a preview step needs, rebuilt from persisted state (§7).
 *
 * The one place the world is re-derived, so each step is a short function about
 * its phase. Nothing comes from client input: not the snapshot, not the port,
 * not the command, not the network policy. A step receives an operation id.
 *
 * Ownership is asserted at every hop — the operation's project, the project's
 * owner, the session scoped to that project, and the artifact scoped to it
 * again — because the service-role client bypasses RLS entirely.
 */
async function resolveContext(
  deps: PreviewDeps,
  operationId: string,
): Promise<
  | { ok: true; operation: ProjectOperationRun; session: PreviewSession; target: PreviewTarget }
  | { ok: false; failureCode: PreviewFailureCode }
> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return { ok: false, failureCode: "preview_failed" };
  const { operation } = loaded;

  const session = await findPreviewByOperation(deps.supabase, operationId);
  if (!session) return { ok: false, failureCode: "preview_failed" };

  const artifact = await getValidatedArtifact(deps.supabase, {
    projectId: operation.projectId,
    validatedArtifactId: session.validationRunId,
  });
  if (!artifact) return { ok: false, failureCode: "preview_artifact_unavailable" };

  const prepared = await getPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    preparedChangeId: session.preparedChangeId,
  });
  if (!prepared) return { ok: false, failureCode: "preview_artifact_unavailable" };

  // The repository *shape* — which workspace the app lives in. Read from the
  // deterministic snapshot, never from an Opportunity's prose or any other
  // model output (CLAUDE.md rule 25).
  const snapshot = await getLatestSuccessfulSnapshot(deps.supabase, operation.projectId);
  if (!snapshot?.result) return { ok: false, failureCode: "preview_not_supported" };

  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, failureCode: "preview_not_supported" };

  // The directory the provider cloned into during validation, preserved inside
  // the snapshot. Taken from the connection table rather than from analysis
  // output, for the same reason validation takes it from there: it is the one
  // record of which repository this project actually is.
  const project = await getProjectWithRepository(deps.supabase, operation.projectId);
  const repositoryName = project?.repository?.name;
  if (!repositoryName) return { ok: false, failureCode: "preview_not_supported" };

  const integrity = await getValidationSourceIntegrity(deps.supabase, {
    projectId: operation.projectId,
    validationRunId: session.validationRunId,
  });

  return {
    ok: true,
    operation,
    session,
    target: {
      previewSessionId: session.id,
      // Resolved from the owned artifact row. There is no parameter through
      // which a client could name a snapshot (§9).
      snapshotId: session.artifactSnapshotId,
      sourceRoot: repositoryName,
      workspaceRoot: profile.workspaceRoot,
      preparedFiles: prepared.files.map((file) => ({
        path: file.path,
        contentHash: file.contentHash,
      })),
      buildIdentityFiles: Object.entries(integrity?.buildIdentityDigests ?? {}).map(
        ([path, contentHash]) => ({ path, contentHash }),
      ),
    },
  };
}

/** Progress on both rows. Best-effort: a status write must never stop a preview. */
async function announceStage(
  deps: PreviewDeps,
  params: {
    operationId: string;
    projectId: string;
    previewSessionId: string;
    stage: PreviewStage;
    runtime?: string | null;
  },
): Promise<void> {
  try {
    await setPreviewStage(deps.supabase, {
      previewSessionId: params.previewSessionId,
      projectId: params.projectId,
      stage: params.stage,
      ...(params.runtime !== undefined ? { runtime: params.runtime } : {}),
    });
    await setOperationStage(deps.supabase, { operationId: params.operationId, stage: params.stage });
  } catch {
    return;
  }
}

/**
 * Step 1 — restore the validated artifact into a fresh sandbox (§9, §10).
 *
 * The only billable-and-ambiguous operation in the run, alone in its own step
 * so that step can refuse retries without the refusal spreading to work which
 * is safe to repeat. A platform retry here could buy a second microVM, on a
 * second public URL, for a preview the first one may already be serving.
 *
 * The artifact deadline is re-checked here even though the service checked it
 * before creating the operation. Between the two there is a queue, and a
 * deadline that passed in the meantime must not be discovered by asking the
 * provider to restore something that is gone (§10).
 */
export async function restoreArtifactStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<PreviewStepOutcome> {
  const resolved = await resolveContext(deps, operationId);
  if (!resolved.ok) return resolved;
  const { operation, session, target } = resolved;

  const artifact = await getValidatedArtifact(deps.supabase, {
    projectId: operation.projectId,
    validatedArtifactId: session.validationRunId,
  });
  if (!artifact) return { ok: false, failureCode: "preview_artifact_unavailable" };
  if (isPreviewExpired({ expiresAt: artifact.expiresAt })) {
    return { ok: false, failureCode: "preview_artifact_expired" };
  }

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "restoring_artifact",
  });

  const outcome = await restoreValidatedArtifact(deps.provider, target);
  if (!outcome.ok) return { ok: false, failureCode: outcome.failureCode };

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "restoring_artifact",
    runtime: outcome.runtime,
  });

  return { ok: true };
}

/**
 * Step 2 — prove the restored filesystem is the validated one (§11, §12).
 *
 * Read-only and idempotent, so it is safe to re-enter — but not to platform-
 * retry, because a retry runs inside a sandbox whose liveness it cannot assume.
 * Recovery is re-entry against persisted state, not repetition.
 */
export async function verifyArtifactStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<PreviewStepOutcome> {
  const resolved = await resolveContext(deps, operationId);
  if (!resolved.ok) return resolved;
  const { operation, session, target } = resolved;

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "verifying_artifact",
  });

  const outcome = await verifyRestoredArtifact(deps.provider, target);
  if (!outcome.ok) {
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "change_preview.integrity_failed",
      metadata: {
        projectId: operation.projectId,
        operationId,
        previewSessionId: session.id,
        validationRunId: session.validationRunId,
        failureCode: outcome.failureCode,
        // The detail, not the origin: an audit event must never carry the
        // capability-like preview URL (§16).
        failureDetail: outcome.failureDetail,
      },
    });
    return { ok: false, failureCode: outcome.failureCode };
  }

  return { ok: true };
}

/**
 * Step 3 — start the production server and health-check it (§14, §17).
 *
 * The first repository-controlled code of the preview runs here, and only
 * because steps 1 and 2 already established that the bytes are the validated
 * bytes and the environment holds nothing of value.
 */
export async function startPreviewStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<PreviewStepOutcome> {
  const resolved = await resolveContext(deps, operationId);
  if (!resolved.ok) return resolved;
  const { operation, session, target } = resolved;

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "starting_server",
  });

  const outcome = await startPreviewServer(deps.provider, target);

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "checking_preview",
  });

  if (!outcome.ok) return { ok: false, failureCode: outcome.failureCode };

  // `outcome.origin` is deliberately dropped here. It is capability-like and is
  // re-fetched from the provider on an authorized read; persisting or logging
  // it would put an unlisted public URL to a VM serving untrusted code into a
  // place that outlives the preview (§16).
  const transitioned = await markPreviewRunning(deps.supabase, {
    previewSessionId: session.id,
    projectId: operation.projectId,
    runtime: outcome.runtime,
  });

  if (transitioned) {
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "change_preview.running",
      metadata: {
        projectId: operation.projectId,
        operationId,
        previewSessionId: session.id,
        validationRunId: session.validationRunId,
        preparedChangeId: session.preparedChangeId,
        port: outcome.port,
        expiresAt: session.expiresAt,
      },
    });
  }

  return { ok: true };
}

/**
 * Step 4 — clean up a preview that failed to start (§19, §33).
 *
 * Runs on the failure path only. A *successful* preview must keep its sandbox
 * running — that sandbox is the preview — and keeps its snapshot until the
 * session ends, because the session is what the snapshot exists to serve.
 *
 * A terminal start failure is the opposite: the sandbox has no purpose and the
 * artifact has no consumer, so both go. Safe to retry, and one of the few steps
 * that should be: stopping a stopped sandbox and deleting a deleted snapshot
 * are the outcomes this exists to produce.
 */
export async function cleanupFailedPreviewStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<PreviewTeardown> {
  const resolved = await resolveContext(deps, operationId);
  if (!resolved.ok) {
    return { cleanup: "not_provisioned", usage: null, runtime: null, artifactDeleted: false };
  }
  const { operation, session, target } = resolved;

  const teardown = await teardownPreview(deps.provider, target, { deleteArtifact: true });

  if (teardown.artifactDeleted) {
    // The artifact, not the run. The ValidationRun stays historically passed
    // and the PreparedChange stays historically prepared (§20).
    await markValidatedArtifactDeleted(deps.supabase, {
      validationRunId: session.validationRunId,
      projectId: operation.projectId,
    });
  }

  return teardown;
}

/**
 * Step 5 — record the terminal outcome.
 *
 * Reads the session from the database rather than receiving it through the
 * durable log, so the answer is independent of how many times the workflow was
 * resumed on the way here.
 */
export async function failPreviewStep(
  deps: PreviewDeps,
  operationId: string,
  failureCode: PreviewFailureCode,
  teardown: PreviewTeardown,
): Promise<void> {
  const loaded = await loadOperation(deps.supabase, operationId);
  const session = await findPreviewByOperation(deps.supabase, operationId);

  if (loaded.ok && session) {
    const { operation } = loaded;

    const persisted = await completePreviewSession(deps.supabase, {
      previewSessionId: session.id,
      projectId: operation.projectId,
      status: "failed",
      failureCode,
      // A cleanup failure is recorded and never allowed to replace the reason
      // the preview failed: the user asked why their preview did not work, and
      // "we could not delete a snapshot" is not that answer (§19).
      cleanupStatus: teardown.cleanup,
      artifactDeleted: teardown.artifactDeleted,
    });

    if (persisted) {
      await recordPreviewSandboxUsage(deps.supabase, {
        projectId: operation.projectId,
        userId: operation.userId,
        previewSessionId: session.id,
        provider: deps.provider.id,
        runtime: teardown.runtime ?? session.runtime,
        status: "failed",
        sandboxDurationMs: elapsedSince(session.startedAt),
        usage: teardown.usage,
        cleanupStatus: teardown.cleanup,
        failureCode,
      });

      await recordAuditEvent(deps.supabase, {
        userId: operation.userId,
        eventType: "change_preview.failed",
        metadata: {
          projectId: operation.projectId,
          operationId,
          previewSessionId: session.id,
          validationRunId: session.validationRunId,
          failureCode,
          cleanup: teardown.cleanup,
          artifactDeleted: teardown.artifactDeleted,
        },
      });
    }
  }

  const transitioned = await failOperationRun(deps.supabase, {
    operationId,
    failureCode: failureCode satisfies OperationFailureCode,
  });
  if (!transitioned) return;

  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.failed",
    metadata: { projectId: operation.projectId, operationId, failureCode },
  });
}

/** Step 6 — finish, idempotently. The session now owns its own TTL. */
export async function completePreviewStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<void> {
  const session = await findPreviewByOperation(deps.supabase, operationId);
  if (!session) return;

  const transitioned = await completeOperationRun(deps.supabase, {
    operationId,
    resultId: session.id,
  });
  if (!transitioned) return;

  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.completed",
    metadata: {
      projectId: operation.projectId,
      operationId,
      operationType: operation.operationType,
    },
  });
}

/**
 * Wall time since the session was claimed.
 *
 * The closest honest bound on how long the sandbox could have existed. The
 * provider's Active CPU figure is the billing-relevant number and is recorded
 * separately, never derived from this.
 */
function elapsedSince(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Date.now() - started : null;
}
