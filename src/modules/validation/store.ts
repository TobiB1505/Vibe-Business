import type { SupabaseClient } from "@supabase/supabase-js";
import type { CleanupStatus } from "./orchestrator";
import type { SandboxUsage } from "./sandbox-port";
import type {
  SandboxProviderId,
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
  "status, stage, steps, failure_code, sandbox_duration_ms, cleanup_status, validation_identity, " +
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
    sandboxDurationMs: (row.sandbox_duration_ms as number | null) ?? null,
    cleanupStatus: (row.cleanup_status as CleanupStatus | null) ?? null,
    validationIdentity: String(row.validation_identity),
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

/**
 * A validation that already answered this exact question (§21).
 *
 * Only `passed` is reusable. A previous failure is not a durable fact about
 * the artifact: the build may have failed on a transient registry error, and
 * refusing to re-run would strand the user with a verdict they cannot retry.
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
    sandboxRuntime: string | null;
    sandboxDurationMs: number | null;
    cleanupStatus: CleanupStatus;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("validation_runs")
    .update({
      status: params.status,
      stage: params.stage,
      steps: params.steps,
      failure_code: params.failureCode,
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
  });

  // A ledger write must never take down the operation that earned it: the run
  // already happened and its verdict is real. Surfaced by absence in the
  // ledger rather than by failing a completed validation.
  if (error) return;
}
