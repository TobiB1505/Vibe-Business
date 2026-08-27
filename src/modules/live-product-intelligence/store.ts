import "server-only";
import { cache } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrawlCompleteness, CrawlCompletenessReason } from "./budgets";
import type { LiveProductIntelligenceSnapshot } from "./schema";

/**
 * Persistence for live product intelligence snapshots.
 *
 * Every query runs through the caller's request-scoped Supabase client,
 * so RLS is always in force — there is no service-role path here.
 */

export type SnapshotStatus = "pending" | "analyzing" | "completed" | "failed";

export type StoredLiveSnapshot = {
  id: string;
  projectId: string;
  status: SnapshotStatus;
  sourceOrigin: string;
  configuredUrl: string;
  analyzerVersion: string;
  completeness: CrawlCompleteness | null;
  completenessReasons: CrawlCompletenessReason[];
  failureCode: string | null;
  result: LiveProductIntelligenceSnapshot | null;
  createdAt: string;
  completedAt: string | null;
};

type SnapshotRow = {
  id: string;
  project_id: string;
  status: SnapshotStatus;
  source_origin: string;
  configured_url: string;
  analyzer_version: string;
  completeness: CrawlCompleteness | null;
  completeness_reasons: string[] | null;
  failure_code: string | null;
  result: LiveProductIntelligenceSnapshot | null;
  created_at: string;
  completed_at: string | null;
};

function mapRow(row: SnapshotRow): StoredLiveSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    sourceOrigin: row.source_origin,
    configuredUrl: row.configured_url,
    analyzerVersion: row.analyzer_version,
    completeness: row.completeness,
    completenessReasons: (row.completeness_reasons ?? []) as CrawlCompletenessReason[],
    failureCode: row.failure_code,
    result: row.result,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const SNAPSHOT_COLUMNS =
  "id, project_id, status, source_origin, configured_url, analyzer_version, completeness, completeness_reasons, failure_code, result, created_at, completed_at";

/**
 * The newest attempt regardless of outcome, for honest status rows.
 *
 * "Vibe couldn't reach your product last time" and "Vibe hasn't visited it
 * yet" are different sentences, and only the failed row can tell them apart.
 * Display-only: everything that consumes results keeps reading successful
 * snapshots.
 */
export async function getLatestLiveSnapshotAttempt(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredLiveSnapshot | null> {
  const { data, error } = await supabase
    .from("live_product_intelligence_snapshots")
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
async function getLatestSuccessfulLiveSnapshotUncached(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredLiveSnapshot | null> {
  const { data, error } = await supabase
    .from("live_product_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as SnapshotRow) : null;
}

export const getLatestSuccessfulLiveSnapshot = cache(getLatestSuccessfulLiveSnapshotUncached);

/** One exact successful reading, scoped to the operation's persisted project. */
export async function getLiveSnapshotById(
  supabase: SupabaseClient,
  params: { snapshotId: string; projectId: string },
): Promise<StoredLiveSnapshot | null> {
  const { data, error } = await supabase
    .from("live_product_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("id", params.snapshotId)
    .eq("project_id", params.projectId)
    .eq("status", "completed")
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as SnapshotRow) : null;
}

/**
 * Freshness window for snapshot reuse (Sprint 3 §27).
 *
 * A live website has no commit SHA, so there is no honest way to know
 * whether it changed since the last look. Recency is therefore the only
 * defensible reuse key: within the window we reuse, outside it we
 * re-crawl, and the UI never claims the site is unchanged — only when it
 * was last analysed.
 */
export const SNAPSHOT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function isSnapshotFresh(completedAt: string | null, now: number = Date.now()): boolean {
  if (completedAt === null) return false;
  const timestamp = Date.parse(completedAt);
  if (Number.isNaN(timestamp)) return false;
  return now - timestamp < SNAPSHOT_FRESHNESS_MS;
}

/**
 * Finds a snapshot still valid for reuse: same origin, same analyzer, and
 * recent enough. A changed production URL invalidates reuse immediately,
 * because it is a different product surface.
 */
export async function findReusableLiveSnapshot(
  supabase: SupabaseClient,
  params: { projectId: string; sourceOrigin: string; analyzerVersion: string },
): Promise<StoredLiveSnapshot | null> {
  const { data, error } = await supabase
    .from("live_product_intelligence_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("source_origin", params.sourceOrigin)
    .eq("analyzer_version", params.analyzerVersion)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const snapshot = mapRow(data as SnapshotRow);
  return isSnapshotFresh(snapshot.completedAt) ? snapshot : null;
}

export type CreateLiveRunResult =
  | { ok: true; snapshotId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims an analysis run. The partial unique index on in-flight rows
 * turns a double submission into a unique-constraint violation, reported
 * as `already_running` rather than starting a second crawl
 * (Sprint 3 §28) — no queue or external lock involved.
 */
export async function createLiveAnalysisRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    sourceOrigin: string;
    configuredUrl: string;
    analyzerVersion: string;
    schemaVersion: string;
  },
): Promise<CreateLiveRunResult> {
  const { data, error } = await supabase
    .from("live_product_intelligence_snapshots")
    .insert({
      project_id: params.projectId,
      source_origin: params.sourceOrigin,
      configured_url: params.configuredUrl,
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

export async function completeLiveAnalysisRun(
  supabase: SupabaseClient,
  snapshotId: string,
  snapshot: LiveProductIntelligenceSnapshot,
): Promise<void> {
  const { error } = await supabase
    .from("live_product_intelligence_snapshots")
    .update({
      status: "completed",
      result: snapshot,
      source_origin: snapshot.source.effectiveOrigin,
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
 * sees (Sprint 3 §26).
 */
export async function failLiveAnalysisRun(
  supabase: SupabaseClient,
  snapshotId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("live_product_intelligence_snapshots")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);

  if (error) {
    console.error("[live-product-intelligence] failed to record run failure", { snapshotId });
  }
}
