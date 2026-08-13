import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  createOperationRun,
  findActiveOperationByIdentity,
  getOperationRunById,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import type { SandboxProvider } from "@/modules/validation/sandbox-port";
import { PREVIEW_BUDGETS } from "./budgets";
import { computePreviewIdentity } from "./identity";
import { resolvePreviewOrigin, teardownPreview } from "./orchestrator";
import {
  PREVIEW_POLICY_VERSION,
  isPreviewExpired,
  previewProfileFor,
  previewProfileVersionFor,
  type PreviewFailureCode,
  type PreviewSession,
  type PreviewStatus,
} from "./schema";
import {
  claimPreviewSession,
  completePreviewSession,
  findActivePreviewByIdentity,
  getPreviewSession,
  getValidatedArtifact,
  markPreviewArtifactDeleted,
  markValidatedArtifactDeleted,
  recordPreviewSandboxUsage,
} from "./store";

/**
 * Starting, reading and stopping a preview (Sprint 10B-2 §7, §8, §21, §24, §25).
 *
 * ## What the client is allowed to say
 *
 * Three things: which project, which validated artifact, and an explicit
 * confirmation that a public URL may be published.
 *
 * The client cannot choose the snapshot, the sandbox, the provider, the port,
 * the server command, the network policy, the environment, the TTL, the
 * repository, the commit, or the preview domain. Not because those are
 * validated and rejected — because they are not accepted. Every one is derived
 * from server state inside the durable step, from an operation id. A parameter
 * that does not exist cannot be tampered with.
 *
 * ## Why the confirmation is here and not only in the UI
 *
 * A preview publishes an unlisted public URL serving the customer's
 * application. That is a category of consequence a product must not take on a
 * user's behalf by inference, and a confirmation that lives only in a component
 * is a confirmation that a second caller — a future API route, a script, a
 * different page — silently skips.
 *
 * So the requirement is load-bearing on the server: without it there is zero
 * sandbox creation, zero exposed port and zero provider spend, and the check
 * sits **before** the operation is created rather than inside the workflow.
 * 10B-3 will present it; it already exists without a UI.
 */

export type StartPreviewParams = {
  projectId: string;
  userId: string;
  /**
   * The ValidatedArtifact to preview.
   *
   * Its id is the validation run that captured it — capture is strictly one per
   * passing run. Resolved against the caller's project, so another tenant's
   * artifact is invisible rather than forbidden.
   */
  validatedArtifactId: string;
  /**
   * Explicit acknowledgement that a public, unlisted URL will be published.
   *
   * Not a default, not inferred from the request, and not satisfied by the
   * caller merely being authenticated (§8).
   */
  confirmPublicExposure: boolean;
};

export type StartPreviewOutcome =
  | { kind: "starting"; operation: OperationView; previewSessionId: string }
  /** This exact preview is already live. Never a second sandbox (§22). */
  | { kind: "reused"; previewSessionId: string; status: PreviewStatus }
  | { kind: "running"; operation: OperationView }
  | { kind: "failed"; error: PreviewFailureCode | "project_not_found" | "execution_start_failed" };

function view(operation: StoredOperationRun): OperationView {
  return buildOperationView({
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failureCode: operation.failureCode,
    resultId: operation.resultId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    createdAt: operation.createdAt,
  });
}

