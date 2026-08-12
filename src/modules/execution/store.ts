import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExecutionCapability,
  ExecutionFailureCode,
  PreparedChangeStatus,
  PreparedFile,
} from "./schema";

/**
 * Persistence for prepared changes (Sprint 9B §2, §3, §4).
 *
 * References only. The GitHub branch is the canonical artifact, so this table
 * records *that* a change was prepared and where to find it — never what the
 * change contains. No diffs, no generated source, no API responses, no tokens.
 *
 * A successful prepared change is immutable: nothing here updates a `prepared`
 * row into a different commit. A new commit is a new preparation.
 */

export type StoredPreparedChange = {
  id: string;
  projectId: string;
  userId: string;
  operationRunId: string;
  opportunitySetId: string;
  opportunityId: string;
  capability: ExecutionCapability;
  capabilityVersion: string;
  repositorySnapshotId: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  commitSha: string | null;
  files: PreparedFile[];
  executionIdentity: string;
  status: PreparedChangeStatus;
  failureCode: ExecutionFailureCode | null;
  createdAt: string;
  completedAt: string | null;
};

type Row = {
  id: string;
  project_id: string;
  user_id: string;
  operation_run_id: string;
  opportunity_set_id: string;
  opportunity_id: string;
  execution_capability: ExecutionCapability;
  execution_version: string;
  repository_snapshot_id: string;
  base_branch: string;
  base_sha: string;
  branch_name: string;
  commit_sha: string | null;
  files: PreparedFile[] | null;
  execution_identity: string;
  status: PreparedChangeStatus;
  failure_code: ExecutionFailureCode | null;
  created_at: string;
  completed_at: string | null;
};

const COLUMNS =
  "id, project_id, user_id, operation_run_id, opportunity_set_id, opportunity_id, execution_capability, execution_version, repository_snapshot_id, base_branch, base_sha, branch_name, commit_sha, files, execution_identity, status, failure_code, created_at, completed_at";

function mapRow(row: Row): StoredPreparedChange {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    operationRunId: row.operation_run_id,
    opportunitySetId: row.opportunity_set_id,
    opportunityId: row.opportunity_id,
    capability: row.execution_capability,
    capabilityVersion: row.execution_version,
    repositorySnapshotId: row.repository_snapshot_id,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    branchName: row.branch_name,
    commitSha: row.commit_sha,
    files: row.files ?? [],
    executionIdentity: row.execution_identity,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/** A successful preparation for this exact identity, if one exists (§5). */
export async function findReusablePreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; executionIdentity: string },
): Promise<StoredPreparedChange | null> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("execution_identity", params.executionIdentity)
    .eq("status", "prepared")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Row) : null;
}

/** The prepared change an operation produced, or claimed before writing. */
export async function findPreparedChangeByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<StoredPreparedChange | null> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .select(COLUMNS)
    .eq("operation_run_id", operationRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Row) : null;
}

/** One prepared change the caller owns. Ownership is the query, not a check. */
/**
 * Every successfully prepared change for a project, newest first.
 *
 * Deliberately not scoped to the current opportunity set. A prepared change is
 * an **artifact**: a branch and a commit that exist in the customer's
 * repository whether or not the opportunity that motivated it is still in the
 * latest set. Looking it up through the live opportunity set — which is how the
 * project page originally reached it — made every prepared change silently
 * unreachable the moment opportunities were regenerated, even though the branch
 * was still sitting there.
 *
 * That is the same artifact-centric reasoning validation eligibility uses
 * (Sprint 10A §28): "does this commit build?" is a question about a commit, and
 * it does not stop being answerable because advice moved on.
 */
export async function listPreparedChangesForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredPreparedChange[]> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "prepared")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Row));
}

export async function getPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<StoredPreparedChange | null> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .select(COLUMNS)
    .eq("id", params.preparedChangeId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Row) : null;
}

export type ClaimResult =
  | { ok: true; preparedChange: StoredPreparedChange }
  | { ok: false; error: "already_active" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims a preparation before any repository write.
 *
 * Claiming first is what makes the write idempotent: the row exists before the
 * branch does, so a re-entry finds it and can decide whether to recover rather
 * than blindly writing again (§14, §15).
 */
export async function claimPreparedChange(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    operationRunId: string;
    opportunitySetId: string;
    opportunityId: string;
    capability: ExecutionCapability;
    capabilityVersion: string;
    repositorySnapshotId: string;
    baseBranch: string;
    baseSha: string;
    branchName: string;
    executionIdentity: string;
  },
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      operation_run_id: params.operationRunId,
      opportunity_set_id: params.opportunitySetId,
      opportunity_id: params.opportunityId,
      execution_capability: params.capability,
      execution_version: params.capabilityVersion,
      repository_snapshot_id: params.repositorySnapshotId,
      base_branch: params.baseBranch,
      base_sha: params.baseSha,
      branch_name: params.branchName,
      execution_identity: params.executionIdentity,
      status: "preparing",
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_active" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, preparedChange: mapRow(data as Row) };
}

/**
 * Records the commit. Scoped to `preparing`, so a replay of the persistence
 * step reports `false` instead of rewriting a finished result (§26).
 */
export async function markPreparedChangePrepared(
  supabase: SupabaseClient,
  params: { preparedChangeId: string; commitSha: string; files: PreparedFile[] },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .update({
      status: "prepared",
      commit_sha: params.commitSha,
      files: params.files,
      failure_code: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.preparedChangeId)
    .eq("status", "preparing")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function markPreparedChangeFailed(
  supabase: SupabaseClient,
  params: { preparedChangeId: string; failureCode: ExecutionFailureCode },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("prepared_changes")
    .update({
      status: "failed",
      failure_code: params.failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.preparedChangeId)
    .eq("status", "preparing")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}
