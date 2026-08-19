import { describe, expect, it } from "vitest";
import { executionEvent, type ExecutionEventType, type StoredExecutionEvent } from "./events";
import { eventsFromRuntimeFeed, summarizeRuntimeFeed, LIFECYCLE_SEQUENCE_BASE } from "./runtime-feed";
import { buildExecutionTimeline, currentAction } from "./timeline";
import type { ObservedRuntimeEntry } from "../provider";

/**
 * What a person sees while a run happens.
 *
 * The properties under test are the ones runs #1 and #2 got wrong: a phase must
 * not read as ticking after the run has stopped, a live view must not promise a
 * change it has not verified, and a terminal run must not leave later steps
 * looking like they are still coming.
 */

let sequence = 0;
function event(type: ExecutionEventType, summary = "x", at = "2026-08-19T10:00:00.000Z") {
  sequence += 1;
  return executionEvent({ sequence, type, occurredAt: at, summary });
}

function timeline(events: StoredExecutionEvent[], status: "running" | "completed" | "failed") {
  return buildExecutionTimeline({ events, status });
}

describe("the six steps", () => {
  it("lights the phase the run has reached and nothing beyond it", () => {
    const steps = timeline([event("workspace_ready"), event("agent_started")], "running");

    expect(steps.map((step) => [step.phase, step.state])).toEqual([
      ["preparing", "done"],
      ["working", "active"],
      ["reviewing_change", "pending"],
      ["preparing_branch", "pending"],
      ["validating", "pending"],
      ["finished", "pending"],
    ]);
  });

  it("marks a phase done only when its completing event exists", () => {
    // The agent is working. Nothing about the change has been decided, so
    // `reviewing_change` must not read as done however far the run has got.
    const steps = timeline(
      [event("workspace_ready"), event("agent_started"), event("file_read")],
      "running",
    );

    expect(steps.find((step) => step.phase === "reviewing_change")?.state).toBe("pending");
  });

  it("marks a failed phase failed rather than done", () => {
    const steps = timeline(
      [event("workspace_ready"), event("agent_finished"), event("change_rejected")],
      "failed",
    );

    expect(steps.find((step) => step.phase === "reviewing_change")?.state).toBe("failed");
  });

  /**
   * "We never got there" and "we have not got there yet" read very differently
   * to somebody deciding whether to keep waiting.
   */
  it("skips rather than pends the steps a terminal run never reached", () => {
    const steps = timeline(
      [event("workspace_ready"), event("agent_finished"), event("change_rejected")],
      "failed",
    );

    expect(steps.find((step) => step.phase === "validating")?.state).toBe("skipped");
    expect(steps.find((step) => step.phase === "preparing_branch")?.state).toBe("skipped");
  });

  it("never leaves a step active once the operation is terminal", () => {
    const steps = timeline([event("workspace_ready"), event("agent_started")], "failed");

    expect(steps.some((step) => step.state === "active")).toBe(false);
  });

  it("counts inspected files from the events rather than from a claim", () => {
    const steps = buildExecutionTimeline({
      events: [event("workspace_ready"), event("agent_started")],
      status: "running",
      filesInspected: 6,
    });

    expect(steps.find((step) => step.phase === "working")?.detail).toBe("6 files inspected");
  });

  /**
   * The candidate count, never the observed one. Run `b33635a1` touched
   * eighteen paths and changed six; a timeline that said eighteen would have
   * been describing the wrong number to the person approving it.
   */
  it("reports the verified candidate count, not what the runtime touched", () => {
    const steps = buildExecutionTimeline({
      events: [event("workspace_ready"), event("agent_finished"), event("change_verified")],
      status: "running",
      candidateFileCount: 6,
      filesInspected: 18,
    });

    expect(steps.find((step) => step.phase === "reviewing_change")?.detail).toBe("6 files changed");
  });
});

describe("the current action", () => {
  it("is the most recent event, or nothing", () => {
    expect(currentAction([])).toBeNull();
    expect(currentAction([event("file_read", "Read login/page.tsx")])).toBe("Read login/page.tsx");
  });
});

describe("the runtime feed, made durable", () => {
  const entries: ObservedRuntimeEntry[] = [
    { sequence: 1, kind: "started" },
    { sequence: 2, kind: "turn", turns: 1 },
    { sequence: 3, kind: "tool", tool: "Read", path: "src/app/login/page.tsx" },
    { sequence: 4, kind: "tool", tool: "Edit", path: "src/app/login/page.tsx" },
    { sequence: 5, kind: "tool", tool: "Bash", command: "pnpm run typecheck" },
    { sequence: 6, kind: "finished", subtype: "success" },
  ];

  it("keeps the harness's own ordering", () => {
    const events = eventsFromRuntimeFeed({ entries, observedAt: "2026-08-19T10:00:00.000Z" });

    expect(events.map((e) => e.sequence)).toEqual([2, 3, 4, 5]);
    expect(events.map((e) => e.type)).toEqual([
      "turn_completed",
      "file_read",
      "file_edited",
      "command_started",
    ]);
  });

  it("leads a command with its category rather than its command line", () => {
    const events = eventsFromRuntimeFeed({ entries, observedAt: "2026-08-19T10:00:00.000Z" });
    const command = events.find((e) => e.type === "command_started");

    expect(command?.summary).toBe("Ran typecheck");
    expect(command?.metadata.category).toBe("typecheck");
    expect(command?.metadata.command).toBe("pnpm run typecheck");
  });

  /** Vibe records its own start and finish, from its own clock. */
  it("does not translate the harness's own lifecycle lines", () => {
    const events = eventsFromRuntimeFeed({ entries, observedAt: "2026-08-19T10:00:00.000Z" });

    expect(events.some((e) => e.type === "agent_started")).toBe(false);
    expect(events.some((e) => e.type === "agent_finished")).toBe(false);
  });

  /** The two producers share one sequence space and must never collide. */
  it("refuses a feed line that reaches into the lifecycle band", () => {
    const events = eventsFromRuntimeFeed({
      entries: [{ sequence: LIFECYCLE_SEQUENCE_BASE + 1, kind: "tool", tool: "Read", path: "x.ts" }],
      observedAt: "2026-08-19T10:00:00.000Z",
    });

    expect(events).toEqual([]);
  });

  it("counts what the harness did", () => {
    expect(summarizeRuntimeFeed(entries)).toEqual({
      filesRead: 1,
      filesWritten: 0,
      filesEdited: 1,
      searches: 0,
      commands: 1,
      touchedPaths: ["src/app/login/page.tsx"],
    });
  });
});