async function ownsProject(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<boolean> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Everything checkable before a cent of infrastructure is spent (§21).
 *
 * Ordered cheapest-first, and every branch returns without creating anything.
 * The order is not cosmetic: the confirmation check needs no database read at
 * all, and the artifact-expiry check needs one row — neither should cost a
 * provider call to discover.
 */
export async function startChangePreview(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartPreviewParams,
): Promise<StartPreviewOutcome> {
  if (!(await ownsProject(supabase, params))) {
    return { kind: "failed", error: "project_not_found" };
  }

  // Before anything else. A missing confirmation must not be discoverable only
  // after a sandbox exists.
  if (params.confirmPublicExposure !== true) {
    return { kind: "failed", error: "preview_exposure_not_confirmed" };
  }

  const artifact = await getValidatedArtifact(supabase, {
    projectId: params.projectId,
    validatedArtifactId: params.validatedArtifactId,
  });

  // Scoped to the project and to a *passing* run, so a failed validation, a
  // run with no captured artifact, an already-deleted artifact and another
  // tenant's artifact are all the same answer: there is nothing here.
  if (!artifact) return { kind: "failed", error: "preview_artifact_unavailable" };

  // Checked against Vibe's own recorded deadline rather than discovered by
  // asking the provider to restore something that is gone (§10).
  if (isPreviewExpired({ expiresAt: artifact.expiresAt })) {
    return { kind: "failed", error: "preview_artifact_expired" };
  }

  // Derived from the validation profile that produced the artifact — never from
  // an Opportunity's prose or any other model output (§3).
  const previewProfile = previewProfileFor(artifact.validationProfile);
  if (!previewProfile) return { kind: "failed", error: "preview_not_supported" };

  const identity = computePreviewIdentity({
    projectId: params.projectId,
    preparedChangeId: artifact.preparedChangeId,
    validationRunId: artifact.validationRunId,
    artifactSnapshotId: artifact.snapshotId,
    preparedCommitSha: artifact.preparedCommitSha,
    previewProfile,
    previewProfileVersion: previewProfileVersionFor(previewProfile),
    previewPolicyVersion: PREVIEW_POLICY_VERSION,
  });

  // Cheapest answer: this exact preview is already live under this exact
  // policy, so a second sandbox would serve the same bytes on a second URL.
  const active = await findActivePreviewByIdentity(supabase, {
    projectId: params.projectId,
    previewIdentity: identity,
  });
  if (active && !isPreviewExpired(active)) {
    return { kind: "reused", previewSessionId: active.id, status: active.status };
  }

  // Second cheapest: the workflow is already in flight. Return the live
  // operation rather than queueing a duplicate.
  const running = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "change_preview",
    inputIdentity: identity,
  });
  if (running) return { kind: "running", operation: view(running) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "change_preview",
    inputIdentity: identity,
    subjectId: artifact.validationRunId,
  });

  if (!created.ok) {
    // Lost the race against a concurrent click — the unique index caught the
    // second insert. Show the winner's operation: the work the user asked for
    // is happening.
    if (created.error === "already_active") {
      const winner = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "change_preview",
        inputIdentity: identity,
      });
      if (winner) return { kind: "running", operation: view(winner) };
    }
    return { kind: "failed", error: "preview_failed" };
  }

  const claim = await claimPreviewSession(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    preparedChangeId: artifact.preparedChangeId,
    validationRunId: artifact.validationRunId,
    operationRunId: created.operation.id,
    artifactSnapshotId: artifact.snapshotId,
    previewProfile,
    previewProfileVersion: previewProfileVersionFor(previewProfile),
    previewPolicyVersion: PREVIEW_POLICY_VERSION,
    provider: "vercel_sandbox",
    // Vibe's port, from the policy. There is no parameter to override it (§14).
    port: PREVIEW_BUDGETS.port,
    previewIdentity: identity,
    // Persisted at claim time, so the deadline exists before the sandbox does.
    // A TTL written after a successful start would not bound a preview that
    // started and then lost its workflow (§18).
    expiresAt: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
  });

  if (!claim.ok) {
    // The operation exists with no session behind it. Close it rather than
    // leaving the identity's unique index blocked by a run that will never
    // happen.
    await supabase
      .from("operation_runs")
      .update({
        status: "failed",
        failure_code: "preview_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", created.operation.id);

    return { kind: "failed", error: "preview_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_preview.started",
    metadata: {
      projectId: params.projectId,
      operationId: created.operation.id,
      previewSessionId: claim.session.id,
      validationRunId: artifact.validationRunId,
      preparedChangeId: artifact.preparedChangeId,
      previewProfile,
      previewPolicyVersion: PREVIEW_POLICY_VERSION,
      // Recorded because the user consented to a public URL and an audit log is
      // where that consent belongs. The URL itself never appears here (§16).
      publicExposureConfirmed: true,
      expiresAt: claim.session.expiresAt,
    },
  });

  const started = await executor.start({
    operationId: created.operation.id,
    operationType: "change_preview",
  });

  if (!started.ok) return { kind: "failed", error: "execution_start_failed" };

  const refreshed = await getOperationRunById(supabase, created.operation.id);
  return {
    kind: "starting",
    operation: view(refreshed ?? created.operation),
    previewSessionId: claim.session.id,
  };
}

/**
 * What an authorized reader may know about a preview (§16, §25).
 *
 * The origin is present only while the preview is genuinely live, and it is
 * fetched from the provider on this read rather than stored. A session past its
 * deadline never returns one, whatever the provider still thinks.
 */
