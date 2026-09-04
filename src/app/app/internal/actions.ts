"use server";

import {
  CONSOLE_WINDOWS,
  type ConsoleSnapshot,
  type ConsoleWindow,
} from "@/modules/internal-console/schema";
import { loadConsoleSnapshot } from "@/modules/internal-console/service";

/**
 * One refresh of the operator console ([ADR 0088](../../../../docs/decisions/0088-the-internal-operator-console.md)).
 *
 * ## Why the action re-authorizes rather than trusting the page
 *
 * A Server Action under `/app` does not inherit the route's layout, and even if
 * it did, the layout only proves a session — not that the session belongs to an
 * operator. `loadConsoleSnapshot` checks the allowlist itself on every call, so
 * an operator removed from it stops being one at their next poll rather than at
 * their next sign-in.
 *
 * ## Why the window is re-validated here
 *
 * It is the one value that crosses from the browser. It is checked against the
 * closed set rather than passed through, so a caller cannot widen the query by
 * naming a window nobody defined.
 */
export type ConsoleRefreshState =
  | { ok: true; snapshot: ConsoleSnapshot }
  | { ok: false; reason: "denied" | "unavailable" };

export async function refreshConsoleAction(window: string): Promise<ConsoleRefreshState> {
  const requested = (CONSOLE_WINDOWS as readonly string[]).includes(window)
    ? (window as ConsoleWindow)
    : "24h";

  try {
    const access = await loadConsoleSnapshot(requested);
    if (!access.ok) return { ok: false, reason: "denied" };
    return { ok: true, snapshot: access.snapshot };
  } catch (error) {
    /*
     * A failed read must not take the console down: it is the thing an
     * operator opens *because* something is wrong. The message is deliberately
     * not forwarded — a database error string is not something to render into
     * a page, and the server log already has it.
     */
    console.error("[internal-console] refresh failed", error);
    return { ok: false, reason: "unavailable" };
  }
}
