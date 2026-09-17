import { describe, expect, it } from "vitest";
import { buildThreadView, latestArtifactIn, operationRunIdsIn, type ThreadEventRun } from "./view";
import { THREAD_EVENT_WORDS, type Thread, type ThreadMessage } from "./schema";

const THREAD: Thread = {
  id: "thread_1",
  projectId: "project_1",
  title: "What to do next",
  status: "open",
  createdAt: "2026-09-16T09:00:00.000Z",
  lastMessageAt: "2026-09-16T10:00:00.000Z",
  lastReadSequence: 1,
};

function message(overrides: Partial<ThreadMessage> & { sequence: number }): ThreadMessage {
  return {
    id: `m${overrides.sequence}`,
    threadId: THREAD.id,
    author: "nova",
    kind: "text",
    body: null,
    actionId: null,
    subject: null,
    artifact: null,
    operationRunId: null,
    outcome: null,
    createdAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  };
}

const RUN: ThreadEventRun = { id: "run_1", type: "business_audit", outcome: "completed" };

describe("a transcript, as a screen reads it", () => {
  it("takes a text turn's words from the row", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [message({ sequence: 1, kind: "text", body: "Your audit is out of date." })],
      runs: [],
    });

    expect(view.turns[0].text).toBe("Your audit is out of date.");
  });

  /**
   * The event's sentence is composed on every read, because the row carries
   * none — `nova_messages`' CHECK refuses words on an event, so a reworded
   * product cannot leave last month's phrasing on screen with nothing to
   * reveal it.
   */
  it("composes an event's sentence from today's table", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [
        message({ sequence: 2, author: "system", kind: "event", operationRunId: "run_1" }),
      ],
      runs: [RUN],
    });

    expect(view.turns[0].text).toBe(THREAD_EVENT_WORDS.business_audit?.done);
  });

  it("says the other thing when the run did not finish", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [
        message({ sequence: 2, author: "system", kind: "event", operationRunId: "run_1" }),
      ],
      runs: [{ ...RUN, outcome: "failed" }],
    });

    expect(view.turns[0].text).toBe(THREAD_EVENT_WORDS.business_audit?.failed);
  });

  /**
   * A frame around an absence is worse than no frame. An event whose run cannot
   * be read says nothing rather than "something happened" — which would be the
   * surface writing a fact nobody recorded.
   */
  it("says nothing about a run it cannot read", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [message({ sequence: 2, author: "system", kind: "event", operationRunId: "gone" })],
      runs: [],
    });

    expect(view.turns[0].text).toBeNull();
  });

  it("says nothing about a run the product stopped remembering", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [
        message({ sequence: 2, author: "system", kind: "event", operationRunId: "run_1" }),
      ],
      runs: [{ ...RUN, type: "preview_teardown" }],
    });

    expect(THREAD_EVENT_WORDS.preview_teardown).toBeNull();
    expect(view.turns[0].text).toBeNull();
  });

  it("counts what arrived after the founder last looked", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [
        message({ sequence: 1, kind: "text", body: "one" }),
        message({ sequence: 2, kind: "text", body: "two" }),
        message({ sequence: 3, kind: "text", body: "three" }),
      ],
      runs: [],
    });

    expect(view.unreadCount).toBe(2);
    expect(view.turns.map((turn) => turn.unread)).toEqual([false, true, true]);
    expect(view.lastSequence).toBe(3);
  });

  it("has nothing unread in an empty thread", () => {
    const view = buildThreadView({ thread: THREAD, messages: [], runs: [] });

    expect(view.unreadCount).toBe(0);
    expect(view.lastSequence).toBe(0);
  });
});

describe("which runs a transcript needs read", () => {
  it("names each one once and ignores turns that name none", () => {
    const ids = operationRunIdsIn([
      message({ sequence: 1, kind: "text", body: "words" }),
      message({ sequence: 2, author: "system", kind: "event", operationRunId: "run_1" }),
      message({ sequence: 3, author: "system", kind: "event", operationRunId: "run_1" }),
      message({ sequence: 4, author: "system", kind: "event", operationRunId: "run_2" }),
    ]);

    expect(ids).toEqual(["run_1", "run_2"]);
  });
});

/**
 * What the workspace opens on when the address does not say (ADR 0109 §4).
 *
 * A conversation is *about* something, and the last thing Nova pointed at is
 * the honest answer to what. The alternative — a default section — would be the
 * pane guessing, and a founder who had just been told about a Move would be
 * shown a business reading instead.
 */
describe("the last artifact a conversation pointed at", () => {
  it("is the most recent one, not the first", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [
        message({
          sequence: 1,
          author: "nova",
          kind: "artifact",
          artifact: { kind: "business_health", ref: "" },
        }),
        message({ sequence: 2, author: "nova", kind: "text", body: "and this one" }),
        message({
          sequence: 3,
          author: "nova",
          kind: "artifact",
          artifact: { kind: "opportunity", ref: "opp_9" },
        }),
      ],
      runs: [],
    });

    expect(latestArtifactIn(view)).toEqual({ kind: "opportunity", opportunityId: "opp_9" });
  });

  it("is nothing in a thread that has pointed at nothing", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [message({ sequence: 1, kind: "text", body: "words" })],
      runs: [],
    });

    expect(latestArtifactIn(view)).toBeNull();
  });

  /**
   * A stored kind the union no longer holds, or a reference an address needs
   * and the row does not carry. The pane opens on nothing rather than on a
   * guess — and it skips *past* the unusable row to a usable one, because the
   * founder's conversation did point at something.
   */
  it("skips a pointer it cannot follow", () => {
    const view = buildThreadView({
      thread: THREAD,
      messages: [
        message({
          sequence: 1,
          author: "nova",
          kind: "artifact",
          artifact: { kind: "product", ref: "" },
        }),
        message({
          sequence: 2,
          author: "nova",
          kind: "artifact",
          // A Move with no id: `?plan=undefined` is a link to nothing.
          artifact: { kind: "opportunity", ref: "" },
        }),
      ],
      runs: [],
    });

    expect(latestArtifactIn(view)).toEqual({ kind: "product" });
  });
});
