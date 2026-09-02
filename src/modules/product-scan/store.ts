import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_SCAN_EVENT_LIMIT, type ProductScanEvent, type ProductScanEventType, type ProductScanPhase, type ProductScanSource } from "./schema";

type EventRow = {
  id: string;
  operation_run_id: string;
  sequence: number;
  event_key: string;
  type: ProductScanEventType;
  phase: ProductScanPhase;
  source: ProductScanSource;
  finding_key: string | null;
  title: string;
  detail: string | null;
  reference_id: string | null;
  occurred_at: string;
};

const EVENT_COLUMNS =
  "id, operation_run_id, sequence, event_key, type, phase, source, finding_key, title, detail, reference_id, occurred_at";

function mapEvent(row: EventRow): ProductScanEvent {
  return {
    id: row.id,
    operationId: row.operation_run_id,
    sequence: row.sequence,
    eventKey: row.event_key,
    type: row.type,
    phase: row.phase,
    source: row.source,
    findingKey: row.finding_key,
    title: row.title,
    detail: row.detail,
    referenceId: row.reference_id,
    occurredAt: row.occurred_at,
  };
}

export type AppendProductScanEvent = {
  eventKey: string;
  type: ProductScanEventType;
  phase: ProductScanPhase;
  source: ProductScanSource;
  findingKey?: string;
  title: string;
  detail?: string;
  referenceId?: string;
};

/**
 * Appends a bounded run of events in one pass (PERF-008).
 *
 * ## Why this is the primitive and the single append is the wrapper
 *
 * Because the callers append in runs. `scanRepositoryStep` and
 * `scanLiveProductStep` each walk a finding list and appended one event at a
 * time, and one append was four sequential round trips — verify the run, look
 * for the key, read the tail sequence, insert. At the cap of
 * `PRODUCT_SCAN_EVENT_LIMIT` that was up to 96 round trips inside a workflow
 * step, while the browser polls the same operation every 1.8 seconds and sees
 * the timeline fill one row at a time.
 *
 * Here the first three of those happen once for the whole run: the run is
 * verified, and one read of the existing events answers both remaining
 * questions — which keys are already present, and where the sequence has got
 * to. The table is capped at 24 rows, so that read is bounded by construction.
 *
 * ## What is preserved exactly
 *
 * **Replay cannot duplicate the timeline.** An event whose key is already
 * present is skipped rather than re-inserted, which is what the per-event
 * existence check did.
 *
 * **A concurrent replay is not an error.** Both unique keys are still live —
 * `(operation_run_id, event_key)` and `(operation_run_id, sequence)` — so a
 * second runner can still win either one. `23505` is answered the way the
 * single append answered it: by reading the run's events back and returning
 * those, rather than surfacing an internal race to the customer.
 *
 * **The cap is the database's.** Sequences are assigned from the tail and the
 * list is truncated at `PRODUCT_SCAN_EVENT_LIMIT`, so the CHECK constraint is
 * never the thing that refuses.
 */
