import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  provisionPreviewWorkspace,
  startPreviewServer,
  teardownPreview,
  type PreviewTarget,
  type PreviewTeardown,
} from "@/modules/change-preview/orchestrator";
import {
  completePreviewSession,
  findPreviewByOperation,
  markPreviewRunning,
  markValidatedArtifactDeleted,
  recordPreviewSandboxUsage,
  setPreviewStage,
} from "@/modules/change-preview/store";
import {
  type PreviewFailureCode,
  type PreviewSession,
  type PreviewStage,
} from "@/modules/change-preview/schema";
import { getPreparedChange } from "@/modules/execution/store";
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
  /**
   * Rebuilt from the operation's own project — never from client input.
   *
   * The same port validation uses, and for the same reason: the repository and
   * its clone credential are the two things a client must have no way to name,
   * and a dependency the workflow supplies is how that becomes structural
   * rather than a rule someone remembers.
   *
   * `withCloneCredential` is requested only by the provisioning step. Nothing
   * else resolves a target at all — by the time the server starts there is
   * nothing left to authenticate to (rule 63).
   */
  resolveTarget: (
    operation: ProjectOperationRun,
    options: { withCloneCredential: boolean },
  ) => Promise<PreviewRepositoryTarget | null>;
};

export type PreviewRepositoryTarget = {
  repositoryUrl: string;
  /** The directory the provider clones into, i.e. the repository name. */
  sourceRoot: string;
  /**
   * A short-lived GitHub installation token, scoped to source acquisition only.
   *
   * Minted immediately before the clone and destroyed inside the sandbox before
   * any repository-controlled command runs. Never persisted, never placed in
   * the sandbox environment.
   */
  cloneCredential: { username: string; password: string } | null;
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
  options: { withCloneCredential: boolean } = { withCloneCredential: false },
): Promise<
  | { ok: true; operation: ProjectOperationRun; session: PreviewSession; target: PreviewTarget }
  | { ok: false; failureCode: PreviewFailureCode }
> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return { ok: false, failureCode: "preview_failed" };
  const { operation } = loaded;

  const session = await findPreviewByOperation(deps.supabase, operationId);
  if (!session) return { ok: false, failureCode: "preview_failed" };

  const prepared = await getPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    preparedChangeId: session.preparedChangeId,
  });
  if (!prepared || prepared.commitSha !== session.preparedCommitSha) {
    // Either the change is gone, or it now points at a different commit from
    // the one this session was claimed for. Both mean the same thing: there is
    // nothing here that may be served on a public URL.
    return { ok: false, failureCode: "preview_source_unavailable" };
  }

  // The repository *shape* — which workspace the app lives in, and which
  // package manager to install with. Read from the deterministic snapshot,
  // never from an Opportunity's prose or any other model output (rule 25).
  const snapshot = await getLatestSuccessfulSnapshot(deps.supabase, operation.projectId);
  if (!snapshot?.result) return { ok: false, failureCode: "preview_not_supported" };

  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, failureCode: "preview_not_supported" };

  /*
   * The repository to clone, the directory the provider will clone into, and —
   * only for the step that clones — the credential to clone with. Resolved from
   * server state, which is what makes "the client cannot choose the repo" a
   * structural fact rather than a validation rule.
   */
  const repository = await deps.resolveTarget(operation, options);
  if (!repository) return { ok: false, failureCode: "preview_not_supported" };

  return {
    ok: true,
    operation,
    session,
    target: {
      previewSessionId: session.id,
      preparedCommitSha: session.preparedCommitSha,
      repositoryUrl: repository.repositoryUrl,
      cloneCredential: repository.cloneCredential,
      packageManager: profile.packageManager,
      sourceRoot: repository.sourceRoot,
      workspaceRoot: profile.workspaceRoot,
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
 * Step 1 — acquire the source and install, before any repository code runs.
 *
 * The only billable-and-ambiguous operation in the run, alone in its own step
 * so that step can refuse retries without the refusal spreading to work which
 * is safe to repeat. A platform retry here could buy a second microVM, on a
 * second public URL, for a preview the first one may already be serving.
 *
 * It is also where the credential exists and stops existing. Everything after
 * this step runs with nothing to authenticate to.
 */
export async function provisionPreviewStep(
  deps: PreviewDeps,
  operationId: string,
): Promise<PreviewStepOutcome> {
  const resolved = await resolveContext(deps, operationId, { withCloneCredential: true });
  if (!resolved.ok) return resolved;
  const { operation, session, target } = resolved;

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "acquiring_source",
  });

  const outcome = await provisionPreviewWorkspace(deps.provider, target);
  if (!outcome.ok) return { ok: false, failureCode: outcome.failureCode };

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    previewSessionId: session.id,
    stage: "installing",
    runtime: outcome.runtime,
  });

  return { ok: true };
}

/**
 * Step 2 — start the development server and health-check it (§14, §17).
 *
 * The first repository-controlled code of the preview runs here, and only
 * because step 1 already established that the commit is the prepared commit,
 * the clone credential is gone, and the network is shut.
 *
 * The health probe is also the warm-up: a development server compiles the route
 * the first request asks for, which is why the budget is three minutes rather
 * than the ninety seconds a restored production build needed (Sprint 0114).
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
    stage: "starting_dev_server",
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

  const teardown = await teardownPreview(
    deps.provider,
    { previewSessionId: target.previewSessionId, snapshotId: session.artifactSnapshotId },
    { deleteArtifact: true },
  );

  if (teardown.artifactDeleted && session.validationRunId !== null) {
    // Only a v1 session has an artifact to mark. The ValidationRun stays
    // historically passed and the PreparedChange stays historically prepared
    // (§20).
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