export type PreviewView = {
  previewSessionId: string;
  status: PreviewStatus;
  stage: PreviewSession["stage"];
  failureCode: PreviewFailureCode | null;
  expiresAt: string;
  readyAt: string | null;
  port: number;
  /** Present only for a live, unexpired preview. Never persisted. */
  origin: string | null;
  /**
   * What this preview establishes, stated rather than implied.
   *
   * Carried in the view so no surface can render a preview as approval by
   * omission (§2, CLAUDE.md rule 66).
   */
  verdict: "preview_available" | null;
};

/**
 * Reads one preview, converging its state on the way past (§25).
 *
 * ## How expiry actually converges, precisely
 *
 * Three mechanisms, and only the first one is guaranteed to run:
 *
 *  1. **The provider's own sandbox timeout** is set to the TTL at creation, so
 *     the VM stops at the deadline whether or not anything in Vibe ever runs
 *     again. This is what makes "a preview runtime does not live indefinitely"
 *     a fact rather than an intention.
 *  2. **This read** refuses to return an origin past the deadline, marks the
 *     session `expired`, and attempts teardown plus snapshot deletion. It is
 *     lazy by design: no cron, no scheduler, no background sweeper — none of
 *     which exists in this architecture, and inventing one for a fifteen-minute
 *     TTL would be new infrastructure for a problem the provider already
 *     bounds.
 *  3. **The snapshot's own 60-minute TTL** is the backstop for the case where
 *     nobody ever reads again, so a customer's filesystem cannot outlive an
 *     hour in provider storage regardless.
 *
 * What is deliberately *not* claimed: that a session row transitions to
 * `expired` promptly on its own. It transitions when someone looks. The product
 * must not say otherwise, because nothing would be performing it.
 */
export async function getPreviewStatus(
  supabase: SupabaseClient,
  provider: SandboxProvider,
  params: { projectId: string; userId: string; previewSessionId: string },
): Promise<PreviewView | null> {
  if (!(await ownsProject(supabase, params))) return null;

  const session = await getPreviewSession(supabase, {
    projectId: params.projectId,
    previewSessionId: params.previewSessionId,
  });
  if (!session) return null;

  const base: PreviewView = {
    previewSessionId: session.id,
    status: session.status,
    stage: session.stage,
    failureCode: session.failureCode,
    expiresAt: session.expiresAt,
    readyAt: session.readyAt,
    port: session.port,
    origin: null,
    verdict: null,
  };

  if (isPreviewExpired(session)) {
    // Converge before answering, so the answer is not "expired" beside a row
    // that still claims to be running.
    if (session.status === "starting" || session.status === "running") {
      await expirePreview(supabase, provider, session);
      return { ...base, status: "expired" };
    }
    return base;
  }

  if (session.status !== "running") return base;

  return {
    ...base,
    origin: await resolvePreviewOrigin(provider, { previewSessionId: session.id }),
    verdict: "preview_available",
  };
}

export type StopPreviewOutcome =
  | { kind: "stopped"; previewSessionId: string; cleanupComplete: boolean }
  /** Already terminal. One logical result, no error (§24, §32). */
  | { kind: "already_stopped"; previewSessionId: string; status: PreviewStatus }
  | { kind: "failed"; error: "project_not_found" | "preview_failed" };

/**
 * Stops a preview the caller owns (§24).
 *
 * Runs inline rather than as a durable operation, deliberately: it is two
 * provider calls and two writes, none of which is measured in tens of seconds,
 * so ADR 0013's durability threshold does not apply. What it *is* is
 * irreversible — the snapshot goes — which is why it is only ever reached
 * through an authorized, explicit call.
 *
 * Idempotent on every axis. A session that is already terminal returns its
 * existing status rather than an error; stopping a stopped sandbox and deleting
 * a deleted snapshot are successes; and a second call cannot produce a second
 * ledger row, because the terminal write is conditional on a live status and
 * the ledger has a unique index on the session.
 */
