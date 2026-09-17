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
  /**
   * A conversation with the workspace beside it (ADR 0109 §4, Slice 7).
   *
   * The two turns that are not words — a pointer and an offer — and the pane
   * they open into. Both used to draw nothing at all, so this scenario is the
   * only place the difference between "Nova pointed at something" and "nothing
   * happened" is visible.
   */
  "thread-workspace",
  /**
   * The conversations index (ADR 0109 §1, Slice 7).
   *
   * Three threads — the current one, one that has been put away, and one with
   * nothing said in it yet — because those are the three a founder has to be
   * able to tell apart at a glance, and *current* is the one nothing else on
   * the screen says.
   */
  "thread-list",
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

/**
 * The same week, with a pointer and an offer in it.
 *
 * `artifact` and `action_proposal` rows carry no words at all — the CHECKs
 * refuse them — so what a founder sees for each is composed by the surface, and
 * a fixture that hand-wrote either would be testing itself.
 */
const POINTED_AT: ThreadMessage[] = [
  ...MESSAGES,
  message({
    sequence: 7,
    author: "founder",
    kind: "text",
    body: "why is conversion the blocker?",
  }),
  message({
    sequence: 8,
    author: "nova",
    kind: "text",
    body: "Your pricing is never stated, so nobody reaches a decision.",
  }),
  message({
    sequence: 9,
    author: "nova",
    kind: "artifact",
    artifact: { kind: "business_health", ref: "" },
  }),
  message({
    sequence: 10,
    author: "nova",
    kind: "action_proposal",
    actionId: "nova.refresh_audit",
    subject: { kind: "project" },
  }),
];

export function threadScenarioView(scenario: E2eThreadScenario): ThreadView {
  if (scenario === "thread-empty" || scenario === "thread-composer") {
    return buildThreadView({ thread: THREAD, messages: [], runs: [] });
  }

  if (scenario === "thread-workspace") {
    return buildThreadView({
      thread: THREAD,
      messages: POINTED_AT,
      runs: [
        { id: "run_scan", type: "product_scan", outcome: "completed" },
        { id: "run_audit", type: "business_audit", outcome: "completed" },
        { id: "run_agent", type: "agent_execution", outcome: "failed" },
        { id: "run_merge", type: "change_merge", outcome: "completed" },
      ],
    });
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

/**
 * A project with more than one conversation.
 *
 * `current` is computed by `readThreadList` in production, from the same rule
 * `findOpenThread` applies — the most recently created open thread. Here it is
 * stated, because the lab has no clock and the claim being tested is that the
 * list *says* which one it is.
 */
export function threadListScenario(): { thread: Thread; current: boolean }[] {
  return [
    {
      thread: {
        ...THREAD,
        id: "thread_current",
        title: "why is conversion the blocker?",
        lastMessageAt: "2026-09-16T17:20:00.000Z",
      },
      current: true,
    },
    {
      thread: {
        ...THREAD,
        id: "thread_older",
        title: "what should I build first?",
        status: "archived",
        lastMessageAt: "2026-09-02T11:05:00.000Z",
      },
      current: false,
    },
    {
      thread: { ...THREAD, id: "thread_fresh", title: "New chat", lastMessageAt: null },
      current: false,
    },
  ];
}
