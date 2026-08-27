import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { teardownPreview } from "@/modules/change-preview/orchestrator";
import type {
  PreviewCleanupStatus,
  PreviewSession,
  TeardownReason,
} from "@/modules/change-preview/schema";
import {
  completePreviewSession,
  getPreviewSession,
  markPreviewArtifactDeleted,
  markValidatedArtifactDeleted,
  recordPreviewSandboxUsage,
} from "@/modules/change-preview/store";
import type { SandboxUsage } from "@/modules/validation/sandbox-port";
import { getProjectOperationRunById, completeOperationRun, setOperationStage } from "../store";
import type { PreviewDeps } from "./execution";

/**
 * Ending a preview, durably (Sprint 10B-3, after the first real dogfood).
 *
 * ## Why this moved out of the request
 *
 * ADR 0016 originally had teardown run inline: two provider calls and two
 * writes, comfortably under ADR 0013's "tens of seconds" threshold. The first
 * real stop showed that the threshold was the wrong test.
 *
 * `sandbox_usage_events` grants SELECT and nothing else — deliberately, because
 * a ledger the client can write is not a ledger. An inline stop runs in the
 * request with the cookie-scoped client, so its insert was refused by RLS and
 * swallowed by a best-effort `if (error) return`. The preview stopped, the
 * snapshot was deleted, and the provider spend was recorded nowhere.
 *
 * The real question was never how long teardown takes. It is whether it needs
 * the privileged writer. It does, and only durable execution may hold it
 * (CLAUDE.md rule 53), so teardown is durable execution.
 *
 * The alternatives were considered and refused: an owner INSERT policy would
 * make the ledger client-writable, and a service-role helper called from a
 * request would satisfy the module boundary as text while breaking what it is
 * for.
 *
 * ## Why the steps are split the way they are
 *
 * ```
 * 1. terminate    stop the sandbox, delete the snapshot   destructive, once
 * 2. record       write the ledger row                    retryable, idempotent
 * 3. converge     terminal PreviewSession + artifact      retryable, idempotent
 * ```
 *
 * **Cleanup outranks accounting.** If step 2 fails after step 1 has stopped the
 * sandbox, the sandbox stays stopped: nothing resurrects or retains a VM to
 * make the books balance. Step 2 retries on its own, and the unique index on
 * `sandbox_usage_events.preview_session_id` is what makes retrying safe — a
 * second insert loses at the database rather than double-counting a sandbox
 * that ran once.
 *
 * Step 1 is the only destructive one and is idempotent by construction:
 * stopping a stopped sandbox and deleting a deleted snapshot are the outcomes
 * it exists to produce. It still carries `maxRetries = 0`, because a platform
 * retry of a *provider* call is ambiguity we do not need — re-entry re-reads
 * the session and finds the work already done.
 */

export type TeardownRecord = {
  cleanup: PreviewCleanupStatus;
  runtime: string | null;
  sandboxDurationMs: number | null;
  usage: SandboxUsage | null;
  artifactDeleted: boolean;
};

async function loadSession(
  supabase: SupabaseClient,
  operationId: string,
): Promise<{ session: PreviewSession; userId: string; projectId: string } | null> {
  const operation = await getProjectOperationRunById(supabase, operationId);
  if (!operation?.subjectId) return null;

  const session = await getPreviewSession(supabase, {
    projectId: operation.projectId,
    previewSessionId: operation.subjectId,
  });
  if (!session) return null;

  // Ownership taken from the persisted operation row, because the service-role
  // client bypasses RLS entirely (ADR 0013, CLAUDE.md rule 53).
  return { session, userId: operation.userId, projectId: operation.projectId };
}

function elapsed(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Date.now() - started : null;
}

/**
 * Step 1 — stop the sandbox and delete the artifact snapshot.
 *
 * The only destructive step, and the only one whose failure modes cost money.
 * It runs first and unconditionally: a preview that is ending must stop being
 * billable before anything else is attempted, including the accounting for it.
 */