export async function stopChangePreview(
  supabase: SupabaseClient,
  provider: SandboxProvider,
  params: { projectId: string; userId: string; previewSessionId: string },
): Promise<StopPreviewOutcome> {
  if (!(await ownsProject(supabase, params))) {
    return { kind: "failed", error: "project_not_found" };
  }

  const session = await getPreviewSession(supabase, {
    projectId: params.projectId,
    previewSessionId: params.previewSessionId,
  });
  if (!session) return { kind: "failed", error: "project_not_found" };

  if (session.status === "stopped" || session.status === "expired" || session.status === "failed") {
    // Terminal already. The snapshot deletion may still be outstanding from a
    // previous attempt, so retry that half without reopening the session (§33).
    if (session.artifactDeletedAt === null) {
      await retryArtifactDeletion(supabase, provider, session);
    }
    return { kind: "already_stopped", previewSessionId: session.id, status: session.status };
  }

  const teardown = await teardownPreview(
    provider,
    { previewSessionId: session.id, snapshotId: session.artifactSnapshotId },
    { deleteArtifact: true },
  );

  const persisted = await completePreviewSession(supabase, {
    previewSessionId: session.id,
    projectId: params.projectId,
    status: "stopped",
    failureCode: null,
    cleanupStatus: teardown.cleanup,
    artifactDeleted: teardown.artifactDeleted,
  });

  if (teardown.artifactDeleted) {
    await markValidatedArtifactDeleted(supabase, {
      validationRunId: session.validationRunId,
      projectId: params.projectId,
    });
  }

  if (persisted) {
    await recordPreviewSandboxUsage(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      previewSessionId: session.id,
      provider: session.provider,
      runtime: teardown.runtime ?? session.runtime,
      status: "passed",
      sandboxDurationMs: elapsed(session.startedAt),
      usage: teardown.usage,
      cleanupStatus: teardown.cleanup,
      failureCode: null,
    });

    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "change_preview.stopped",
      metadata: {
        projectId: params.projectId,
        previewSessionId: session.id,
        validationRunId: session.validationRunId,
        cleanup: teardown.cleanup,
        artifactDeleted: teardown.artifactDeleted,
      },
    });
  }

  return {
    kind: "stopped",
    previewSessionId: session.id,
    // Reported rather than hidden. A preview that stopped correctly but whose
    // snapshot survived is a real, different outcome, and the retry path above
    // is what fixes it (§19).
    //
    // `not_provisioned` counts as complete: nothing is running, which is what
    // cleanup exists to produce. Only the two genuine failures do not.
    cleanupComplete:
      teardown.artifactDeleted &&
      teardown.cleanup !== "stop_failed" &&
      teardown.cleanup !== "artifact_delete_failed",
  };
}

/** Lazy convergence for a session that outlived its deadline (§25). */
async function expirePreview(
  supabase: SupabaseClient,
  provider: SandboxProvider,
  session: PreviewSession,
): Promise<void> {
  const teardown = await teardownPreview(
    provider,
    { previewSessionId: session.id, snapshotId: session.artifactSnapshotId },
    { deleteArtifact: true },
  );

  const persisted = await completePreviewSession(supabase, {
    previewSessionId: session.id,
    projectId: session.projectId,
    status: "expired",
    failureCode: null,
    cleanupStatus: teardown.cleanup,
    artifactDeleted: teardown.artifactDeleted,
  });

  if (teardown.artifactDeleted) {
    await markValidatedArtifactDeleted(supabase, {
      validationRunId: session.validationRunId,
      projectId: session.projectId,
    });
  }

  if (persisted) {
    await recordPreviewSandboxUsage(supabase, {
      projectId: session.projectId,
      userId: session.userId,
      previewSessionId: session.id,
      provider: session.provider,
      runtime: teardown.runtime ?? session.runtime,
      status: "passed",
      sandboxDurationMs: elapsed(session.startedAt),
      usage: teardown.usage,
      cleanupStatus: teardown.cleanup,
      failureCode: null,
    });

    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "change_preview.expired",
      metadata: {
        projectId: session.projectId,
        previewSessionId: session.id,
        validationRunId: session.validationRunId,
        cleanup: teardown.cleanup,
        artifactDeleted: teardown.artifactDeleted,
      },
    });
  }
}

/**
 * Retries a snapshot deletion that failed earlier.
 *
 * The whole reason `artifact_delete_failed` is a recorded state rather than a
 * swallowed error: the customer's filesystem is still in provider storage, and
 * something has to be able to try again without reopening a closed session.
 */
async function retryArtifactDeletion(
  supabase: SupabaseClient,
  provider: SandboxProvider,
  session: PreviewSession,
): Promise<void> {
  try {
    await provider.deleteArtifact(session.artifactSnapshotId);
  } catch {
    // Still not deletable. The artifact's own 60-minute TTL remains the
    // backstop, and the session keeps saying deletion is outstanding.
    return;
  }

  await markPreviewArtifactDeleted(supabase, {
    previewSessionId: session.id,
    projectId: session.projectId,
  });
  await markValidatedArtifactDeleted(supabase, {
    validationRunId: session.validationRunId,
    projectId: session.projectId,
  });
}

function elapsed(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Date.now() - started : null;
}
