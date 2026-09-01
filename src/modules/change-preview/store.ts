import type { SupabaseClient } from "@supabase/supabase-js";
import { readLatestPerPreparedChange } from "@/lib/db/latest-per-change";
import type { SandboxUsage } from "@/modules/validation/sandbox-port";
import type {
  TeardownReason,
  PreviewCleanupStatus,
  PreviewFailureCode,
  PreviewProfile,
  PreviewProviderId,
  PreviewSession,
  PreviewStage,
  PreviewStatus,
} from "./schema";

/**
 * Persistence for preview sessions (Sprint 10B-2 §5, §6).
 *
 * Two rules shape every query here, unchanged from the validation store:
 *
 *  1. **Ownership is asserted in code, not inherited from RLS.** Durable
 *     execution runs under the service-role client, which bypasses row-level
 *     security entirely, so every statement filters on a `project_id` taken
 *     from the persisted operation row (ADR 0013, CLAUDE.md rule 53).
 *  2. **Nothing large, secret, or capability-like is stored.** No source, no
 *     logs, no provider responses — and specifically **no preview URL**, which
 *     is fetched from the provider on an authorized read instead (§16).
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

const COLUMNS =
  "id, project_id, user_id, prepared_change_id, prepared_commit_sha, validation_run_id, " +
  "operation_run_id, " +
  "artifact_snapshot_id, preview_profile, preview_profile_version, preview_policy_version, " +
  "provider, runtime, port, status, stage, failure_code, cleanup_status, preview_identity, " +
  "teardown_reason, " +
  "started_at, ready_at, expires_at, stopped_at, artifact_deleted_at, created_at, updated_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): PreviewSession {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    preparedChangeId: String(row.prepared_change_id),
    preparedCommitSha: String(row.prepared_commit_sha),
    validationRunId: (row.validation_run_id as string | null) ?? null,
    operationRunId: String(row.operation_run_id),
    artifactSnapshotId: (row.artifact_snapshot_id as string | null) ?? null,
    previewProfile: row.preview_profile as PreviewProfile,
    previewProfileVersion: String(row.preview_profile_version),
    previewPolicyVersion: String(row.preview_policy_version),
    provider: row.provider as PreviewProviderId,
    runtime: (row.runtime as string | null) ?? null,
    port: Number(row.port),
    status: row.status as PreviewStatus,
    stage: row.stage as PreviewStage,
    failureCode: (row.failure_code as PreviewFailureCode | null) ?? null,
    teardownReason: (row.teardown_reason as TeardownReason | null) ?? null,
    cleanupStatus: (row.cleanup_status as PreviewCleanupStatus | null) ?? null,
    previewIdentity: String(row.preview_identity),
    startedAt: (row.started_at as string | null) ?? null,
    readyAt: (row.ready_at as string | null) ?? null,
    expiresAt: String(row.expires_at),
    stoppedAt: (row.stopped_at as string | null) ?? null,
    artifactDeletedAt: (row.artifact_deleted_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

/*
 * The artifact readers that used to live here are gone (ADR 0064).
 *
 * `getValidatedArtifact`, `validatedArtifactFrom` and
 * `getValidationSourceIntegrity` all served one caller: booting a preview from
 * a validation's snapshot and re-checking the restored filesystem against what
 * validation had hashed. A preview clones the prepared commit now, so there is
 * no snapshot to find and no restored filesystem to re-check.
 *
 * The columns and the `ValidatedArtifact` type stay — historical rows still
 * carry them, and teardown still marks a v1 session's artifact deleted.
 */

