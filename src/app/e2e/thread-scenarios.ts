import { buildThreadView, type ThreadView } from "@/modules/nova/threads/view";
import type { Thread, ThreadMessage } from "@/modules/nova/threads/schema";

/**
 * A stored conversation, read back in a browser (ADR 0109 §6, Slice 5).
 *
 * ## Why this needs a browser
 *
 * The thread routes need a session, which the browser suite does not have — so
 * what can be seen here is the screen given a view model the product's own
 * builder produced. That is the half a unit test cannot reach: whether Nova's
 * register and the system's read apart on screen, whether the unread mark is
 * legible beside a turn rather than floating over it, and whether a long run of
 * turns still fits a 390px column.
 *
 * ## Why the view comes from the real builder
 *
 * `buildThreadView` decides what a turn says — an event's sentence is composed
 * on every read from `THREAD_EVENT_WORDS`, because the row stores none. A
 * fixture that hand-wrote the sentences would keep passing after the table
 * changed, which is the drift these scenarios exist to catch.
 */

export const E2E_THREAD_SCENARIOS = [
  /** A week of runs, some read and some not. */
  "thread-transcript",
  /** A project nothing has happened to yet. */
  "thread-empty",
  /**
   * The composer, unpressed.
   *
   * Only the resting state. Pressing it calls a Server Action that begins with
   * `requireProjectAccess`, and the browser suite has no session — which is the
   * right shape rather than a limitation: what a browser has to prove here is
   * that the one input in this product is legible, bounded and says what asking
   * costs, all of which are true before anything is sent.
   */
  "thread-composer",
] as const;

export type E2eThreadScenario = (typeof E2E_THREAD_SCENARIOS)[number];

export function isE2eThreadScenario(scenario: string): scenario is E2eThreadScenario {
  return (E2E_THREAD_SCENARIOS as readonly string[]).includes(scenario);
}

const THREAD: Thread = {
  id: "thread_e2e",
  projectId: "project_e2e",
  title: "Your product",
  status: "open",
  createdAt: "2026-09-10T09:00:00.000Z",
  lastMessageAt: "2026-09-16T17:20:00.000Z",
  /* Two turns have been read; the rest arrived while nobody was looking. */
  lastReadSequence: 2,
};

function message(overrides: Partial<ThreadMessage> & { sequence: number }): ThreadMessage {
  return {
    id: `m${overrides.sequence}`,
    threadId: THREAD.id,
    author: "system",
    kind: "event",
    body: null,
    actionId: null,
    subject: null,
    artifact: null,
    operationRunId: null,
    outcome: null,
    createdAt: "2026-09-16T17:20:00.000Z",
    ...overrides,
  };
}

const MESSAGES: ThreadMessage[] = [
  message({ sequence: 1, author: "nova", kind: "text", body: "I have read your product." }),
  message({ sequence: 2, operationRunId: "run_scan" }),
  message({ sequence: 3, operationRunId: "run_audit" }),
  message({
    sequence: 4,
    author: "nova",
    kind: "text",
    body: "Pricing clarity is the thing holding the business back right now.",
  }),
  message({ sequence: 5, operationRunId: "run_agent" }),
  message({ sequence: 6, operationRunId: "run_merge" }),
];

export function threadScenarioView(scenario: E2eThreadScenario): ThreadView {
  if (scenario === "thread-empty" || scenario === "thread-composer") {
    return buildThreadView({ thread: THREAD, messages: [], runs: [] });
  }

  return buildThreadView({
    thread: THREAD,
    messages: MESSAGES,
    runs: [
      { id: "run_scan", type: "product_scan", outcome: "completed" },
      { id: "run_audit", type: "business_audit", outcome: "completed" },
      { id: "run_agent", type: "agent_execution", outcome: "failed" },
      { id: "run_merge", type: "change_merge", outcome: "completed" },
    ],
  });
}
