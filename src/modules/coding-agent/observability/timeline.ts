import type { OperationStatus } from "@/modules/operations/schema";
import { EXECUTION_PHASES, type ExecutionPhase, type StoredExecutionEvent } from "./events";

/**
 * The six lines a founder should see while their change is being built.
 *
 * ## Derived, never stored
 *
 * A stored progress record is a second source of truth that can disagree with
 * the event log, and the disagreement always surfaces at the worst moment — a
 * run that failed showing a phase still ticking. So this is a pure projection
 * over the events plus the operation's own status, and both of those are
 * already durable.
 *
 * ## Why phases rather than a percentage
 *
 * Because there is no honest percentage. An agent run's length depends on a
 * repository nobody has measured, and a bar that reaches 80% and stops is a
 * worse experience than six named steps where one of them is lit. The same
 * argument the operation-stage vocabulary already makes.
 *
 * ## Counts come from events, not from claims
 *
 * "6 pages inspected" is the number of `file_read` events Vibe recorded from
 * the harness's own tool stream. "6 files changed" is the *candidate* count
 * from `change_verified` — never the number of files the runtime touched,
 * because those are different numbers and run `b33635a1` is why anybody knows
 * that (eighteen touched, six changed).
 */

export type TimelineStepState = "pending" | "active" | "done" | "failed" | "skipped";

export type TimelineStep = {
  phase: ExecutionPhase;
  /** Outcome language, in the present or past tense as the state requires. */
  label: string;
  state: TimelineStepState;
  /** One short line of measured detail, or null when there is nothing true to say. */
  detail: string | null;
};

const LABELS: Record<ExecutionPhase, { pending: string; active: string; done: string }> = {
  preparing: {
    pending: "Prepare the project",
    active: "Preparing your project",
    done: "Project prepared",
  },
  working: {
    pending: "Make the change",
    active: "Making the change",
    done: "Change made",
  },
  reviewing_change: {
    pending: "Check the change",
    active: "Checking the change",
    done: "Change checked",
  },
  preparing_branch: {
    pending: "Prepare your change",
    active: "Preparing your change",
    done: "Change prepared",
  },
  validating: {
    pending: "Independent validation",
    active: "Running independent validation",
    done: "Validation passed",
  },
  finished: {
    pending: "Ready for review",
    active: "Finishing up",
    done: "Ready for review",
  },
};

/** Which event marks a phase complete. Absence of one is not completion. */
const COMPLETED_BY: Partial<Record<ExecutionPhase, readonly string[]>> = {
  preparing: ["workspace_ready"],
  working: ["agent_finished"],
  reviewing_change: ["change_verified"],
  preparing_branch: ["branch_prepared"],
  validating: ["validation_completed"],
  finished: ["execution_completed"],
};

/** Which event marks a phase failed. */
const FAILED_BY: Partial<Record<ExecutionPhase, readonly string[]>> = {
  preparing: ["workspace_failed"],
  reviewing_change: ["change_rejected"],
  finished: ["execution_failed"],
};

export type TimelineInput = {
  events: readonly StoredExecutionEvent[];
  status: OperationStatus;
  /** Vibe's own verified candidate count, once one exists. */
  candidateFileCount?: number | null;
  /** Files the harness read, from the event log. */
  filesInspected?: number | null;
};

/**
 * The timeline, as six steps.
 *
 * A phase is `done` when its completing event exists, `failed` when its failing
 * event does, `active` when it is the furthest phase any event has reached and
 * the operation is still live, and `pending` otherwise. A terminal operation
 * with no completing event leaves later phases `skipped` rather than `pending`,
 * because "we never got there" and "we have not got there yet" read very
 * differently to somebody deciding whether to wait.
 */
export function buildExecutionTimeline(input: TimelineInput): TimelineStep[] {
  const seen = new Set(input.events.map((event) => event.type));
  const reached = new Set(input.events.map((event) => event.phase));

  const terminal = input.status === "completed" || input.status === "failed" || input.status === "cancelled";

  const furthest = EXECUTION_PHASES.reduce<ExecutionPhase | null>(
    (latest, phase) => (reached.has(phase) ? phase : latest),
    null,
  );

  return EXECUTION_PHASES.map((phase) => {
    const failed = (FAILED_BY[phase] ?? []).some((type) => seen.has(type as never));
    const done = !failed && (COMPLETED_BY[phase] ?? []).some((type) => seen.has(type as never));

    const state: TimelineStepState = failed
      ? "failed"
      : done
        ? "done"
        : terminal
          ? "skipped"
          : phase === furthest || (furthest === null && phase === "preparing")
            ? "active"
            : "pending";

    return {
      phase,
      label: state === "done" ? LABELS[phase].done : state === "active" ? LABELS[phase].active : LABELS[phase].pending,
      state,
      detail: detailFor(phase, state, input),
    };
  });
}

function detailFor(
  phase: ExecutionPhase,
  state: TimelineStepState,
  input: TimelineInput,
): string | null {
  if (state === "pending" || state === "skipped") return null;

  if (phase === "working") {
    const inspected = input.filesInspected ?? 0;
    return inspected > 0 ? `${inspected} ${inspected === 1 ? "file" : "files"} inspected` : null;
  }

  if (phase === "reviewing_change" && state === "done") {
    const changed = input.candidateFileCount ?? 0;
    return changed > 0 ? `${changed} ${changed === 1 ? "file" : "files"} changed` : null;
  }

  // The current action, taken from the most recent internal event — which is
  // the honest answer to "what is it doing right now" and costs no extra state.
  if (state === "active") {
    const latest = [...input.events].reverse().find((event) => event.phase === phase);
    return latest?.summary ?? null;
  }

  return null;
}

/**
 * What the run is doing at this instant, in one line.
 *
 * The last event, whatever its audience — because "Read login/page.tsx" is a
 * true and useful thing to show a waiting person even though it is not a
 * milestone. Null when nothing has happened yet, never a placeholder sentence.
 */
export function currentAction(events: readonly StoredExecutionEvent[]): string | null {
  return events.length === 0 ? null : (events[events.length - 1]?.summary ?? null);
}