/** The live preview for one exact identity, if any (§22). */
export async function findActivePreviewByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; previewIdentity: string },
): Promise<PreviewSession | null> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("preview_identity", params.previewIdentity)
    .in("status", ["starting", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The most recent preview for one prepared change, in any state (§16).
 *
 * Ordered newest-first and limited to one, deliberately: the product shows the
 * *current* preview state, not a history. A preview management screen is not a
 * V0.1 need, and building one would invite the question of what an old,
 * stopped preview of a superseded artifact is for.
 *
 * Scoped by prepared change rather than by validation run, so a change that was
 * re-validated still shows its latest preview rather than appearing to have
 * none.
 */
export async function getLatestPreviewForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<PreviewSession | null> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("prepared_change_id", params.preparedChangeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * A preview of this exact commit that actually became reachable (Sprint 0114).
 *
 * The evidence a visual approval binds to. Three predicates, and each is doing
 * work:
 *
 *  - the **commit**, because a preview of an earlier attempt is a preview of
 *    different bytes;
 *  - `ready_at is not null`, because a session that never answered is not
 *    something a person could have looked at — a *status* would be the wrong
 *    question, since the session is expected to be over by now;
 *  - the project, because ownership is a query predicate here as everywhere.
 *
 * **Oldest first**, deliberately. Every ready preview of one commit served the
 * identical bytes, so any of them is equally true evidence — which makes the
 * choice a question about stability rather than about truth. Newest-first would
 * mean that starting a second preview to look again silently changes what a new
 * approval would bind to, and invalidates a standing one; the person did not
 * change their mind, they scrolled the same page twice (rule 68).
 *
 * The earliest ready session is stable for the life of the commit, so an
 * approval's evidence stops moving the moment it exists.
 */
export async function findReadyPreviewForCommit(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string; preparedCommitSha: string },
): Promise<PreviewSession | null> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("prepared_change_id", params.preparedChangeId)
    .eq("prepared_commit_sha", params.preparedCommitSha)
    .not("ready_at", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The same answer for a whole list, in one query (VB-023).
 *
 * The Agent screen assembles every prepared change at once, and asking this
 * table once per card is the cost that made one render 261 round trips. Ids
 * with no row are absent from the map, so `.get(id) ?? null` reads exactly as
 * the single-change query above.
 */
export async function getLatestPreviewsForPreparedChanges(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeIds: readonly string[] },
): Promise<Map<string, PreviewSession>> {
  const rows = await readLatestPerPreparedChange(supabase, {
    table: "preview_sessions",
    columns: COLUMNS,
    projectId: params.projectId,
    preparedChangeIds: params.preparedChangeIds,
  });

  return new Map([...rows].map(([id, row]) => [id, mapRow(row as unknown as Row)]));
}

export async function findPreviewByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<PreviewSession | null> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .select(COLUMNS)
    .eq("operation_run_id", operationRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/** One session the caller owns. Ownership is the query, not a later check. */
export async function getPreviewSession(
  supabase: SupabaseClient,
  params: { projectId: string; previewSessionId: string },
): Promise<PreviewSession | null> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .select(COLUMNS)
    .eq("id", params.previewSessionId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

export type ClaimPreviewResult =
  | { ok: true; session: PreviewSession }
  | { ok: false; error: "already_active" | "persistence_failed" };

/**
 * Claims the session before any sandbox is created (§21, §32).
 *
 * The partial unique index does the real work: two concurrent clicks race to
 * insert, one loses on `23505`, and only one paid microVM is ever created on
 * only one public URL. The application check that precedes this is a courtesy,
 * not the guarantee.
 */
export async function claimPreviewSession(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    /** The commit this session will serve. Server-resolved, never sent. */
    preparedCommitSha: string;
    operationRunId: string;
    previewProfile: PreviewProfile;
    previewProfileVersion: string;
    previewPolicyVersion: string;
    provider: PreviewProviderId;
    port: number;
    previewIdentity: string;
    expiresAt: string;
  },
): Promise<ClaimPreviewResult> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      prepared_change_id: params.preparedChangeId,
      prepared_commit_sha: params.preparedCommitSha,
      operation_run_id: params.operationRunId,
      preview_profile: params.previewProfile,
      preview_profile_version: params.previewProfileVersion,
      preview_policy_version: params.previewPolicyVersion,
      provider: params.provider,
      port: params.port,
      preview_identity: params.previewIdentity,
      expires_at: params.expiresAt,
      status: "starting",
      stage: "preflight",
      started_at: new Date().toISOString(),
    })
    // `.single()`, not `.maybeSingle()`: an insert either returns its one row or
    // errors, and treating "no row" as a soft null would report a lost race as a
    // persistence failure.
    .select(COLUMNS)
    .single();

  if (error) {
    return {
      ok: false,
      error: error.code === POSTGRES_UNIQUE_VIOLATION ? "already_active" : "persistence_failed",
    };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, session: mapRow(data as unknown as Row) };
}

/**
 * Claims a preview for teardown (Sprint 10B-3).
 *
 * The transition that makes teardown safe to hand to a workflow: the session
 * leaves `starting`/`running` in one conditional statement, so a second stop —
 * or an expiry racing a manual stop — finds nothing to claim and starts no
 * second teardown. Returns whether *this* call claimed it.
 *
 * The reason is written here, by the initiator, because a workflow step
 * receives an operation id and re-derives everything else from the database.
 */
