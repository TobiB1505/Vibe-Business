import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationStage, OperationStatus, OperationType } from "./schema";

/**
 * Persistence for durable operations (Sprint 7 §6, §15).
 *
 * Supabase is the source of truth for operation state. The execution provider
 * orchestrates; it does not own what the product knows. That is what makes the
 * project page able to answer "is something running?" after a reload, and what
 * keeps a future change of execution provider from being a data migration.
 *
 * Every function takes its client as an argument. The browser read path passes
 * the cookie-scoped client and gets RLS; workflow steps pass the service-role
 * client and get the explicit ownership predicates below instead (ADR 0013).
 */

export type StoredOperationRun = {
  id: string;
  projectId: string;
  userId: string;
  operationType: OperationType;
  status: OperationStatus;
  stage: OperationStage;
  inputIdentity: string;
  workflowRunId: string | null;
  executionProvider: string | null;
  /** The domain object this operation acts on, when it has one. */
  subjectId: string | null;
  /** The row this operation produced — an audit, an opportunity set, … */
  resultId: string | null;
  inferenceStartedAt: string | null;
  failureCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type OperationRow = {
  id: string;
  project_id: string;
  user_id: string;
  operation_type: OperationType;
  status: OperationStatus;
  stage: OperationStage;
  input_identity: string;
  workflow_run_id: string | null;
  execution_provider: string | null;
  subject_id: string | null;
  result_id: string | null;
  inference_started_at: string | null;
  failure_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const OPERATION_COLUMNS =
  "id, project_id, user_id, operation_type, status, stage, input_identity, workflow_run_id, execution_provider, subject_id, result_id, inference_started_at, failure_code, started_at, completed_at, created_at, updated_at";

function mapRow(row: OperationRow): StoredOperationRun {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    operationType: row.operation_type,
    status: row.status,
    stage: row.stage,
    inputIdentity: row.input_identity,
    workflowRunId: row.workflow_run_id,
    executionProvider: row.execution_provider,
    subjectId: row.subject_id,
    resultId: row.result_id,
    inferenceStartedAt: row.inference_started_at,
    failureCode: row.failure_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACTIVE_STATUSES = ["queued", "running"] as const;

/** The live operation for one exact input identity, if any (§9). */
export async function findActiveOperationByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; operationType: OperationType; inputIdentity: string },
): Promise<StoredOperationRun | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select(OPERATION_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("operation_type", params.operationType)
    .eq("input_identity", params.inputIdentity)
    .in("status", [...ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as OperationRow) : null;
}

/**
 * Any live operation for a project, regardless of identity.
 *
 * This is what the project page asks on load so that returning to the tab
 * shows "Analyzing…" rather than an inviting button (§19).
 */
export async function findActiveOperation(
  supabase: SupabaseClient,
  params: { projectId: string; operationType: OperationType },
): Promise<StoredOperationRun | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select(OPERATION_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("operation_type", params.operationType)
    .in("status", [...ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as OperationRow) : null;
}

/**
 * The most recent attempt of a type, whatever became of it.
 *
 * `findActiveOperation` answers "is something happening"; this answers "what
 * happened last". Onboarding needs the second question because a failed
 * operation stops being active the moment it fails, and a screen that only ever
 * asked the first question responded to a failure by quietly redrawing the
 * start button — which is indistinguishable, to the person looking at it, from
 * having never pressed it (UI-S1 §15).
 */
export async function findLatestOperation(
  supabase: SupabaseClient,
  params: { projectId: string; operationType: OperationType },
): Promise<StoredOperationRun | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select(OPERATION_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("operation_type", params.operationType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as OperationRow) : null;
}

/** One operation the caller owns. Ownership is the query, not a later check. */
export async function getOperationRun(
  supabase: SupabaseClient,
  params: { projectId: string; operationId: string },
): Promise<StoredOperationRun | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select(OPERATION_COLUMNS)
    .eq("id", params.operationId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as OperationRow) : null;
}

/** Used by workflow steps, which know an operation id and nothing else. */
export async function getOperationRunById(
  supabase: SupabaseClient,
  operationId: string,
): Promise<StoredOperationRun | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select(OPERATION_COLUMNS)
    .eq("id", operationId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as OperationRow) : null;
}

export type CreateOperationResult =
  | { ok: true; operation: StoredOperationRun }
  | { ok: false; error: "already_active" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims an operation for one input identity.
 *
 * The partial unique index turns a double submission into a constraint
 * violation rather than a second workflow, so two clicks 20ms apart — which
 * both pass an application-level "is one running?" check — still buy exactly
 * one inference call (§8).
 */
export async function createOperationRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    operationType: OperationType;
    inputIdentity: string;
    /** The domain object this operation acts on, when it has one. */
    subjectId?: string;
  },
): Promise<CreateOperationResult> {
  const { data, error } = await supabase
    .from("operation_runs")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      operation_type: params.operationType,
      input_identity: params.inputIdentity,
      ...(params.subjectId ? { subject_id: params.subjectId } : {}),
      status: "queued",
      stage: "preparing",
    })
    .select(OPERATION_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_active" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, operation: mapRow(data as OperationRow) };
}

