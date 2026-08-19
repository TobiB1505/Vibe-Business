import { describe, expect, it } from "vitest";
import { executionEvent, type ExecutionEventType, type StoredExecutionEvent } from "./events";
import {
  eventsFromRuntimeFeed,
  summarizeRuntimeFeed,
  toRepositoryPath,
  LIFECYCLE_SEQUENCE_BASE,
} from "./runtime-feed";
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

  /**
   * Run #3 stamped all sixty-eight of its events with 11:10:38, because one
   * poll wrote the whole batch and the batch carried Vibe's read time. The feed
   * now carries the harness's own offset from its start, so a typecheck that
   * took ninety seconds looks like one.
   */
  it("places each line at the harness's own offset from the run's start", () => {
    const events = eventsFromRuntimeFeed({
      entries: [
        { sequence: 2, offsetMs: 0, kind: "turn", turns: 1 },
        { sequence: 3, offsetMs: 12_000, kind: "tool", tool: "Read", path: "a.ts" },
        { sequence: 4, offsetMs: 95_000, kind: "tool", tool: "Bash", command: "pnpm run typecheck" },
      ],
      observedAt: "2026-08-19T11:10:38.000Z",
      startedAt: "2026-08-19T11:09:00.000Z",
    });

    expect(events.map((e) => e.occurredAt)).toEqual([
      "2026-08-19T11:09:00.000Z",
      "2026-08-19T11:09:12.000Z",
      "2026-08-19T11:10:35.000Z",
    ]);
  });

  /** A feed written before offsets existed gets the honest "when we saw it". */
  it("falls back to the read time rather than inventing a moment", () => {
    const events = eventsFromRuntimeFeed({
      entries: [{ sequence: 2, kind: "tool", tool: "Read", path: "a.ts" }],
      observedAt: "2026-08-19T11:10:38.000Z",
      startedAt: "2026-08-19T11:09:00.000Z",
    });

    expect(events[0].occurredAt).toBe("2026-08-19T11:10:38.000Z");
  });

  it("falls back the same way when the run has no recorded start", () => {
    const events = eventsFromRuntimeFeed({
      entries: [{ sequence: 2, offsetMs: 12_000, kind: "tool", tool: "Read", path: "a.ts" }],
      observedAt: "2026-08-19T11:10:38.000Z",
      startedAt: null,
    });

    expect(events[0].occurredAt).toBe("2026-08-19T11:10:38.000Z");
  });

  /**
   * The harness reports absolute paths inside its VM; the candidate, the policy
   * check and the prepared change all speak repository-relative. Run #3's feed
   * was full of `/vercel/Vibe-Business/src/app/layout.tsx`, which no candidate
   * list could be lined up against.
   */
  it("reports paths as the repository knows them", () => {
    const events = eventsFromRuntimeFeed({
      entries: [
        { sequence: 2, kind: "tool", tool: "Edit", path: "/vercel/Vibe-Business/src/app/layout.tsx" },
      ],
      observedAt: "2026-08-19T11:10:38.000Z",
      workspaceDir: "/vercel/Vibe-Business",
    });

    expect(events[0].metadata.path).toBe("src/app/layout.tsx");
    expect(events[0].summary).toBe("Updated layout.tsx");
  });

  it("keeps a path it cannot place rather than dropping it", () => {
    expect(toRepositoryPath("/somewhere/else/x.ts", "/vercel/Vibe-Business")).toBe(
      "/somewhere/else/x.ts",
    );
    expect(toRepositoryPath("src/app/x.ts", null)).toBe("src/app/x.ts");
    // A directory that merely shares a prefix is not the workspace.
    expect(toRepositoryPath("/vercel/Vibe-Business-old/x.ts", "/vercel/Vibe-Business")).toBe(
      "/vercel/Vibe-Business-old/x.ts",
    );
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
