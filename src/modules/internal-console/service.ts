import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/modules/auth/session";
import { isInternalOperator } from "./operator";
import { SAMPLE_LIMIT, type ConsoleSnapshot, type ConsoleWindow } from "./schema";
import {
  buildFailures,
  buildFeed,
  buildFunnel,
  buildInFlight,
  buildOutcomes,
  buildSpend,
  buildTools,
  windowStart,
} from "./shape";
import {
  consoleClient,
  readBrowserUsage,
  readInferenceUsage,
  readOnboarding,
  readOperationRuns,
  readSandboxUsage,
  readToolEvents,
  readUnfinishedOperations,
} from "./store";

/**
 * The console's one entry point ([ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md)).
 *
 * ## Authorization happens here, on every call
 *
 * Not in the layout, not in the page, and never once at render time. The client
 * polls, and a poll is a request like any other — an operator removed from the
 * allowlist stops being one at their next refresh rather than at their next
 * sign-in.
 *
 * The refusal is `null`, and the caller turns it into `notFound()`. A 403 would
 * confirm the route exists to whoever asked.
 */
export type ConsoleAccess = { ok: true; snapshot: ConsoleSnapshot } | { ok: false };

export async function loadConsoleSnapshot(
  window: ConsoleWindow = "24h",
  deps: { client?: SupabaseClient; now?: number } = {},
): Promise<ConsoleAccess> {
  const session = await getSession();
  if (!isInternalOperator(session?.userId)) return { ok: false };

  const now = deps.now ?? Date.now();
  const client = deps.client ?? consoleClient();
  const since = windowStart(window, now);

  const [runs, unfinished, inference, sandbox, browser, onboarding, tools] = await Promise.all([
    readOperationRuns(client, since),
    readUnfinishedOperations(client),
    readInferenceUsage(client, since),
    readSandboxUsage(client, since),
    readBrowserUsage(client, since),
    readOnboarding(client),
    readToolEvents(client, since),
  ]);

  /*
   * A bound that was reached means every total below it is a floor, not a
   * total. Saying so is cheaper than a paginating console, and an operator who
   * is told "at least this much" can act on it; one shown a quiet undercount
   * cannot.
   */
  const truncated = [runs, inference, sandbox, browser, onboarding, tools].some(
    (rows) => rows.length >= SAMPLE_LIMIT,
  );

  return {
    ok: true,
    snapshot: {
      takenAt: new Date(now).toISOString(),
      window,
      feed: buildFeed(runs, now),
      inFlight: buildInFlight(unfinished, now),
      outcomes: buildOutcomes(runs),
      failures: buildFailures(runs),
      spend: buildSpend([
        { source: "inference", rows: inference },
        { source: "sandbox", rows: sandbox },
        { source: "browser", rows: browser },
      ]),
      funnel: buildFunnel(onboarding),
      tools: buildTools(tools),
      truncated,
    },
  };
}
