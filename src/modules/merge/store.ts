import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeMerge, MergeFailureCode, MergeStatus, MergeStrategy } from "./schema";

/**
 * Persistence for merges (Sprint 11C §20, §31, §32).
 *
 * ## Two clients, two very different privileges
 *
 * `createChangeMerge` runs under the caller's cookie-scoped client, where the
 * insert policy independently re-verifies the approval, the commit, the base
 * and the repository. Everything below it runs under the service-role client
 * that only durable execution holds — because there is **no update policy** on
 * this table at all, so an authoritative transition is unreachable from a
 * browser by construction rather than by convention (§32).
 *
 * Every statement still filters on the project even under service role, exactly
 * as CLAUDE.md rule 53 requires: the client bypasses RLS, so ownership has to be
 * asserted by the query itself, taken from the persisted operation row.
 *
 * ## Why nothing here deletes
 *
 * A merge row is the record of a write to somebody's default branch. Blocked
 * and failed attempts are the most interesting rows in the table — they are the
 * evidence that the safety checks fired — and the database has no delete policy
 * to make losing them possible through the product.
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

const COLUMNS =
  "id, user_id, project_id, prepared_change_id, change_approval_id, repository_connection_id, " +
  "prepared_commit_sha, prepared_base_sha, default_branch, observed_default_head_before, " +
  "merge_policy_version, merge_strategy, merge_identity, operation_run_id, status, " +
  "resulting_default_head_sha, failure_code, preflight_checked_at, started_at, merged_at, " +
  "failed_at, created_at, updated_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): ChangeMerge {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    preparedChangeId: String(row.prepared_change_id),
    changeApprovalId: String(row.change_approval_id),
    repositoryConnectionId: String(row.repository_connection_id),
    preparedCommitSha: String(row.prepared_commit_sha),
    preparedBaseSha: String(row.prepared_base_sha),
    defaultBranch: String(row.default_branch),
    observedDefaultHeadBefore: (row.observed_default_head_before as string | null) ?? null,
    mergePolicyVersion: String(row.merge_policy_version),
    mergeStrategy: row.merge_strategy as MergeStrategy,
    mergeIdentity: String(row.merge_identity),
    operationRunId: (row.operation_run_id as string | null) ?? null,
    status: row.status as MergeStatus,
    resultingDefaultHeadSha: (row.resulting_default_head_sha as string | null) ?? null,
    failureCode: (row.failure_code as MergeFailureCode | null) ?? null,
    preflightCheckedAt: (row.preflight_checked_at as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    mergedAt: (row.merged_at as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type CreateMergeResult =
  | { ok: true; merge: ChangeMerge }
  /** The written-identity index refused a second in-flight or completed merge. */
  | { ok: false; error: "already_written" | "persistence_failed" };

/**
 * Records a requested merge (§20).
 *
 * Created as `preflight`: authorized by a human, nothing attempted. The insert
 * policy is what makes this more than an application check — a row cannot exist
 * unless the database itself can see an active approval by this user for this
 * exact commit and base.
 */
export async function createChangeMerge(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    changeApprovalId: string;
    repositoryConnectionId: string;
    preparedCommitSha: string;
    preparedBaseSha: string;
    defaultBranch: string;
    mergePolicyVersion: string;
    mergeStrategy: MergeStrategy;
    mergeIdentity: string;
    operationRunId: string;
  },
): Promise<CreateMergeResult> {
  const { data, error } = await supabase
    .from("change_merges")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      prepared_change_id: params.preparedChangeId,
      change_approval_id: params.changeApprovalId,
      repository_connection_id: params.repositoryConnectionId,
      prepared_commit_sha: params.preparedCommitSha,
      prepared_base_sha: params.preparedBaseSha,
      default_branch: params.defaultBranch,
      merge_policy_version: params.mergePolicyVersion,
      merge_strategy: params.mergeStrategy,
      merge_identity: params.mergeIdentity,
      operation_run_id: params.operationRunId,
      status: "preflight",
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_written" };
    return { ok: false, error: "persistence_failed" };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, merge: mapRow(data as unknown as Row) };
}

