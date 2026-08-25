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
