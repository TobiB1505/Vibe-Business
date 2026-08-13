import type { SupabaseClient } from "@supabase/supabase-js";
import type { CleanupStatus } from "./orchestrator";
import type { SandboxUsage } from "./sandbox-port";
import type {
  SandboxProviderId,
  SourceIntegrity,
  SupportedPackageManager,
  ValidationFailureCode,
  ValidationProfile,
  ValidationStage,
  ValidationStatus,
  ValidationStepName,
  ValidationStepResult,
} from "./schema";

/**
 * Persistence for validation runs (Sprint 10A §26).
 *
 * Two rules shape every query here:
 *
 *  1. **Ownership is asserted in code, not inherited from RLS.** Durable
 *     execution runs under the service-role client, which bypasses row-level
 *     security entirely, so every statement filters on a `project_id` taken
 *     from the persisted operation row (ADR 0013).
 *  2. **Nothing large or secret is stored.** No source, no `node_modules`, no
 *     full logs, no provider responses, no credentials — only bounded step
 *     tails and the metadata needed to explain the run.
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

export type StoredValidationRun = {
  id: string;
  projectId: string;
  preparedChangeId: string;
  operationRunId: string;
  validationProfile: ValidationProfile;
  validationProfileVersion: string;
  sandboxPolicyVersion: string;
  sandboxProvider: SandboxProviderId;
  sandboxRuntime: string | null;
  packageManager: SupportedPackageManager;
  preparedCommitSha: string;
  status: ValidationStatus;
  stage: ValidationStage;
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
  failureCode: ValidationFailureCode | null;
  failureDetail: string | null;
  sourceIntegrity: SourceIntegrity | null;
  /** Present only on a passing run whose filesystem was captured (§5). */
  artifactSnapshotId: string | null;
  artifactExpiresAt: string | null;
  artifactDeletedAt: string | null;
  sandboxDurationMs: number | null;
  cleanupStatus: CleanupStatus | null;
  validationIdentity: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const COLUMNS =
  "id, project_id, prepared_change_id, operation_run_id, validation_profile, validation_profile_version, " +
  "sandbox_policy_version, sandbox_provider, sandbox_runtime, package_manager, prepared_commit_sha, " +
  "status, stage, steps, failure_code, failure_detail, source_integrity, artifact_snapshot_id, artifact_expires_at, artifact_deleted_at, sandbox_duration_ms, cleanup_status, validation_identity, " +
  "created_at, started_at, completed_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): StoredValidationRun {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    preparedChangeId: String(row.prepared_change_id),
    operationRunId: String(row.operation_run_id),
    validationProfile: row.validation_profile as ValidationProfile,
    validationProfileVersion: String(row.validation_profile_version),
    sandboxPolicyVersion: String(row.sandbox_policy_version),
    sandboxProvider: row.sandbox_provider as SandboxProviderId,
    sandboxRuntime: (row.sandbox_runtime as string | null) ?? null,
    packageManager: row.package_manager as SupportedPackageManager,
    preparedCommitSha: String(row.prepared_commit_sha),
    status: row.status as ValidationStatus,
    stage: row.stage as ValidationStage,
    steps: (row.steps ?? {}) as Partial<Record<ValidationStepName, ValidationStepResult>>,
    failureCode: (row.failure_code as ValidationFailureCode | null) ?? null,
    failureDetail: (row.failure_detail as string | null) ?? null,
    sourceIntegrity: (row.source_integrity as SourceIntegrity | null) ?? null,
    artifactSnapshotId: (row.artifact_snapshot_id as string | null) ?? null,
    artifactExpiresAt: (row.artifact_expires_at as string | null) ?? null,
    artifactDeletedAt: (row.artifact_deleted_at as string | null) ?? null,
    sandboxDurationMs: (row.sandbox_duration_ms as number | null) ?? null,
    cleanupStatus: (row.cleanup_status as CleanupStatus | null) ?? null,
    validationIdentity: String(row.validation_identity),
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

/**
 * A validation that already answered this exact question and still carries the
 * usable artifact a preview needs (§21, Sprint 10B dogfood).
 *
 * Only `passed` with a live, undeleted snapshot is reusable. A passing verdict
 * without one still proves the commands succeeded, but reusing it would make
 * the Preview panel's explicit "Validate again" action a no-op and leave the
 * user permanently stranded after a capture failure or artifact expiry.
 *
 * A previous failure is not a durable fact about the artifact either: the
 * build may have failed on a transient registry error, and refusing to re-run
 * would strand the user with a verdict they cannot retry.
 */
