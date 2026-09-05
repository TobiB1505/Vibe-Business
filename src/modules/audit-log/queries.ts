import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEventType } from "./events";

/**
 * The audit log's read path (Sprint UI-2 Phase A).
 *
 * ## Why this did not exist before
 *
 * `audit_events` has been written since Sprint 1 and never read. UI-1 surfaced
 * that as an honest "not available yet" on the Activity section rather than
 * assembling a feed in the browser, and left building this as the smallest
 * genuinely useful data addition.
 *
 * ## The project filter
 *
 * `project_id` is a real column as of Sprint UI-2.5, backed by
 * `audit_events_project_id_created_at_idx` — `(project_id, created_at desc,
 * id desc)`, which is this query's access path exactly.
 *
 * It used to filter `metadata->>'projectId'`, because the table was designed
 * when the only events were account-level and had no project column. That was
 * correctly scoped but could not use an index, which is why the page size was
 * capped defensively. The cap is now a product decision rather than a
 * mitigation: a feed is for orientation, and an unbounded read of an
 * append-only log gets slower every day the product is used.
 *
 * ## Security
 *
 * Three independent layers, none of which is allowed to be the only one:
 *
 *  1. RLS — `select own audit_events` restricts every row to `auth.uid()`.
 *  2. The explicit `user_id` filter below, which is belt-and-braces against a
 *     policy being changed underneath this code.
 *  3. The caller must have already established that the project belongs to the
 *     user. `listAuditEventsForProject` takes `userId` rather than reading it
 *     from a session itself, so ownership is decided by the route, in one
 *     place, before this is reached.
 *
 * This deliberately uses the caller's RLS-bound client. The service-role client
 * bypasses RLS and is restricted to durable execution (CLAUDE.md rule 53);
 * reading a feed is not a reason to reach for it.
 */

/** A stored event, mapped out of its row shape and nothing more. */
export type AuditEventRecord = {
  id: string;
  eventType: AuditEventType;
  createdAt: string;
  /** Whatever the writer recorded. Never contains secrets — see ADR 0007/0008. */
  metadata: Record<string, unknown>;
};

type AuditEventRow = {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export type ListAuditEventsResult = {
  events: AuditEventRecord[];
  /** True when more rows exist beyond `limit`, so a page can offer "show more". */
  hasMore: boolean;
};

/**
 * Newest first, capped. `DEFAULT_ACTIVITY_LIMIT` is deliberately small: an
 * activity feed is for orientation, and an unbounded read of an append-only log
 * gets slower every day the product is used.
 */
export const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;

export function mapAuditEventRow(row: AuditEventRow): AuditEventRecord {
  return {
    id: row.id,
    eventType: row.event_type as AuditEventType,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

export async function listAuditEventsForProject(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    /** Taken from the verified session by the caller, never inferred here. */
    userId: string;
    limit?: number;
    offset?: number;
  },
): Promise<ListAuditEventsResult> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_ACTIVITY_LIMIT, 1), MAX_ACTIVITY_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);

  // One row beyond the page, so "is there more" costs no second query and no
  // `count`, which on an append-only log would scan more the longer it lives.
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, event_type, created_at, metadata")
    .eq("user_id", params.userId)
    .eq("project_id", params.projectId)
    // `created_at` alone is not deterministic: several events are written
    // within the same statement and can share a timestamp, which makes their
    // relative order arbitrary and a paged read able to skip or repeat one.
    // `id` breaks the tie stably.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const rows = (data ?? []) as AuditEventRow[];
  const hasMore = rows.length > limit;

  return {
    events: rows.slice(0, limit).map(mapAuditEventRow),
    hasMore,
  };
}

/**
 * The same log, unscoped by product (audit R24).
 *
 * ## Why the project filter is the whole difference
 *
 * `audit_events` is written per user, and a handful of the things it records
 * belong to no product at all: a Credit purchase, a GitHub account connected
 * or disconnected, an erasure requested. `listAuditEventsForProject` cannot
 * return those — its `project_id` filter excludes precisely the rows with no
 * project — so they were written and never read anywhere.
 *
 * Everything else is unchanged, deliberately: the same RLS, the same
 * `created_at, id` ordering that keeps a paged read from skipping or repeating
 * a row written in the same statement as its neighbour, and the same
 * one-row-beyond trick so "is there more" costs no second query.
 */
export async function listAuditEventsForAccount(
  supabase: SupabaseClient,
  params: {
    /** Taken from the verified session by the caller, never inferred here. */
    userId: string;
    limit?: number;
    offset?: number;
  },
): Promise<ListAuditEventsResult> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_ACTIVITY_LIMIT, 1), MAX_ACTIVITY_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);

  const { data, error } = await supabase
    .from("audit_events")
    .select("id, event_type, created_at, metadata")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const rows = (data ?? []) as AuditEventRow[];
  const hasMore = rows.length > limit;

  return {
    events: rows.slice(0, limit).map(mapAuditEventRow),
    hasMore,
  };
}
