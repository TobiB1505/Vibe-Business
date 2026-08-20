/**
 * What the agent harness actually did, derived from its own event stream
 * (Sprint 0050).
 *
 * ## Why this is a derivation and not new instrumentation
 *
 * The previous economy analysis reported `tool_calls_allowed` and `files_read`
 * as broken — "the columns exist and nothing writes them". That was wrong on
 * both counts, and the correction matters more than the metric.
 *
 * Something does write them: `execution.ts` records `gateway.counters` after
 * every run, with a comment saying exactly what it is doing —
 *
 *   "Under the sandbox topology the trail is empty by construction: the harness
 *    edits files with its own tools inside the VM and never calls back. It is
 *    still written, because 'the gateway brokered nothing' is a fact worth
 *    having recorded rather than an absence to infer."
 *
 * So those columns count **gateway-brokered** calls, and zero is their correct
 * value under ADR 0029. Nothing was broken; a column was read as answering a
 * question it does not answer.
 *
 * The harness's own activity was being recorded the whole time, in
 * `agent_execution_events` — 479 rows across the six runs, each `file_read`,
 * `file_edited`, `file_searched` and `command_started` carrying its tool and
 * path. This module reads that.
 *
 * ## One number, one meaning
 *
 * A file read five times must not be able to mean both "1 file" and "5 reads",
 * so the two are separate fields with names that cannot be confused, and
 * nothing here returns a bare `filesRead`.
 */

export const HARNESS_EVENT_TYPES = [
  "file_read",
  "file_edited",
  "file_searched",
  "command_started",
] as const;
export type HarnessEventType = (typeof HARNESS_EVENT_TYPES)[number];

export type HarnessEvent = {
  type: string;
  /** Repository-relative path, when the event names one. */
  path: string | null;
};

export type HarnessMetrics = {
  /** Every tool invocation the harness made. The sum of the four below. */
  toolCalls: number;
  /** Read *operations* — five reads of one file count five. */
  readOperations: number;
  /** Distinct paths read — five reads of one file count one. */
  uniqueFilesRead: number;
  /** Reads beyond the first of an already-read file. `readOperations` minus unique. */
  repeatedReads: number;
  editOperations: number;
  uniqueFilesEdited: number;
  searchOperations: number;
  commandOperations: number;
};

const EMPTY: HarnessMetrics = {
  toolCalls: 0,
  readOperations: 0,
  uniqueFilesRead: 0,
  repeatedReads: 0,
  editOperations: 0,
  uniqueFilesEdited: 0,
  searchOperations: 0,
  commandOperations: 0,
};

/**
 * Counts one run's harness activity.
 *
 * Returns null for a run with no events at all, which is different from a run
 * that did nothing: the former predates the event stream, the latter is a
 * measured zero. The caller decides which nothing it is holding — see
 * `metric-availability.ts`.
 */
export function deriveHarnessMetrics(events: readonly HarnessEvent[]): HarnessMetrics | null {
  if (events.length === 0) return null;

  const readPaths = new Set<string>();
  const editPaths = new Set<string>();
  const metrics = { ...EMPTY };

  for (const event of events) {
    switch (event.type) {
      case "file_read":
        metrics.readOperations += 1;
        if (event.path) readPaths.add(event.path);
        break;
      case "file_edited":
        metrics.editOperations += 1;
        if (event.path) editPaths.add(event.path);
        break;
      case "file_searched":
        metrics.searchOperations += 1;
        break;
      case "command_started":
        metrics.commandOperations += 1;
        break;
      default:
        // Lifecycle events — turn_completed, agent_started, change_verified and
        // the rest. Real events, not tool calls, and counting them here would
        // make "tool calls" mean "things that happened".
        break;
    }
  }

  metrics.uniqueFilesRead = readPaths.size;
  metrics.uniqueFilesEdited = editPaths.size;
  metrics.repeatedReads = Math.max(0, metrics.readOperations - readPaths.size);
  metrics.toolCalls =
    metrics.readOperations +
    metrics.editOperations +
    metrics.searchOperations +
    metrics.commandOperations;

  return metrics;
}

/**
 * Bytes read is **not** derived here, deliberately.
 *
 * `agent_tool_events` has a `bytes` column and zero rows — it is the gateway's
 * table, and the gateway brokers nothing under the sandbox topology. The
 * harness's own `file_read` events carry a path and no size.
 *
 * So byte volume would have to come from reading each path out of the
 * repository at the pinned commit and summing file sizes, which measures the
 * files rather than the reads and would be a fabricated number wearing a real
 * one's name. It is left out until the harness reports it.
 */
export const BYTES_READ_IS_NOT_DERIVABLE = true;