export async function findReusableValidationRun(
  supabase: SupabaseClient,
  params: { projectId: string; validationIdentity: string },
): Promise<StoredValidationRun | null> {
  const { data, error } = await supabase
    .from("validation_runs")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("validation_identity", params.validationIdentity)
    .eq("status", "passed")
    .not("artifact_snapshot_id", "is", null)
    .is("artifact_deleted_at", null)
    .gt("artifact_expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

export async function findValidationRunByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<StoredValidationRun | null> {
  const { data, error } = await supabase
    .from("validation_runs")
    .select(COLUMNS)
    .eq("operation_run_id", operationRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

export async function getLatestValidationForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<StoredValidationRun | null> {
  const { data, error } = await supabase
    .from("validation_runs")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("prepared_change_id", params.preparedChangeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

export type ClaimValidationResult =
  | { ok: true; validationRun: StoredValidationRun }
  | { ok: false; error: "already_active" | "persistence_failed" };

/**
 * Claims the run before any sandbox is provisioned (§21, §35).
 *
 * The partial unique index does the real work: two concurrent clicks race to
 * insert, one loses on `23505`, and only one paid microVM is ever created. The
 * application check that precedes this is a courtesy, not the guarantee.
 */
export async function claimValidationRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    operationRunId: string;
    validationProfile: ValidationProfile;
    validationProfileVersion: string;
    sandboxPolicyVersion: string;
    sandboxProvider: SandboxProviderId;
    packageManager: SupportedPackageManager;
    preparedCommitSha: string;
    validationIdentity: string;
  },
): Promise<ClaimValidationResult> {
  const { data, error } = await supabase
    .from("validation_runs")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      prepared_change_id: params.preparedChangeId,
      operation_run_id: params.operationRunId,
      validation_profile: params.validationProfile,
      validation_profile_version: params.validationProfileVersion,
      sandbox_policy_version: params.sandboxPolicyVersion,
      sandbox_provider: params.sandboxProvider,
      package_manager: params.packageManager,
      prepared_commit_sha: params.preparedCommitSha,
      validation_identity: params.validationIdentity,
      status: "running",
      stage: "provisioning",
      started_at: new Date().toISOString(),
    })
    // `.single()`, not `.maybeSingle()`: an insert either returns its one row
    // or errors, and treating "no row" as a soft null would report a lost race
    // as a persistence failure.
    .select(COLUMNS)
    .single();

  if (error) {
    return { ok: false, error: error.code === POSTGRES_UNIQUE_VIOLATION ? "already_active" : "persistence_failed" };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, validationRun: mapRow(data as unknown as Row) };
}

/**
 * Records a captured artifact against its run.
 *
 * Scoped to the project and to a passing run, because the service-role client
 * bypasses RLS and because the database's own CHECK already refuses an artifact
 * on a non-passing row — this is the same rule stated where the query lives.
 */
export async function recordValidatedArtifact(
  supabase: SupabaseClient,
  params: {
    validationRunId: string;
    projectId: string;
    snapshotId: string;
    sizeBytes: number | null;
    expiresAt: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from("validation_runs")
    .update({
      artifact_snapshot_id: params.snapshotId,
      artifact_size_bytes: params.sizeBytes,
      artifact_expires_at: params.expiresAt,
    })
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId);

  if (error) throw error;
}

/** Marks an artifact deleted. Expiry is the backstop; this is the plan. */
export async function markArtifactDeleted(
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

export async function setValidationStage(
  supabase: SupabaseClient,
  params: { validationRunId: string; projectId: string; stage: ValidationStage },
): Promise<void> {
  const { error } = await supabase
    .from("validation_runs")
    .update({ stage: params.stage })
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .eq("status", "running");

  if (error) throw error;
}

/**
 * Records one completed phase, as it completes (§4, §5, §11).
 *
 * The load-bearing write of the durable-phase refactor. Under the single-step
 * design `steps` was written once, at the end, so a run that died mid-pipeline
 * recorded nothing about the phases that had already succeeded — and the UI had
 * nothing to show while minutes passed.
 *
 * Two properties follow from writing each phase immediately:
 *
 *  1. **Re-entry is idempotent.** A resumed workflow reads this row and skips
 *     any phase already recorded, so a persistence or provider error after the
 *     tests passed never re-runs the tests (§11, §20).
 *  2. **Progress is real.** The panel renders persisted phase state, not a
 *     workflow's internal step index and not a fabricated percentage (§4, §15).
 *
 * Read-modify-write on the `steps` object rather than a JSONB merge expression:
 * phases within one run are strictly sequential — the workflow awaits each
 * before starting the next — so there is no concurrent writer to lose. Scoped
 * to `status = 'running'` so a replay cannot amend a finished run.
 */
export async function recordValidationPhase(
  supabase: SupabaseClient,
  params: {
    validationRunId: string;
    projectId: string;
    step: ValidationStepName;
    result: ValidationStepResult;
    /** Recorded with the phase that established it, not at the end of the run. */
    sourceIntegrity?: SourceIntegrity | null;
    stage: ValidationStage;
  },
): Promise<boolean> {
  const { data: current, error: readError } = await supabase
    .from("validation_runs")
    .select("steps")
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .eq("status", "running")
    .maybeSingle();

  if (readError) throw readError;
  if (!current) return false;

  const steps = {
    ...((current as { steps?: Record<string, unknown> }).steps ?? {}),
    [params.step]: params.result,
  };

  const { data, error } = await supabase
    .from("validation_runs")
    .update({
      steps,
      stage: params.stage,
      ...(params.sourceIntegrity !== undefined ? { source_integrity: params.sourceIntegrity } : {}),
    })
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .eq("status", "running")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Records what the source-verification phase established, before any
 * repository-controlled command runs.
 *
 * Separate from the phase writer because source integrity is not a `steps`
 * entry: it has its own column and its own meaning. Persisting it here rather
 * than at completion is what lets a later phase re-enter and know verification
 * already happened (§11).
 */
export async function recordSourceIntegrity(
  supabase: SupabaseClient,
  params: {
    validationRunId: string;
    projectId: string;
    sourceIntegrity: SourceIntegrity;
    sandboxRuntime: string | null;
    stage: ValidationStage;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("validation_runs")
    .update({
      source_integrity: params.sourceIntegrity,
      sandbox_runtime: params.sandboxRuntime,
      stage: params.stage,
    })
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .eq("status", "running")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Writes the terminal result.
 *
 * Scoped to `status = 'running'` and reports whether it applied, so a workflow
 * replay cannot overwrite an already-terminal run — successful results are
 * immutable once written (§26).
 */
export async function completeValidationRun(
  supabase: SupabaseClient,
  params: {
    validationRunId: string;
    projectId: string;
    status: "passed" | "failed";
    stage: ValidationStage;
    steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
    failureCode: ValidationFailureCode | null;
    /** Already sanitized and bounded by the orchestrator. */
    failureDetail: string | null;
    sourceIntegrity: SourceIntegrity | null;
    sandboxRuntime: string | null;
    sandboxDurationMs: number | null;
    cleanupStatus: CleanupStatus;
    /**
     * A captured artifact, written in the same statement as the verdict.
     *
     * Not a convenience. `validation_runs_artifact_only_when_passed` refuses an
     * artifact on a row that is not `passed`, so recording it at capture time —
     * one step earlier, while the run is still `running` — violated the CHECK,
     * failed that step, and had it retried onto a sandbox the successful
     * snapshot had already stopped. Four dogfood rounds were spent on the
     * resulting `sandbox_lost` while the snapshot sat orphaned in provider
     * storage.
     *
     * Setting both in one UPDATE makes the constraint satisfiable by
     * construction: the row becomes `passed` and gains its artifact atomically,
     * or neither happens.
     */
    artifact?: { snapshotId: string; sizeBytes: number | null; expiresAt: string } | null;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("validation_runs")
    .update({
      status: params.status,
      // Only ever alongside `status: "passed"` — the caller supplies an
      // artifact only for a passing run, and the database enforces the rest.
      ...(params.artifact
        ? {
            artifact_snapshot_id: params.artifact.snapshotId,
            artifact_size_bytes: params.artifact.sizeBytes,
            artifact_expires_at: params.artifact.expiresAt,
          }
        : {}),
      stage: params.stage,
      steps: params.steps,
      failure_code: params.failureCode,
      failure_detail: params.failureDetail,
      source_integrity: params.sourceIntegrity,
      sandbox_runtime: params.sandboxRuntime,
      sandbox_duration_ms: params.sandboxDurationMs,
      cleanup_status: params.cleanupStatus,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.validationRunId)
    .eq("project_id", params.projectId)
    .eq("status", "running")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Records infrastructure spend (§25).
 *
 * Written for passes and failures alike: a sandbox that provisioned and then
 * failed still cost money, and a ledger that only records successes
 * systematically understates unit economics.
 */
export async function recordSandboxUsage(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    validationRunId: string;
    provider: SandboxProviderId;
    runtime: string | null;
    status: "passed" | "failed";
    sandboxDurationMs: number | null;
    usage: SandboxUsage | null;
    cleanupStatus: CleanupStatus;
    failureCode: ValidationFailureCode | null;
    failureDetail: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("sandbox_usage_events").insert({
    project_id: params.projectId,
    user_id: params.userId,
    validation_run_id: params.validationRunId,
    operation: "change_validation",
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
    failure_detail: params.failureDetail,
  });

  // A ledger write must never take down the operation that earned it: the run
  // already happened and its verdict is real. Surfaced by absence in the
  // ledger rather than by failing a completed validation.
  if (error) return;
}