export async function appendProductScanEvents(
  supabase: SupabaseClient,
  params: {
    operationId: string;
    projectId: string;
    userId: string;
    events: readonly AppendProductScanEvent[];
  },
): Promise<ProductScanEvent[]> {
  if (params.events.length === 0) return [];

  const { data: operation } = await supabase
    .from("operation_runs")
    .select("id")
    .eq("id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .eq("operation_type", "product_scan")
    .maybeSingle();
  if (!operation) return [];

  // One read for both remaining questions. Bounded by the table's own cap.
  const { data: present, error: presentError } = await supabase
    .from("product_scan_events")
    .select(EVENT_COLUMNS)
    .eq("operation_run_id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .order("sequence", { ascending: true })
    .limit(PRODUCT_SCAN_EVENT_LIMIT);
  if (presentError) throw presentError;

  const existing = (present ?? []).map((row) => mapEvent(row as EventRow));
  const seen = new Set(existing.map((event) => event.eventKey));
  let sequence = existing.reduce((highest, event) => Math.max(highest, event.sequence), 0);

  const rows: Record<string, unknown>[] = [];
  for (const event of params.events) {
    if (seen.has(event.eventKey)) continue;
    if (sequence >= PRODUCT_SCAN_EVENT_LIMIT) break;
    seen.add(event.eventKey);
    sequence += 1;
    rows.push({
      operation_run_id: params.operationId,
      project_id: params.projectId,
      user_id: params.userId,
      sequence,
      event_key: event.eventKey.slice(0, 80),
      type: event.type,
      phase: event.phase,
      source: event.source,
      finding_key: event.findingKey?.slice(0, 80) ?? null,
      title: event.title.slice(0, 160),
      detail: event.detail?.slice(0, 240) ?? null,
      reference_id: event.referenceId ?? null,
    });
  }

  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("product_scan_events")
    .insert(rows)
    .select(EVENT_COLUMNS);

  if (error) {
    if (error.code === "23505") {
      return getProductScanEventsForRunner(supabase, params);
    }
    throw error;
  }

  return (data ?? []).map((row) => mapEvent(row as EventRow));
}

/** The run's events, read back after a race. */
async function getProductScanEventsForRunner(
  supabase: SupabaseClient,
  params: { operationId: string; projectId: string; userId: string },
): Promise<ProductScanEvent[]> {
  const { data } = await supabase
    .from("product_scan_events")
    .select(EVENT_COLUMNS)
    .eq("operation_run_id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .order("sequence", { ascending: true })
    .limit(PRODUCT_SCAN_EVENT_LIMIT);
  return (data ?? []).map((row) => mapEvent(row as EventRow));
}

/**
 * Appends one bounded event. A repeated workflow step returns the event it
 * already wrote, so durable replay cannot duplicate the visible timeline.
 */
export async function appendProductScanEvent(
  supabase: SupabaseClient,
  params: { operationId: string; projectId: string; userId: string; event: AppendProductScanEvent },
): Promise<ProductScanEvent | null> {
  const { data: operation } = await supabase
    .from("operation_runs")
    .select("id")
    .eq("id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .eq("operation_type", "product_scan")
    .maybeSingle();
  if (!operation) return null;

  const { data: existing, error: existingError } = await supabase
    .from("product_scan_events")
    .select(EVENT_COLUMNS)
    .eq("operation_run_id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .eq("event_key", params.event.eventKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return mapEvent(existing as EventRow);

  const { data: tail, error: tailError } = await supabase
    .from("product_scan_events")
    .select("sequence")
    .eq("operation_run_id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tailError) throw tailError;

  const sequence = ((tail as { sequence: number } | null)?.sequence ?? 0) + 1;
  if (sequence > PRODUCT_SCAN_EVENT_LIMIT) return null;

  const { data, error } = await supabase
    .from("product_scan_events")
    .insert({
      operation_run_id: params.operationId,
      project_id: params.projectId,
      user_id: params.userId,
      sequence,
      event_key: params.event.eventKey.slice(0, 80),
      type: params.event.type,
      phase: params.event.phase,
      source: params.event.source,
      finding_key: params.event.findingKey?.slice(0, 80) ?? null,
      title: params.event.title.slice(0, 160),
      detail: params.event.detail?.slice(0, 240) ?? null,
      reference_id: params.event.referenceId ?? null,
    })
    .select(EVENT_COLUMNS)
    .single();

  if (error) {
    // A concurrent replay may have won either unique key. Read by the stable
    // event key rather than surfacing an internal race to the customer.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("product_scan_events")
        .select(EVENT_COLUMNS)
        .eq("operation_run_id", params.operationId)
        .eq("project_id", params.projectId)
        .eq("user_id", params.userId)
        .eq("event_key", params.event.eventKey)
        .maybeSingle();
      return raced ? mapEvent(raced as EventRow) : null;
    }
    throw error;
  }

  return mapEvent(data as EventRow);
}

/** Browser reads remain RLS-scoped and are additionally tied to the project. */
export async function getProductScanEvents(
  supabase: SupabaseClient,
  params: { projectId: string; operationId: string },
): Promise<ProductScanEvent[]> {
  const { data, error } = await supabase
    .from("product_scan_events")
    .select(EVENT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("operation_run_id", params.operationId)
    .order("sequence", { ascending: true })
    .limit(PRODUCT_SCAN_EVENT_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => mapEvent(row as EventRow));
}

/**
 * Exact successful source records claimed by this scan. An unavailable source
 * stays null even when an older successful snapshot exists for the project.
 */
export async function getProductScanSourceReferences(
  supabase: SupabaseClient,
  params: { operationId: string; projectId: string; userId: string },
): Promise<{ repositorySnapshotId: string | null; liveSnapshotId: string | null }> {
  const { data, error } = await supabase
    .from("product_scan_events")
    .select("event_key, reference_id")
    .eq("operation_run_id", params.operationId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .in("event_key", ["repository.ready", "live.ready"]);
  if (error) throw error;

  const references = new Map(
    (data ?? []).map((row) => [row.event_key as string, row.reference_id as string | null]),
  );
  return {
    repositorySnapshotId: references.get("repository.ready") ?? null,
    liveSnapshotId: references.get("live.ready") ?? null,
  };
}