export async function getChangeMerge(
  supabase: SupabaseClient,
  params: { projectId: string; mergeId: string },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("id", params.mergeId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/** The merge a workflow step is executing. Ownership comes from the operation. */
export async function findMergeByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .select(COLUMNS)
    .eq("operation_run_id", operationRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The merge that is in flight or already written for one exact artifact.
 *
 * The authority question — "has this already been merged?" — and therefore
 * matched by identity, never by "the latest merge for this change" (§3, §20).
 */
export async function findWrittenMergeByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; mergeIdentity: string },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("merge_identity", params.mergeIdentity)
    .in("status", ["merging", "merged"])
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The most recent merge attempt for a prepared change, in any state.
 *
 * A **display** question, never an authority one — the same discipline the
 * approval store applies to its own "latest" lookup. Whether a merge may
 * happen is only ever answered by identity plus a fresh preflight.
 */
export async function getLatestMergeForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
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
 * Records that the authoritative preflight passed (§9).
 *
 * Stores what GitHub said *now* — the branch name it resolved and the head it
 * observed — so a later reader can see what the merge believed immediately
 * before it acted, rather than having to trust that it checked.
 */
export async function recordMergePreflight(
  supabase: SupabaseClient,
  params: {
    mergeId: string;
    projectId: string;
    defaultBranch: string;
    observedDefaultHead: string;
  },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .update({
      default_branch: params.defaultBranch,
      observed_default_head_before: params.observedDefaultHead,
      preflight_checked_at: new Date().toISOString(),
    })
    .eq("id", params.mergeId)
    .eq("project_id", params.projectId)
    .eq("status", "preflight")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Marks the write as attempted, **before** it is attempted (§19, rule 50).
 *
 * Conditional on `status = 'preflight'`, which is what makes this the
 * transition that can only happen once: a replayed step finds the row already
 * in `merging` and gets null back, and null here means *do not write, read the
 * branch instead*. The row is the lock, not a variable in a workflow.
 */
export async function markMergeWriteAttempted(
  supabase: SupabaseClient,
  params: { mergeId: string; projectId: string },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .update({ status: "merging", started_at: new Date().toISOString() })
    .eq("id", params.mergeId)
    .eq("project_id", params.projectId)
    .eq("status", "preflight")
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    // The written-identity index refused: another merge of this exact artifact
    // is already writing or written. Treated as "not ours to write", which is
    // the same answer a lost race gets everywhere else in this codebase.
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return null;
    throw error;
  }
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records a verified merge (§22).
 *
 * `resultingDefaultHeadSha` is the head read back from GitHub by an independent
 * request, and the database refuses this update unless it equals the approved
 * commit. Two gates on the same fact, deliberately: the application checks it,
 * and the constraint means a bug in that check cannot produce a row claiming a
 * merge that did not happen.
 */
export async function markMergeVerified(
  supabase: SupabaseClient,
  params: { mergeId: string; projectId: string; resultingDefaultHeadSha: string },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .update({
      status: "merged",
      resulting_default_head_sha: params.resultingDefaultHeadSha,
      merged_at: new Date().toISOString(),
    })
    .eq("id", params.mergeId)
    .eq("project_id", params.projectId)
    // `preflight` is permitted, and deliberately: the default branch can
    // already hold the approved commit without Vibe having written it — a
    // replay, or a hand merge of the same commit (§20). That is a verified
    // outcome reached without an attempt, and refusing to record it would
    // leave a merge that plainly succeeded stuck reporting a verification
    // failure. `started_at` stays null, so the row still says truthfully that
    // Vibe wrote nothing.
    .in("status", ["preflight", "merging", "merged"])
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records a refusal that happened **before any write** (§29).
 *
 * Conditional on `status = 'preflight'` so this can never rewrite an attempt
 * that already touched GitHub into one that claims it did not. The constraint
 * enforces the same thing from below.
 */
export async function markMergeBlocked(
  supabase: SupabaseClient,
  params: { mergeId: string; projectId: string; failureCode: MergeFailureCode },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .update({
      status: "blocked",
      failure_code: params.failureCode,
      failed_at: new Date().toISOString(),
    })
    .eq("id", params.mergeId)
    .eq("project_id", params.projectId)
    .eq("status", "preflight")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records a merge that was attempted and did not end verified.
 *
 * `observedDefaultHead` is stored when the recovery read produced one, because
 * "we tried, and afterwards the branch was at X" is the single most useful
 * sentence in an ambiguous-write postmortem.
 *
 * Deliberately **cannot** move a row out of `preflight`. A merge that never
 * reached the write is `blocked`, and keeping the two transitions disjoint is
 * what stops a terminal error handler from quietly converting "we refused" into
 * "we tried and something went wrong" — a distinction a user reads completely
 * differently on a default branch.
 */
export async function markMergeFailed(
  supabase: SupabaseClient,
  params: {
    mergeId: string;
    projectId: string;
    failureCode: MergeFailureCode;
    observedDefaultHead?: string | null;
  },
): Promise<ChangeMerge | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .update({
      status: "failed",
      failure_code: params.failureCode,
      failed_at: new Date().toISOString(),
      ...(params.observedDefaultHead
        ? { resulting_default_head_sha: params.observedDefaultHead }
        : {}),
    })
    .eq("id", params.mergeId)
    .eq("project_id", params.projectId)
    .in("status", ["merging", "failed"])
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}
