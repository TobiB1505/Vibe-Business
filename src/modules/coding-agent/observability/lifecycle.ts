import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { executionEvent, type ExecutionEventMetadata, type ExecutionEventType } from "./events";
import { LIFECYCLE_SEQUENCE_BASE } from "./runtime-feed";
import { recordExecutionEvents } from "./store";

/**
 * Vibe's own milestones, recorded from the steps that produce them.
 *
 * ## Why these are numbered from a reserved band
 *
 * The harness numbers its own feed from 1, and that numbering is the
 * idempotency key for everything it emits. Vibe's milestones come from a
 * different producer that cannot see the harness's counter — a workflow step
 * running in a different process, sometimes before the harness exists at all.
 * Numbering them from 90 000 gives two producers one sequence space without
 * either having to coordinate, and keeps `order by sequence` correct: a
 * milestone always sorts after the feed lines it followed, because the feed
 * cannot reach the band.
 *
 * The trade is that milestones sort as a block at the end of a run's log rather
 * than interleaved with it. Each carries its own `occurred_at`, so a reader
 * that wants true chronology sorts by that instead — which is what the
 * inspector does, and what `sequence` is deliberately not for.
 *
 * ## Why a failure here is swallowed
 *
 * Because this is telemetry attached to a paid execution. A run that succeeded
 * and could not write its own event log still succeeded, and failing it for
 * that would be trading a real outcome for a record of it. The failure is
 * logged; nothing above it changes.
 */

/** One milestone slot per type, so a step re-entered writes the same row. */
const SLOTS: Record<ExecutionEventType, number> = {
  workspace_preparing: 1,
  workspace_ready: 2,
  workspace_failed: 3,
  agent_started: 4,
  agent_finished: 5,
  change_discovered: 6,
  change_verified: 7,
  change_rejected: 8,
  branch_prepared: 9,
  sandbox_stopping: 10,
  sandbox_stopped: 11,
  validation_started: 12,
  validation_completed: 13,
  execution_completed: 14,
  execution_failed: 15,
  usage_updated: 16,

  // Feed-produced types never take a milestone slot. Present so the map is
  // total and a new event type cannot be forgotten here.
  turn_completed: 0,
  file_read: 0,
  file_written: 0,
  file_edited: 0,
  file_searched: 0,
  command_started: 0,
  command_completed: 0,
  command_failed: 0,
};

export type LifecycleRecorder = (
  type: ExecutionEventType,
  summary: string,
  metadata?: ExecutionEventMetadata,
) => Promise<void>;

export function createLifecycleRecorder(input: {
  supabase: SupabaseClient;
  runId: string;
  projectId: string;
  userId: string;
  now?: () => number;
}): LifecycleRecorder {
  return async (type, summary, metadata) => {
    const slot = SLOTS[type];
    if (slot === 0) return;

    try {
      await recordExecutionEvents(input.supabase, {
        runId: input.runId,
        projectId: input.projectId,
        userId: input.userId,
        events: [
          executionEvent({
            sequence: LIFECYCLE_SEQUENCE_BASE + slot,
            type,
            occurredAt: new Date(input.now?.() ?? Date.now()).toISOString(),
            summary,
            metadata,
          }),
        ],
      });
    } catch (error) {
      console.error("[agent-observability] a milestone could not be recorded", {
        agentExecutionRunId: input.runId,
        type,
        detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
      });
    }
  };
}
