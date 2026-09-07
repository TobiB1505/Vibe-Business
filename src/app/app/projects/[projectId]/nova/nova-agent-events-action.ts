"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { findAgentRunByOperation } from "@/modules/coding-agent/store";
import { listExecutionEvents } from "@/modules/coding-agent/observability/store";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";
import { getOperationRun } from "@/modules/operations/store";
import { isTerminal } from "@/modules/operations/schema";

/**
 * The agent's own record, for the block in Nova's thread.
 *
 * ## Why a second reading exists beside the Agent workspace's
 *
 * Because they are different sizes. `readAgentWorkspace` resolves the run
 * view, the open interrupt, the prepared change — which signs review images
 * and performs a GitHub merge preflight — and the credit reservation, because
 * the Agent route draws all of it. Nova's thread draws one thing: the files
 * the run is touching, while it touches them. Reaching for the workspace to
 * get that would be the shape `getMoveWithExecution` had before
 * `move-read-cost.test.ts` — a page's whole assembly, for one panel.
 *
 * So this is two reads: which run the operation started, and what it has
 * written since the caller last asked.
 *
 * ## `after`, and why the poll is cheap
 *
 * `listExecutionEvents` takes the sequence the caller has already seen, which
 * is what keeps a 2.5-second poll from re-fetching four hundred events to
 * discover one. The caller accumulates; this returns only the tail.
 *
 * ## What bounds it
 *
 * The session's own client, so RLS scopes every read to this user, and the
 * operation is looked up by project *and* id before the run behind it is
 * touched — an operation id from another project resolves to nothing rather
 * than to somebody else's run. `listExecutionEvents` filters on the project
 * again, which is the second layer rather than the only one.
 *
 * It never writes. There is no stale-run repair here on purpose: that belongs
 * to the surface that owns the run, and a poll that repaired state would be a
 * read with a side effect running every 2.5 seconds per open tab.
 */
export type NovaAgentEvents = {
  events: StoredExecutionEvent[];
  /**
   * Whether the run has stopped writing.
   *
   * From the operation the block is already watching, so it costs nothing
   * extra. The thread's header owns re-reading the route when a run settles;
   * this only stops the timer, so the last events stay on screen until the
   * refresh lands rather than the list going still with no explanation.
   */
  done: boolean;
};

export async function getNovaAgentEventsAction(
  projectId: string,
  operationId: string,
  /** The highest sequence the caller already holds. Zero on the first ask. */
  after: number,
): Promise<{ ok: true; activity: NovaAgentEvents } | { ok: false }> {
  const session = await requireSession();
  const supabase = await createClient();

  const operation = await getOperationRun(supabase, { projectId, operationId });
  if (!operation || operation.operationType !== "agent_execution") return { ok: false };

  const run = await findAgentRunByOperation(supabase, operationId);
  /*
   * No run yet is a real answer, not a failure: the operation is queued and
   * the harness has not started. The block draws its own empty state and the
   * timer keeps asking.
   */
  if (!run || run.userId !== session.userId) {
    return { ok: true, activity: { events: [], done: isTerminal(operation.status) } };
  }

  const events = await listExecutionEvents(supabase, {
    runId: run.id,
    projectId,
    after: after > 0 ? after : undefined,
  });

  return { ok: true, activity: { events, done: isTerminal(operation.status) } };
}
