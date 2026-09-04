import type { ConsoleSnapshot } from "@/modules/internal-console/schema";

/**
 * The operator console, in a browser ([ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md)).
 *
 * ## Why this exists rather than a unit test alone
 *
 * `shape.test.ts` proves the shaping and `columns.test.ts` proves what may be
 * read. Neither can say whether the screen a person opens during an incident is
 * legible — which is rule 69's fourth question, and the one this repository
 * keeps paying for when it is skipped.
 *
 * The console cannot be rendered from real data here: it reads across tenants
 * through the service-role client, and the fixture environment points at a
 * Supabase project that does not exist by design. So the fixture is a complete
 * `ConsoleSnapshot` — the exact object `loadConsoleSnapshot` returns — and the
 * component cannot tell it from a production render.
 *
 * ## What the numbers are
 *
 * Written by hand, shaped to the states worth looking at rather than to a happy
 * path: a failure at the top of the feed, an operation running long enough to
 * be worth noticing, a denied agent tool, and a `needs_user` that is waiting on
 * a person rather than broken. No real project, user or cost appears.
 */

const AT = "2026-09-04T16:31:12.000Z";
const ago = (seconds: number) => new Date(Date.parse(AT) - seconds * 1000).toISOString();

export const E2E_INTERNAL_CONSOLE_SCENARIOS = {
  internal_console_busy: {
    takenAt: AT,
    window: "24h",
    feed: [
      {
        id: "f1",
        at: ago(8),
        level: "bad",
        operationType: "agent_execution",
        status: "failed",
        stage: "running_agent",
        failureCode: "sandbox_start_failed",
        projectRef: "3f9a1c00",
        durationMs: 74_300,
      },
      {
        id: "f2",
        at: ago(31),
        level: "active",
        operationType: "change_validation",
        status: "running",
        stage: "installing",
        failureCode: null,
        projectRef: "b1207ee4",
        durationMs: 31_100,
      },
      {
        id: "f3",
        at: ago(96),
        level: "waiting",
        operationType: "business_audit",
        status: "needs_user",
        stage: "asking_founder",
        failureCode: null,
        projectRef: "77c4de10",
        durationMs: 240_800,
      },
      {
        id: "f4",
        at: ago(142),
        level: "ok",
        operationType: "business_audit",
        status: "completed",
        stage: "completed",
        failureCode: null,
        projectRef: "3f9a1c00",
        durationMs: 51_400,
      },
      {
        id: "f5",
        at: ago(310),
        level: "ok",
        operationType: "product_scan",
        status: "completed",
        stage: "completed",
        failureCode: null,
        projectRef: "b1207ee4",
        durationMs: 22_900,
      },
      {
        id: "f6",
        at: ago(602),
        level: "bad",
        operationType: "change_merge",
        status: "failed",
        stage: "authorizing",
        failureCode: "default_branch_moved",
        projectRef: "77c4de10",
        durationMs: 1_900,
      },
      {
        id: "f7",
        at: ago(915),
        level: "ok",
        operationType: "action_planning",
        status: "completed",
        stage: "completed",
        failureCode: null,
        projectRef: "3f9a1c00",
        durationMs: 38_700,
      },
    ],
    inFlight: {
      queued: 1,
      running: 2,
      needsUser: 1,
      oldest: { operationType: "change_validation", stage: "installing", ageMs: 284_000 },
    },
    outcomes: [
      { operationType: "agent_execution", completed: 3, failed: 2, cancelled: 0 },
      { operationType: "change_merge", completed: 4, failed: 1, cancelled: 0 },
      { operationType: "business_audit", completed: 19, failed: 0, cancelled: 1 },
      { operationType: "product_scan", completed: 12, failed: 0, cancelled: 0 },
    ],
    failures: [
      { failureCode: "sandbox_start_failed", count: 2 },
      { failureCode: "default_branch_moved", count: 1 },
    ],
    spend: [
      // Inference is the only one a provider prices; the other two are Vibe's
      // own derivation, and the screen has to say so.
      { source: "inference", events: 214, measuredMicroUsd: 8_412_000, estimatedMicroUsd: 0 },
      { source: "sandbox", events: 26, measuredMicroUsd: 0, estimatedMicroUsd: 3_105_000 },
      { source: "browser", events: 4, measuredMicroUsd: 0, estimatedMicroUsd: 610_000 },
    ],
    funnel: [
      { state: "completed", count: 14 },
      { state: "audit", count: 3 },
      { state: "product", count: 2 },
    ],
    tools: [
      { tool: "WebFetch", allowed: 0, denied: 3, failed: 0 },
      { tool: "Bash", allowed: 61, denied: 0, failed: 4 },
      { tool: "Read", allowed: 188, denied: 0, failed: 0 },
      { tool: "Edit", allowed: 22, denied: 0, failed: 1 },
    ],
    truncated: false,
  },
} as const satisfies Record<string, ConsoleSnapshot>;

export type E2eInternalConsoleScenario = keyof typeof E2E_INTERNAL_CONSOLE_SCENARIOS;

export function isE2eInternalConsoleScenario(value: string): value is E2eInternalConsoleScenario {
  return Object.hasOwn(E2E_INTERNAL_CONSOLE_SCENARIOS, value);
}