export async function claimPreviewTeardown(
  supabase: SupabaseClient,
  params: { previewSessionId: string; projectId: string; reason: TeardownReason },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .update({ status: "stopping", teardown_reason: params.reason })
    .eq("id", params.previewSessionId)
    .eq("project_id", params.projectId)
    .in("status", ["starting", "running"])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Progress. Scoped to live statuses so a replay cannot amend a finished session. */
export async function setPreviewStage(
  supabase: SupabaseClient,
  params: {
    previewSessionId: string;
    projectId: string;
    stage: PreviewStage;
    runtime?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("preview_sessions")
    .update({
      stage: params.stage,
      ...(params.runtime !== undefined ? { runtime: params.runtime } : {}),
    })
    .eq("id", params.previewSessionId)
    .eq("project_id", params.projectId)
    .in("status", ["starting", "running"]);

  if (error) throw error;
}

/**
 * Marks a session reachable.
 *
 * `ready_at` is written in the same statement as `status = 'running'` because
 * the database refuses one without the other: `running` is the claim that a
 * health check passed, and the claim must not be able to exist without the
 * moment it happened.
 *
 * Returns whether this call performed the transition, which is the signal a
 * replayed step needs to skip a second completion event.
 */
export async function markPreviewRunning(
  supabase: SupabaseClient,
  params: { previewSessionId: string; projectId: string; runtime: string | null },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .update({
      status: "running",
      stage: "completed",
      ready_at: new Date().toISOString(),
      runtime: params.runtime,
    })
    .eq("id", params.previewSessionId)
    .eq("project_id", params.projectId)
    .eq("status", "starting")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Writes a terminal outcome.
 *
 * Scoped to live statuses and reports whether it applied, so a workflow replay
 * or a second stop cannot overwrite an already-terminal session — which is what
 * makes "stop twice produces one logical result" true rather than intended
 * (§24, §32).
 */
export async function completePreviewSession(
  supabase: SupabaseClient,
  params: {
    previewSessionId: string;
    projectId: string;
    status: "stopped" | "expired" | "failed";
    failureCode: PreviewFailureCode | null;
    cleanupStatus: PreviewCleanupStatus | null;
    artifactDeleted: boolean;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("preview_sessions")
    .update({
      status: params.status,
      failure_code: params.failureCode,
      cleanup_status: params.cleanupStatus,
      stopped_at: new Date().toISOString(),
      ...(params.artifactDeleted ? { artifact_deleted_at: new Date().toISOString() } : {}),
    })
    .eq("id", params.previewSessionId)
    .eq("project_id", params.projectId)
    .in("status", ["starting", "running", "stopping"])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Records a snapshot deletion on a session that is already terminal.
 *
 * The retry path for `artifact_delete_failed`. Separate from the terminal write
 * because the two can genuinely happen at different times: the preview ended,
 * the storage call did not succeed, and the outcome must remain correctable
 * without reopening a closed session (§19, §33).
 */
export async function markPreviewArtifactDeleted(
  supabase: SupabaseClient,
  params: { previewSessionId: string; projectId: string },
): Promise<void> {
  const { error } = await supabase
    .from("preview_sessions")
    .update({ artifact_deleted_at: new Date().toISOString(), cleanup_status: "stopped" })
    .eq("id", params.previewSessionId)
    .eq("project_id", params.projectId)
    .is("artifact_deleted_at", null);

  if (error) throw error;
}

/**
 * Marks the ValidatedArtifact itself deleted, on the validation run (§19, §20).
 *
 * Only the artifact. The run stays historically `passed` and the prepared
 * change stays historically `prepared`: what is lost is the ability to preview
 * again without an explicit re-validation, and nothing about what happened.
 */
export async function markValidatedArtifactDeleted(
  supabase: SupabaseClient,
  params: { validationRunId: string; projectId: string },
): Promise<void> {
  const { error } = await supabase
    .from("validation_runs")
    .update({ artifact_deleted_at: new Date().toISOString() })
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .is("artifact_deleted_at", null);

  if (error) throw error;
}

/**
 * Records infrastructure spend for a preview (§27).
 *
 * The same ledger as validation, distinguishable by `operation` and
 * `preview_session_id`, with the same discipline: measured values only,
 * `provider_cost_usd` null because Vercel exposes no attributable per-sandbox
 * amount and a figure derived from a public rate card would be an estimate
 * wearing an accounting figure's clothes.
 *
 * No `ai_usage_events` row is written, because none is earned: nothing in a
 * preview calls a model.
 */
export async function recordPreviewSandboxUsage(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    previewSessionId: string;
    provider: PreviewProviderId;
    runtime: string | null;
    status: "passed" | "failed";
    sandboxDurationMs: number | null;
    usage: SandboxUsage | null;
    cleanupStatus: PreviewCleanupStatus | null;
    failureCode: PreviewFailureCode | null;
  },
): Promise<void> {
  const { error } = await supabase.from("sandbox_usage_events").insert({
    project_id: params.projectId,
    user_id: params.userId,
    preview_session_id: params.previewSessionId,
    operation: "change_preview",
    provider: params.provider,
    runtime: params.runtime,
    status: params.status,
    sandbox_duration_ms: params.sandboxDurationMs,
    active_cpu_ms: params.usage?.activeCpuDurationMs ?? null,
    network_ingress_bytes: params.usage?.networkIngressBytes ?? null,
    network_egress_bytes: params.usage?.networkEgressBytes ?? null,
    provider_cost_usd: params.usage?.costUsd ?? null,
    cleanup_status: params.cleanupStatus,
    failure_code: params.failureCode,
    // Deliberately no detail column: a preview's diagnostics belong on the
    // session, and the ledger is for numbers.
  });

  // A ledger write must never take down the preview that earned it — the
  // sandbox already ran and the spend is real either way. The unique index on
  // `preview_session_id` means a retried terminal step lands here and loses,
  // which is exactly the outcome wanted.
  if (error) return;
}
