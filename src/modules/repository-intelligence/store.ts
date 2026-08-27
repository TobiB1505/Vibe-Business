import "server-only";
import { cache } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositoryIntelligenceSnapshot } from "./schema";
import type { AnalysisCompleteness, CompletenessReason } from "./budgets";

/**
 * Persistence for repository intelligence snapshots.
 *
 * Every query runs through the caller's request-scoped Supabase client,
 * so RLS is always in force — there is no service-role path here.
 */

export type SnapshotStatus = "pending" | "analyzing" | "completed" | "failed";

export type StoredSnapshot = {
  id: string;
  projectId: string;
  status: SnapshotStatus;
  commitSha: string;
  branch: string;
  analyzerVersion: string;
  completeness: AnalysisCompleteness | null;
  completenessReasons: CompletenessReason[];
  failureCode: string | null;
  result: RepositoryIntelligenceSnapshot | null;
  createdAt: string;
  completedAt: string | null;
};

type SnapshotRow = {
  id: string;
  project_id: string;
  status: SnapshotStatus;
  source_commit_sha: string;
  source_branch: string;
  analyzer_version: string;
  completeness: AnalysisCompleteness | null;
  completeness_reasons: string[] | null;
  failure_code: string | null;
  result: RepositoryIntelligenceSnapshot | null;
  created_at: string;
  completed_at: string | null;
};

function mapRow(row: SnapshotRow): StoredSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    commitSha: row.source_commit_sha,
    branch: row.source_branch,
    analyzerVersion: row.analyzer_version,
    completeness: row.completeness,
    completenessReasons: (row.completeness_reasons ?? []) as CompletenessReason[],
    failureCode: row.failure_code,
    result: row.result,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const SNAPSHOT_COLUMNS =
  "id, project_id, status, source_commit_sha, source_branch, analyzer_version, completeness, completeness_reasons, failure_code, result, created_at, completed_at";

/**
 * The newest attempt regardless of outcome, for honest status rows.
 *
 * "Vibe couldn't read your code last time" and "Vibe hasn't read your code
 * yet" are different sentences, and only the failed row can tell them apart.
 * Display-only: everything that consumes results keeps reading successful
 * snapshots.
 */
export async function getLatestSnapshotAttempt(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredSnapshot | null> {
  const { data, error } = await supabase
    .from("repository_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as SnapshotRow) : null;
}

/** The snapshot shown on the project page: the newest successful run. */
/**
 * Deduplicated per request (VB-022).
 *
 * The Business Health render asks fourteen questions at once and several of the
 * services answering them re-read the same documents underneath — the audit
 * three times, the repository snapshot four. Each is a JSONB document, so the
 * cost is bytes off the wire and parse time, repeated.
 *
 * `cache()` is per-render, keyed on the arguments — which works here only
 * because every caller in a render shares the one `supabase` instance
 * `requireProjectAccess` returned. A caller that made its own client would miss
 * the cache rather than get a stale answer, which is the right way round.
 *
 * Outside a render it does not memoize at all — measured, not assumed — so
 * durable execution keeps reading fresh state. That is what makes this safe to
 * put on a store shared with the workflow steps.
 */
async function getLatestSuccessfulSnapshotUncached(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredSnapshot | null> {
  const { data, error } = await supabase
    .from("repository_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as SnapshotRow) : null;
}

export const getLatestSuccessfulSnapshot = cache(getLatestSuccessfulSnapshotUncached);

/**
 * One specific snapshot, scoped to its project.
 *
 * Used by change preparation, which must read the snapshot its execution
 * identity was computed from rather than whichever is newest — otherwise the
 * same identity could generate different bytes on a replay.
 *
 * The `project_id` predicate is not redundant. This runs under the service-role
 * client during durable execution, where RLS is bypassed, so ownership has to
 * be asserted explicitly from the persisted operation row (ADR 0013).
 */
export async function getSnapshotById(
  supabase: SupabaseClient,
  params: { snapshotId: string; projectId: string },
): Promise<StoredSnapshot | null> {
  const { data, error } = await supabase
    .from("repository_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("id", params.snapshotId)
    .eq("project_id", params.projectId)
    .eq("status", "completed")
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as SnapshotRow) : null;
}

/**
 * Reuse lookup (Sprint 2 §31). A successful snapshot for the same commit
 * *and* the same analyzer version is still valid — nothing about the
 * inputs or the rules has changed, so re-reading GitHub would be pure
 * waste.
 */
export async function findReusableSnapshot(
  supabase: SupabaseClient,
  params: { projectId: string; commitSha: string; analyzerVersion: string },
): Promise<StoredSnapshot | null> {
  const { data, error } = await supabase
    .from("repository_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("source_commit_sha", params.commitSha)
    .eq("analyzer_version", params.analyzerVersion)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as SnapshotRow) : null;
}

export type CreateRunResult =
  | { ok: true; snapshotId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims an analysis run. The partial unique index on in-flight rows
 * turns a double submission into a unique-constraint violation, which is
 * reported as `already_running` rather than starting a second analysis
 * (Sprint 2 §32) — no queue or external lock involved.
 */
export async function createAnalysisRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    repositoryConnectionId: string;
    commitSha: string;
    branch: string;
    analyzerVersion: string;
    schemaVersion: string;
  },
): Promise<CreateRunResult> {
  const { data, error } = await supabase
    .from("repository_intelligence_snapshots")
    .insert({
      project_id: params.projectId,
      repository_connection_id: params.repositoryConnectionId,
      source_commit_sha: params.commitSha,
      source_branch: params.branch,
      analyzer_version: params.analyzerVersion,
      schema_version: params.schemaVersion,
      status: "analyzing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_running" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, snapshotId: data.id };
}

export async function completeAnalysisRun(
  supabase: SupabaseClient,
  snapshotId: string,
  snapshot: RepositoryIntelligenceSnapshot,
): Promise<void> {
  const { error } = await supabase
    .from("repository_intelligence_snapshots")
    .update({
      status: "completed",
      result: snapshot,
      completeness: snapshot.completeness.status,
      completeness_reasons: snapshot.completeness.reasons,
      completed_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  if (error) throw error;
}

/**
 * Marks a run failed with a typed code only. A failed row never carries a
 * `result`, so it cannot displace the latest successful snapshot the user
 * sees (Sprint 2 §20).
 */
export async function failAnalysisRun(
  supabase: SupabaseClient,
  snapshotId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("repository_intelligence_snapshots")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  if (error) {
    console.error("[repository-intelligence] failed to record run failure", { snapshotId });
  }
}