/** Records which durable run is carrying this operation. Support metadata only. */
export async function attachExecutionRun(
  supabase: SupabaseClient,
  params: { operationId: string; workflowRunId: string; executionProvider: string },
): Promise<void> {
  const { error } = await supabase
    .from("operation_runs")
    .update({
      workflow_run_id: params.workflowRunId,
      execution_provider: params.executionProvider,
    })
    .eq("id", params.operationId);

  if (error) throw error;
}

/**
 * Moves a live operation to a new stage.
 *
 * Scoped to live statuses so a late step cannot resurrect a terminal
 * operation — a completed operation is immutable (§5).
 */
export async function setOperationStage(
  supabase: SupabaseClient,
  params: { operationId: string; stage: OperationStage; markRunning?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = { stage: params.stage };
  if (params.markRunning) {
    patch.status = "running";
    patch.started_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("operation_runs")
    .update(patch)
    .eq("id", params.operationId)
    .in("status", [...ACTIVE_STATUSES]);

  if (error) throw error;
}

/**
 * Records the row this operation claimed, before inference runs.
 *
 * The hinge of the paid-call safety story (Sprint 7 §11, §12): a step that
 * re-enters and finds `result_id` already set knows a provider call may
 * already have been made, and refuses to make another.
 */
export async function claimResultForOperation(
  supabase: SupabaseClient,
  params: { operationId: string; resultId: string },
): Promise<void> {
  const { error } = await supabase
    .from("operation_runs")
    .update({ result_id: params.resultId })
    .eq("id", params.operationId);

  if (error) throw error;
}

/**
 * Records that a paid provider call is about to be made.
 *
 * Written before the call and never cleared. If the step dies between this
 * write and the provider's response, the marker is what tells a later re-entry
 * that billing state is ambiguous — and ambiguity must resolve to failure, not
 * to a second charge (§11).
 */
/** The paused operation carrying a specific audit, if one is waiting. */
export async function findPausedOperationForAudit(
  supabase: SupabaseClient,
  params: { projectId: string; auditId: string },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select("id")
    .eq("project_id", params.projectId)
    .eq("operation_type", "business_audit")
    .eq("result_id", params.auditId)
    .eq("status", "needs_user")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? { id: data.id as string } : null;
}

/**
 * Stops the operation in front of a question (CORE-2a.4).
 *
 * `running → needs_user`. The run keeps its claim on its inputs, so nothing
 * else can start for the same work while a person is thinking, and it re-enters
 * at `queued` when the answer arrives.
 *
 * Guarded on the current status so a replayed step cannot re-pause an
 * operation the founder has already answered.
 */
export async function pauseOperationForUser(
  supabase: SupabaseClient,
  operationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("operation_runs")
    .update({ status: "needs_user" })
    .eq("id", operationId)
    .in("status", ["queued", "running"]);

  if (error) throw error;
}

/**
 * Puts a paused operation back in the queue after its question is answered.
 *
 * Matches on `needs_user`, which is what makes a double submission harmless:
 * the second one updates nothing and cannot start a second run (§38, §53).
 */
export async function requeueAnsweredOperation(
  supabase: SupabaseClient,
  operationId: string,
): Promise<{ requeued: boolean }> {
  const { data, error } = await supabase
    .from("operation_runs")
    .update({ status: "queued", stage: "preparing" })
    .eq("id", operationId)
    .eq("status", "needs_user")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return { requeued: data !== null };
}

export async function markInferenceStarted(
  supabase: SupabaseClient,
  operationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("operation_runs")
    .update({ inference_started_at: new Date().toISOString() })
    .eq("id", operationId)
    .is("inference_started_at", null);

  if (error) throw error;
}

/**
 * Terminal transitions return whether *this* call performed them.
 *
 * `false` means the operation was already terminal — which is the signal a
 * replayed step needs to skip emitting a second completion event (§12, §23).
 */
export async function completeOperationRun(
  supabase: SupabaseClient,
  params: { operationId: string; resultId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("operation_runs")
    .update({
      status: "completed",
      stage: "completed",
      result_id: params.resultId,
      failure_code: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.operationId)
    .in("status", [...ACTIVE_STATUSES])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function failOperationRun(
  supabase: SupabaseClient,
  params: { operationId: string; failureCode: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("operation_runs")
    .update({
      status: "failed",
      failure_code: params.failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.operationId)
    .in("status", [...ACTIVE_STATUSES])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}
