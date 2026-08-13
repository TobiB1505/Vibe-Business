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
import { computePreviewIdentity, computeTeardownIdentity } from "./identity";
import { resolvePreviewOrigin } from "./orchestrator";
import {
  PREVIEW_POLICY_VERSION,
  isPreviewExpired,
  previewProfileFor,
  previewProfileVersionFor,
  type PreviewFailureCode,
  type PreviewSession,
  type PreviewStatus,
  type TeardownReason,
} from "./schema";
import { buildPreviewCard, type PreviewCard } from "./view";
import {
  claimPreviewSession,
  claimPreviewTeardown,
  findActivePreviewByIdentity,
  getLatestPreviewForPreparedChange,
  getPreviewSession,
  getValidatedArtifact,
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
 *  3. **The snapshot's own provider-minimum 24-hour TTL** is the backstop for
 *     the case where nobody ever reads again. Explicit deletion still runs as
 *     soon as the preview reaches a terminal state.
 *
 * What is deliberately *not* claimed: that a session row transitions to
 * `expired` promptly on its own. It transitions when someone looks. The product
 * must not say otherwise, because nothing would be performing it.
 */
export async function getPreviewStatus(
  supabase: SupabaseClient,
  provider: SandboxProvider,
  executor: OperationExecutor,
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
    // Hand it to the same teardown a manual stop uses. This read is what
    // *notices* the deadline; it does not do the work, because the work needs
    // the privileged ledger writer and a request never gets one.
    if (session.status === "starting" || session.status === "running") {
      await requestTeardown(supabase, executor, session, "expired");
      return { ...base, status: "stopping" };
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

/**
 * The preview state for one prepared change, decided on the server (§2).
 *
 * ## Why this is a read and nothing more
 *
 * Opening the preview panel must cost nothing. No sandbox, no validation, no
 * provider call of any kind — a user looking at a page has not asked to spend
 * money, and a panel that quietly re-validated to "helpfully" refresh an
 * expired artifact would be exactly the invisible spend CLAUDE.md rule 60
 * forbids (§22).
 *
 * So this reads three rows and returns a state. Every action that costs
 * something is behind an explicit click.
 *
 * The artifact is resolved through `getValidatedArtifact`, which already
 * filters on a passing run, a captured snapshot and a live deletion state — so
 * "there is no artifact" and "the artifact is not usable" are the same answer
 * here, and the view turns them into the same sentence.
 */
export async function getPreviewCard(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    /** The latest validation for this change, already loaded by the caller. */
    validation: { id: string; status: string } | null;
    /** Safe copy for a failed session's code. Never a provider message. */
    resolveFailureMessage: (code: string) => string | null;
  },
): Promise<PreviewCard> {
  const session = await getLatestPreviewForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  const artifact =
    params.validation && params.validation.status === "passed"
      ? await getValidatedArtifact(supabase, {
          projectId: params.projectId,
          validatedArtifactId: params.validation.id,
        })
      : null;

  return buildPreviewCard({
    validation: params.validation,
    artifact: artifact ? { expiresAt: artifact.expiresAt } : null,
    session,
    failureMessage: session?.failureCode
      ? params.resolveFailureMessage(session.failureCode)
      : null,
  });
}

export type StopPreviewOutcome =
  | { kind: "stopping"; previewSessionId: string; operation: OperationView }
  /** Already terminal, or already being torn down. One logical result (§24). */
  | { kind: "already_stopped"; previewSessionId: string; status: PreviewStatus }
  | { kind: "failed"; error: "project_not_found" | "preview_failed" };

/**
 * Ends a preview the caller owns (§24, and revised after the first dogfood).
 *
 * ## Why this no longer does the work
 *
 * It used to: stop the sandbox, delete the snapshot, write the ledger, mark the
 * session — all inline, on the reasoning that four operations measured in
 * seconds do not need durability (ADR 0016, original §11).
 *
 * The first real stop was correct in every visible way and recorded no spend at
 * all. `sandbox_usage_events` grants SELECT only, deliberately — a ledger the
 * client can write is not a ledger — and an inline stop runs under the
 * cookie-scoped client, so the insert was refused by RLS and swallowed.
 *
 * The threshold that matters was never duration. It is whether the work needs
 * the privileged writer, and only durable execution may hold it (CLAUDE.md rule
 * 53). So this claims the session and hands it to a workflow.
 *
 * ## Idempotency lives in the claim
 *
 * `claimPreviewTeardown` moves the session out of `starting`/`running` in one
 * conditional statement. A double click, or an expiry racing a manual stop,
 * finds nothing left to claim and starts no second teardown — and the
 * operation's own unique index is the second guard behind that.
 */
export async function stopChangePreview(
  supabase: SupabaseClient,
  executor: OperationExecutor,
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

  return requestTeardown(supabase, executor, session, "stopped");
}

/**
 * Starts the teardown workflow for a session, whatever ended it.
 *
 * Manual stop and expiry converge here rather than each doing their own
 * teardown, because the parts that differ are a status and a sentence, and the
 * parts that are the same are the ones that cost money.
 */
async function requestTeardown(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  session: PreviewSession,
  reason: TeardownReason,
): Promise<StopPreviewOutcome> {
  const claimed = await claimPreviewTeardown(supabase, {
    previewSessionId: session.id,
    projectId: session.projectId,
    reason,
  });

  if (!claimed) {
    // Already terminal, or another teardown claimed it first. Both are the same
    // logical result: this preview is ending and nothing further is owed.
    const current = await getPreviewSession(supabase, {
      projectId: session.projectId,
      previewSessionId: session.id,
    });
    return {
      kind: "already_stopped",
      previewSessionId: session.id,
      status: current?.status ?? session.status,
    };
  }

  const created = await createOperationRun(supabase, {
    projectId: session.projectId,
    userId: session.userId,
    operationType: "preview_teardown",
    inputIdentity: computeTeardownIdentity(session.id),
    subjectId: session.id,
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      const running = await findActiveOperationByIdentity(supabase, {
        projectId: session.projectId,
        operationType: "preview_teardown",
        inputIdentity: computeTeardownIdentity(session.id),
      });
      if (running) {
        return { kind: "stopping", previewSessionId: session.id, operation: view(running) };
      }
    }
    return { kind: "failed", error: "preview_failed" };
  }

  const started = await executor.start({
    operationId: created.operation.id,
    operationType: "preview_teardown",
  });

  // The sandbox is still running and the session now says `stopping`. Reporting
  // failure here is honest: nothing has been torn down, and the provider
  // timeout plus the snapshot TTL remain the backstops until a retry succeeds.
  if (!started.ok) return { kind: "failed", error: "preview_failed" };

  return { kind: "stopping", previewSessionId: session.id, operation: view(created.operation) };
}

