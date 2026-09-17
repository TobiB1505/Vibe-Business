import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findOpenThread,
  getThread,
  listThreads,
  readThreadMessages,
} from "@/modules/nova/threads/store";
import type { Thread } from "@/modules/nova/threads/schema";
import {
  buildThreadView,
  operationRunIdsIn,
  type ThreadEventRun,
  type ThreadView,
} from "@/modules/nova/threads/view";
import { listOperationRunsByIds } from "@/modules/operations/store";

/**
 * Everything one thread screen reads, in three bounded queries.
 *
 * The thread, its most recent turns, and the runs those turns name. Each is
 * bounded by construction: one row by id, {@link THREAD_PAGE_TURNS} turns, and
 * a list of ids the turns themselves produced — so none of them can be the
 * truncating read PERF-018 is about.
 *
 * No generation happens here, and none can: this is a read, and [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §5's condition is that a turn is generated in a founder-initiated command and
 * never in a render. A thread renders from rows.
 */

/**
 * How many turns a thread screen shows.
 *
 * Read from the end, because a conversation is. Fifty is enough that a founder
 * scrolling back through a week of runs reaches the start of it, and small
 * enough that the page does not grow without bound as a project ages — the
 * paging control that would let them go further is Slice 6's, beside the
 * composer that makes a thread long enough to need one.
 */
export const THREAD_PAGE_TURNS = 50;

export async function readThreadView(
  supabase: SupabaseClient,
  params: { projectId: string; threadId: string },
): Promise<ThreadView | null> {
  const thread = await getThread(supabase, params);
  if (thread === null) return null;

  const messages = await readThreadMessages(supabase, {
    threadId: thread.id,
    limit: THREAD_PAGE_TURNS,
  });

  return buildThreadView({ thread, messages, runs: await runsFor(supabase, messages) });
}

/**
 * The runs the turns name, read once.
 *
 * A run that has gone — the operation row deleted, or the message's
 * `operation_run_id` set null by the cascade — is simply absent, and
 * `buildThreadView` renders that turn with no sentence rather than inventing
 * one. An unreadable run is not an error a founder needs to be told about.
 */
async function runsFor(
  supabase: SupabaseClient,
  messages: Awaited<ReturnType<typeof readThreadMessages>>,
): Promise<ThreadEventRun[]> {
  const ids = operationRunIdsIn(messages);
  if (ids.length === 0) return [];

  const runs = await listOperationRunsByIds(supabase, ids);

  return runs.flatMap((run) =>
    run.status === "completed" || run.status === "failed"
      ? [{ id: run.id, type: run.operationType, outcome: run.status }]
      : [],
  );
}

/**
 * Which thread this project's conversation is currently in, if any.
 *
 * One row by project and status, and it deliberately does **not** open one:
 * `/threads` is a read, and a read that created a thread would mean looking at
 * a screen wrote a row. Threads are opened by something happening — see
 * `rememberOperationInThread`.
 */
export async function readOpenThreadId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const thread = await findOpenThread(supabase, projectId);
  return thread?.id ?? null;
}

/**
 * How many conversations the list shows.
 *
 * Twenty is a long time for one product and short enough that the read stays a
 * constant. There is no paging control and this is not an oversight: a founder
 * looking for a conversation from three months ago is looking for *what
 * happened*, and that is the Activity log, which has paging and is the record.
 * Threads are memory, not an archive to browse.
 */
export const THREAD_LIST_LIMIT = 20;

export type ThreadListEntry = {
  thread: Thread;
  /** Whether this is the one a run event would land in — the newest open one. */
  current: boolean;
};

/**
 * This project's conversations, and which one is current.
 *
 * "Current" is computed here rather than stored, from the same rule
 * `findOpenThread` applies: the most recently created open thread is where the
 * next event lands. Two places asking the question one way is what keeps the
 * list's highlight and the store's writes talking about the same thread.
 */
export async function readThreadList(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ThreadListEntry[]> {
  const [threads, open] = await Promise.all([
    listThreads(supabase, { projectId, limit: THREAD_LIST_LIMIT }),
    findOpenThread(supabase, projectId),
  ]);

  return threads.map((thread) => ({ thread, current: thread.id === open?.id }));
}
