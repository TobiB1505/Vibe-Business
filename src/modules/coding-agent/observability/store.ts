import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_EVENTS_PER_RUN,
  isAdmissibleSequence,
  type EventAudience,
  type ExecutionEventMetadata,
  type ExecutionEventType,
  type ExecutionPhase,
  type StoredExecutionEvent,
} from "./events";

/**
 * Reading and writing the execution event log.
 *
 * ## Idempotent by construction
 *
 * Every write is an upsert on `(run, sequence)`. That is not a convenience: the
 * poll step re-reads the whole progress file each time it runs, so it re-offers
 * events it has already written, and a workflow retry re-offers all of them. A
 * unique key plus an upsert makes "write everything we can see" the correct
 * operation at every point, which is much easier to be sure of than a cursor.
 *
 * ## Why the cap is enforced on write rather than trusted
 *
 * The file names in these events come from a customer's repository, and an
 * agent can be induced to touch files in a loop. `MAX_EVENTS_PER_RUN` is the
 * ceiling on what one execution can put in this table, checked against the
 * sequence rather than against a count — so it holds under concurrency and
 * under retries without a read-modify-write.
 */

export type ExecutionEventRow = StoredExecutionEvent;

export async function recordExecutionEvents(
  supabase: SupabaseClient,
  params: {
    runId: string;
    projectId: string;
    userId: string;
    events: readonly StoredExecutionEvent[];
  },
): Promise<void> {
  const admissible = params.events.filter((event) => isAdmissibleSequence(event.sequence));
  if (admissible.length === 0) return;

  const { error } = await supabase.from("agent_execution_events").upsert(
    admissible.map((event) => ({
      agent_execution_run_id: params.runId,
      project_id: params.projectId,
      user_id: params.userId,
      sequence: event.sequence,
      type: event.type,
      phase: event.phase,
      audience: event.audience,
      occurred_at: event.occurredAt,
      summary: event.summary,
      metadata: event.metadata,
    })),
    { onConflict: "agent_execution_run_id,sequence" },
  );

  if (error) throw error;
}

/**
 * The log, in order.
 *
 * `after` lets a live view fetch only what it has not seen — the property that
 * keeps a three-second poll cheap on a run that has accumulated four hundred
 * events. `audience` narrows to the customer projection without a second table.
 */
export async function listExecutionEvents(
  supabase: SupabaseClient,
  params: {
    runId: string;
    projectId: string;
    audience?: EventAudience;
    after?: number;
    limit?: number;
  },
): Promise<StoredExecutionEvent[]> {
  let query = supabase
    .from("agent_execution_events")
    .select("sequence, type, phase, audience, occurred_at, summary, metadata")
    .eq("agent_execution_run_id", params.runId)
    .eq("project_id", params.projectId)
    .order("sequence", { ascending: true })
    .limit(Math.min(params.limit ?? MAX_EVENTS_PER_RUN, MAX_EVENTS_PER_RUN));

  if (params.audience) query = query.eq("audience", params.audience);
  if (params.after !== undefined) query = query.gt("sequence", params.after);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as RawEventRow[]).map(toStoredEvent);
}

/** The highest sequence written for a run, or 0. The offset a new batch starts at. */
export async function highestEventSequence(
  supabase: SupabaseClient,
  params: { runId: string },
): Promise<number> {
  const { data, error } = await supabase
    .from("agent_execution_events")
    .select("sequence")
    .eq("agent_execution_run_id", params.runId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as { sequence: number } | null)?.sequence ?? 0;
}

type RawEventRow = {
  sequence: number;
  type: string;
  phase: string;
  audience: string;
  occurred_at: string;
  summary: string;
  metadata: unknown;
};

function toStoredEvent(row: RawEventRow): StoredExecutionEvent {
  return {
    sequence: row.sequence,
    type: row.type as ExecutionEventType,
    phase: row.phase as ExecutionPhase,
    audience: row.audience as EventAudience,
    occurredAt: row.occurred_at,
    summary: row.summary,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as ExecutionEventMetadata)
        : {},
  };
}
