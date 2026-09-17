import type { OperationType } from "../../operations/schema";
import { THREAD_EVENT_WORDS, type Thread, type ThreadMessage } from "./schema";

/**
 * A stored transcript as a screen reads it — pure, and the whole of the shaping.
 *
 * ## Why an event's sentence is composed here
 *
 * Because the row does not carry one. `nova_messages`' CHECK refuses words on
 * an `event`, on the argument `nova_voice_messages` makes for not storing its
 * fallback text: a stored sentence freezes today's wording into a row that
 * outlives it, and a reworded product then leaves last month's phrasing on
 * screen with nothing to reveal it. So the row stores *which run*, and this
 * looks the words up in `THREAD_EVENT_WORDS` every time.
 *
 * ## What this refuses to do
 *
 * Derive anything about the business. A turn is rendered from the row it came
 * from and from the run it names, and nothing here asks what a founder decided,
 * what an audit concluded or what is owed — those are `focus.ts`'s questions and
 * they are answered from canonical tables ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §6).
 * A reader that wanted to know what to do next would call `deriveNovaFocus`,
 * which cannot see a message at all.
 */

/** What a run was, for the one event that names it. Read from `operation_runs`. */
export type ThreadEventRun = {
  id: string;
  type: OperationType;
  /** Terminal only. A thread event is written when a run stops, never before. */
  outcome: "completed" | "failed";
};

/** One turn, ready to draw. */
export type ThreadTurn = {
  id: string;
  sequence: number;
  author: ThreadMessage["author"];
  kind: ThreadMessage["kind"];
  /**
   * What this turn says, or null when it says nothing in words.
   *
   * Null is a real answer: an `artifact` turn is the thing itself, and a
   * sentence introducing it would be a caption on a picture that already says
   * what it is.
   */
  text: string | null;
  /** Whether this arrived after the founder last looked. */
  unread: boolean;
  /** The row's own message, for a caller that needs more than the sentence. */
  message: ThreadMessage;
};

export type ThreadView = {
  thread: Thread;
  turns: ThreadTurn[];
  /** How many turns arrived after the founder last looked. Never negative. */
  unreadCount: number;
  /** The highest sequence on screen, so a reader can mark what it showed. */
  lastSequence: number;
};

export function buildThreadView(params: {
  thread: Thread;
  messages: readonly ThreadMessage[];
  /** The runs the `event` turns name. A missing one degrades, never throws. */
  runs: readonly ThreadEventRun[];
}): ThreadView {
  const runById = new Map(params.runs.map((run) => [run.id, run]));

  const turns = params.messages.map(
    (message): ThreadTurn => ({
      id: message.id,
      sequence: message.sequence,
      author: message.author,
      kind: message.kind,
      text: textFor(message, runById),
      unread: message.sequence > params.thread.lastReadSequence,
      message,
    }),
  );

  return {
    thread: params.thread,
    turns,
    unreadCount: turns.filter((turn) => turn.unread).length,
    lastSequence: turns.reduce((highest, turn) => Math.max(highest, turn.sequence), 0),
  };
}

/**
 * The words for one turn.
 *
 * An event whose run cannot be read, or whose type is no longer remembered,
 * returns null rather than a placeholder. A frame around an absence is worse
 * than no frame — the same judgement Nova's thread makes about a block it has
 * no data for — and inventing "something happened" would be the surface writing
 * a fact nobody recorded.
 */
function textFor(message: ThreadMessage, runById: Map<string, ThreadEventRun>): string | null {
  if (message.kind === "text") return message.body;
  if (message.kind !== "event") return null;
  if (message.operationRunId === null) return null;

  const run = runById.get(message.operationRunId);
  if (run === undefined) return null;

  const words = THREAD_EVENT_WORDS[run.type];
  if (words === null) return null;

  return run.outcome === "completed" ? words.done : words.failed;
}

/** Which runs a set of messages needs read, so a caller fetches them once. */
export function operationRunIdsIn(messages: readonly ThreadMessage[]): string[] {
  return [
    ...new Set(
      messages
        .filter((message) => message.kind === "event" || message.kind === "action_result")
        .map((message) => message.operationRunId)
        .filter((id): id is string => id !== null),
    ),
  ];
}
