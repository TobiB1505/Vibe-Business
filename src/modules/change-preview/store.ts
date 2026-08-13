import type { SupabaseClient } from "@supabase/supabase-js";
import type { SandboxUsage } from "@/modules/validation/sandbox-port";
import type {
  PreviewCleanupStatus,
  PreviewFailureCode,
  PreviewProfile,
  PreviewProviderId,
  PreviewSession,
  PreviewStage,
  PreviewStatus,
  ValidatedArtifact,
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
  "id, project_id, user_id, prepared_change_id, validation_run_id, operation_run_id, " +
  "artifact_snapshot_id, preview_profile, preview_profile_version, preview_policy_version, " +
  "provider, runtime, port, status, stage, failure_code, cleanup_status, preview_identity, " +
  "started_at, ready_at, expires_at, stopped_at, artifact_deleted_at, created_at, updated_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): PreviewSession {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    preparedChangeId: String(row.prepared_change_id),
    validationRunId: String(row.validation_run_id),
    operationRunId: String(row.operation_run_id),
    artifactSnapshotId: String(row.artifact_snapshot_id),
    previewProfile: row.preview_profile as PreviewProfile,
    previewProfileVersion: String(row.preview_profile_version),
    previewPolicyVersion: String(row.preview_policy_version),
    provider: row.provider as PreviewProviderId,
    runtime: (row.runtime as string | null) ?? null,
    port: Number(row.port),
    status: row.status as PreviewStatus,
    stage: row.stage as PreviewStage,
    failureCode: (row.failure_code as PreviewFailureCode | null) ?? null,
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

/**
 * The ValidatedArtifact for one validation run the caller owns (§7, §10).
 *
 * Every gate that can refuse before a cent of provider spend is here, and each
 * one is a *query predicate* rather than a later check:
 *
 *  - the run belongs to this project (the caller's project, established above);
 *  - the run `passed` — a failed validation has no artifact and never will;
 *  - an artifact was actually captured;
 *  - it has not already been deleted.
 *
 * Expiry is checked by the caller against `expiresAt`, not filtered here, so
 * "expired" and "never existed" can be told apart in the failure code the user
 * sees. `preview_artifact_expired` is actionable — re-validate — and
 * `preview_artifact_unavailable` is a different sentence entirely.
 */
export async function getValidatedArtifact(
  supabase: SupabaseClient,
  params: { projectId: string; validatedArtifactId: string },
): Promise<ValidatedArtifact | null> {
  const { data, error } = await supabase
    .from("validation_runs")
    .select(
      "id, project_id, prepared_change_id, validation_profile, prepared_commit_sha, " +
        "artifact_snapshot_id, artifact_expires_at, artifact_deleted_at, status",
    )
    // The artifact's public id is its validation run id: capture is strictly
    // one per passing run (see `ValidatedArtifact`).
    .eq("id", params.validatedArtifactId)
    .eq("project_id", params.projectId)
    .eq("status", "passed")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as Row;
  const snapshotId = row.artifact_snapshot_id as string | null;
  const expiresAt = row.artifact_expires_at as string | null;

  // No snapshot, or no deadline. The database's own CHECK already refuses a
  // retained artifact without an expiry; this is the same rule stated where the
  // value is read, because a null here would otherwise become "never expires".
  if (!snapshotId || !expiresAt) return null;
  if (row.artifact_deleted_at) return null;

  return {
    validationRunId: String(row.id),
    projectId: String(row.project_id),
    preparedChangeId: String(row.prepared_change_id),
    validationProfile: row.validation_profile as ValidatedArtifact["validationProfile"],
    preparedCommitSha: String(row.prepared_commit_sha),
    snapshotId,
    expiresAt,
    deletedAt: null,
  };
}

/** Source integrity as validation recorded it, for the restore-time recheck (§11). */
export async function getValidationSourceIntegrity(
  supabase: SupabaseClient,
  params: { projectId: string; validationRunId: string },
): Promise<{ buildIdentityDigests: Record<string, string> } | null> {
  const { data, error } = await supabase
    .from("validation_runs")
    .select("source_integrity")
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const integrity = (data as unknown as Row).source_integrity as
    | { buildIdentityDigests?: Record<string, string> }
    | null;

  // A run validated before digests were recorded carries none. Treated as
  // "nothing to compare" rather than as agreement — the prepared-change hashes
  // still run, and they are the load-bearing check (§11).
  return { buildIdentityDigests: integrity?.buildIdentityDigests ?? {} };
}

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
    validationRunId: string;
    operationRunId: string;
    artifactSnapshotId: string;
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
      validation_run_id: params.validationRunId,
      operation_run_id: params.operationRunId,
      artifact_snapshot_id: params.artifactSnapshotId,
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
