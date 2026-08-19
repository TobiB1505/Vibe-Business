import type { ObservedRuntimeEntry } from "../provider";
import {
  LIFECYCLE_SEQUENCE_BASE,
  classifyCommand,
  executionEvent,
  type ExecutionEventType,
  type StoredExecutionEvent,
} from "./events";

/**
 * The harness's progress feed, translated into durable events.
 *
 * ## Why the harness's sequence is reused as the event sequence
 *
 * Because it is already monotonic, already assigned inside the VM, and already
 * survives a Vibe function dying — which is the whole reason the feed is a file
 * rather than a stream. Reusing it makes the durable write an upsert on a key
 * the producer chose, so a poll that re-reads the same file writes the same
 * rows. Inventing a Vibe-side counter would mean maintaining a cursor across
 * step boundaries, which is the thing that was already tried and lost.
 *
 * Lifecycle events Vibe records itself — workspace ready, change verified,
 * sandbox stopped — are numbered from a reserved band above the feed, so the
 * two producers can never collide.
 *
 * ## What the translation is allowed to know
 *
 * A tool name, a repository path and a command line. Nothing else crosses: the
 * feed has no field for a sentence, and this function reads no field that does
 * not exist. The summaries below are composed here, from a closed vocabulary,
 * by Vibe — which is what makes them safe to show a customer.
 */

export { LIFECYCLE_SEQUENCE_BASE };

/** The SDK tool names the harness is given, mapped to what they did. */
const TOOL_EVENTS: Record<string, { type: ExecutionEventType; verb: string }> = {
  Read: { type: "file_read", verb: "Read" },
  Write: { type: "file_written", verb: "Created" },
  Edit: { type: "file_edited", verb: "Updated" },
  Glob: { type: "file_searched", verb: "Searched for files" },
  Grep: { type: "file_searched", verb: "Searched the code" },
};

/** The last path segment, which is what a person recognises in a timeline. */
function basename(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * One feed entry as an event, or `null` when it carries nothing worth storing.
 *
 * `started` and `finished` are dropped here rather than translated: Vibe records
 * its own `agent_started` and `agent_finished` from the step that observed
 * them, with the timestamps of its own clock. Two records of the same fact,
 * one of them from inside an untrusted VM, is one too many.
 */
function toEvent(entry: ObservedRuntimeEntry, occurredAt: string): StoredExecutionEvent | null {
  if (entry.kind === "turn") {
    return executionEvent({
      sequence: entry.sequence,
      type: "turn_completed",
      occurredAt,
      summary: "Model response",
      metadata: { assistantMessages: entry.turns ?? 0 },
    });
  }

  if (entry.kind !== "tool") return null;

  const tool = entry.tool ?? "";

  if (tool === "Bash" && entry.command) {
    const category = classifyCommand(entry.command);
    return executionEvent({
      sequence: entry.sequence,
      type: "command_started",
      occurredAt,
      summary: `Ran ${category === "other" ? "a command" : category}`,
      // The command is bounded and redacted by `boundEvent`; the category is
      // what the timeline leads with, so a mislabelled command costs a label
      // rather than the evidence beneath it.
      metadata: { category, command: entry.command, tool },
    });
  }

  const mapped = TOOL_EVENTS[tool];
  if (!mapped) return null;

  return executionEvent({
    sequence: entry.sequence,
    type: mapped.type,
    occurredAt,
    summary: entry.path ? `${mapped.verb} ${basename(entry.path)}` : mapped.verb,
    metadata: entry.path ? { path: entry.path, tool } : { tool },
  });
}

/**
 * Everything in the feed that is worth a durable row.
 *
 * `occurredAt` is Vibe's own clock rather than the VM's, and deliberately so:
 * the sandbox's clock is not this system's, the feed carries no timestamp, and
 * inventing one would be worse than an approximate one that is honestly the
 * time Vibe first saw the line. Ordering comes from `sequence`, which is exact.
 */
export function eventsFromRuntimeFeed(input: {
  entries: readonly ObservedRuntimeEntry[];
  observedAt: string;
}): StoredExecutionEvent[] {
  const events: StoredExecutionEvent[] = [];

  for (const entry of input.entries) {
    if (entry.sequence >= LIFECYCLE_SEQUENCE_BASE) continue;
    const event = toEvent(entry, input.observedAt);
    if (event) events.push(event);
  }

  return events;
}

/**
 * What the feed says the run has been doing, in counts.
 *
 * Used for the customer view's "6 pages inspected" and for the inspector's
 * per-tool tallies. Derived rather than stored: the events are the record, and
 * a second stored count would be a number that can disagree with it.
 */
export type RuntimeFeedSummary = {
  filesRead: number;
  filesWritten: number;
  filesEdited: number;
  searches: number;
  commands: number;
  /** Distinct repository paths the harness touched, in first-seen order. */
  touchedPaths: readonly string[];
};

export function summarizeRuntimeFeed(
  entries: readonly ObservedRuntimeEntry[],
): RuntimeFeedSummary {
  const touched = new Set<string>();
  let filesRead = 0;
  let filesWritten = 0;
  let filesEdited = 0;
  let searches = 0;
  let commands = 0;

  for (const entry of entries) {
    if (entry.kind !== "tool") continue;
    if (entry.path) touched.add(entry.path);

    switch (entry.tool) {
      case "Read":
        filesRead += 1;
        break;
      case "Write":
        filesWritten += 1;
        break;
      case "Edit":
        filesEdited += 1;
        break;
      case "Glob":
      case "Grep":
        searches += 1;
        break;
      case "Bash":
        commands += 1;
        break;
      default:
        break;
    }
  }

  return {
    filesRead,
    filesWritten,
    filesEdited,
    searches,
    commands,
    touchedPaths: [...touched],
  };
}