export async function terminatePreviewStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<TeardownRecord> {
  const loaded = await loadSession(deps.supabase, operationId);
  if (!loaded) {
    return {
      cleanup: "not_provisioned",
      runtime: null,
      sandboxDurationMs: null,
      usage: null,
      artifactDeleted: false,
    };
  }
  const { session, projectId, userId } = loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "cleaning_up", markRunning: true });

  const teardown = await teardownPreview(
    deps.provider,
    { previewSessionId: session.id, snapshotId: session.artifactSnapshotId },
    // Always. The artifact exists to serve a preview, and this preview is over
    // (ADR 0016 §11).
    { deleteArtifact: true },
  );

  if (!teardown.artifactDeleted) {
    await recordAuditEvent(deps.supabase, {
      userId,
      eventType: "change_preview.cleanup_incomplete",
      metadata: {
        projectId,
        previewSessionId: session.id,
        validationRunId: session.validationRunId,
        cleanup: teardown.cleanup,
      },
    });
  }

  return {
    cleanup: teardown.cleanup,
    runtime: teardown.runtime ?? session.runtime,
    sandboxDurationMs: elapsed(session.startedAt),
    usage: teardown.usage,
    artifactDeleted: teardown.artifactDeleted,
  };
}

/**
 * Step 2 — record what the preview cost.
 *
 * Retryable, and safe to retry because the database refuses a second row for
 * the same session. That index is the guarantee; this step merely tries.
 *
 * A failure here never reaches back into step 1. The sandbox is already
 * stopped and stays stopped — the books being incomplete is a smaller problem
 * than a paid VM kept alive to complete them.
 */
export async function recordPreviewUsageStep(
  deps: PreviewDeps,
  operationId: string,
  teardown: TeardownRecord,
): Promise<void> {
  const loaded = await loadSession(deps.supabase, operationId);
  if (!loaded) return;
  const { session, projectId, userId } = loaded;

  await recordPreviewSandboxUsage(deps.supabase, {
    projectId,
    userId,
    previewSessionId: session.id,
    provider: session.provider,
    runtime: teardown.runtime,
    // The preview itself succeeded or failed on its own terms; this row is
    // about the sandbox that ran, and it ran.
    status: session.failureCode === null ? "passed" : "failed",
    sandboxDurationMs: teardown.sandboxDurationMs,
    usage: teardown.usage,
    cleanupStatus: teardown.cleanup,
    failureCode: session.failureCode,
  });
}

/**
 * Step 3 — converge the session and the artifact to their terminal state.
 *
 * Last, deliberately. A session that still reads `stopping` while the sandbox
 * is gone is a recoverable inconsistency — a retry finishes it. A session
 * marked `stopped` before the sandbox actually stopped would be a lie the
 * system had no way to detect.
 */
export async function convergePreviewStep(
  deps: PreviewDeps,
  operationId: string,
  teardown: TeardownRecord,
): Promise<void> {
  const loaded = await loadSession(deps.supabase, operationId);
  if (!loaded) return;
  const { session, projectId, userId } = loaded;

  // The reason the initiator persisted, not one inferred here. A manual stop
  // made seconds before the deadline would otherwise converge, after queue
  // latency, as an expiry.
  const reason: TeardownReason = session.teardownReason ?? "stopped";

  const persisted = await completePreviewSession(deps.supabase, {
    previewSessionId: session.id,
    projectId,
    status: reason,
    failureCode: session.failureCode,
    cleanupStatus: teardown.cleanup,
    artifactDeleted: teardown.artifactDeleted,
  });

  // Idempotent on its own terms: scoped to a row whose deletion is still
  // outstanding, so a replay after a successful convergence changes nothing.
  if (teardown.artifactDeleted) {
    await markPreviewArtifactDeleted(deps.supabase, {
      previewSessionId: session.id,
      projectId,
    });
    // The artifact, not the run. The ValidationRun stays historically `passed`
    // and the PreparedChange stays `prepared` (ADR 0016 §11).
    await markValidatedArtifactDeleted(deps.supabase, {
      validationRunId: session.validationRunId,
      projectId,
    });
  }

  if (persisted) {
    await recordAuditEvent(deps.supabase, {
      userId,
      eventType: reason === "expired" ? "change_preview.expired" : "change_preview.stopped",
      metadata: {
        projectId,
        previewSessionId: session.id,
        validationRunId: session.validationRunId,
        cleanup: teardown.cleanup,
        artifactDeleted: teardown.artifactDeleted,
      },
    });
  }

  await completeOperationRun(deps.supabase, { operationId, resultId: session.id });
}
