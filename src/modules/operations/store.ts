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
  /** Null for an account-level operation, never for a project one (ADR 0057 §1). */
  projectId: string | null;
  /** Null once this operation's owner has been erased (ADR 0057 §2). */
  userId: string | null;
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
  /** How many times this operation has been paused for the user (ADR 0042 §P2). */
  pauseCycle: number;
};

type OperationRow = {
  id: string;
  project_id: string | null;
  user_id: string | null;
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
  pause_cycle: number;
};

const OPERATION_COLUMNS =
  "id, project_id, user_id, operation_type, status, stage, input_identity, workflow_run_id, execution_provider, subject_id, result_id, inference_started_at, failure_code, started_at, completed_at, created_at, updated_at, pause_cycle";

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
    pauseCycle: row.pause_cycle,
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

/**
 * An operation that is about a project, carrying both owner columns.
 *
 * ADR 0057 made `projectId` and `userId` nullable so that an account-level
 * operation can exist at all, and so an erasure's own row can outlive the
 * identity it erases. Fifteen of the sixteen operation types are unaffected:
 * they always have both, and every executor is written on that basis.
 *
 * Saying so once, here, is the alternative to ninety-eight non-null assertions
 * scattered through the executors — and it is a better one, because an
 * assertion states a belief while this states a *check*. An operation that
 * somehow reached a project executor without a project stops there instead of
 * failing later on a null nobody expected.
 */
export type ProjectOperationRun = StoredOperationRun & { projectId: string; userId: string };

/**
 * Loads an operation and refuses it unless it is project-scoped.
 *
 * The project executors use this rather than {@link getOperationRunById}; the
 * account level uses the untyped one. Null means either "no such operation" or
 * "that operation is not about a project" — deliberately the same answer to a
 * caller that can do nothing useful with the distinction.
 */
export async function getProjectOperationRunById(
  supabase: SupabaseClient,
  operationId: string,
): Promise<ProjectOperationRun | null> {
  const operation = await getOperationRunById(supabase, operationId);
  if (!operation || operation.projectId === null || operation.userId === null) return null;

  return operation as ProjectOperationRun;
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
    /** Null for an account-level operation — the subject, not a missing value. */
    projectId: string | null;
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
 *
 * ## `pauseCycle` (ADR 0042 §P2)
 *
 * Any held Credits are released by the caller once this returns — the pause
 * itself never touches billing, matching every other call in this file. What
 * this function *does* provide is the number the release's later re-acquire
 * needs: `pause_cycle`, read fresh and incremented in the same guarded UPDATE.
 * No separate CAS is needed for it — the status guard already ensures at most
 * one caller's write ever lands for a given pause, so whichever value that
 * caller computed is the only one ever observed. `null` means this call lost
 * the guard (the operation was not `queued`/`running`), so there is no new
 * cycle to report.
 */
export async function pauseOperationForUser(
  supabase: SupabaseClient,
  operationId: string,
): Promise<{ paused: boolean; pauseCycle: number | null }> {
  const { data: current, error: readError } = await supabase
    .from("operation_runs")
    .select("pause_cycle")
    .eq("id", operationId)
    .single();

  if (readError) throw readError;

  const nextCycle = (current as { pause_cycle: number }).pause_cycle + 1;

  const { data, error } = await supabase
    .from("operation_runs")
    .update({ status: "needs_user", pause_cycle: nextCycle })
    .eq("id", operationId)
    .in("status", ["queued", "running"])
    .select("id");

  if (error) throw error;

  const paused = (data ?? []).length > 0;
  return { paused, pauseCycle: paused ? nextCycle : null };
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
  params: {
    operationId: string;
    /**
     * The row this operation produced, or null when it produced none.
     *
     * Null is legal for `account_erasure` alone, and the database says so
     * rather than this comment: the `operation_runs_completed_has_result`
     * check names that one type (ADR 0057 §4). An erasure's product is
     * absence, and inventing a row so a constraint is satisfied would be a lie
     * told to a `CHECK`. Passing null from any other operation type is
     * rejected by PostgreSQL, not by trust.
     */
    resultId: string | null;
  },
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
