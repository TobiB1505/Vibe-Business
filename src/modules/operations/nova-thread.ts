import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appendMessage, ensureOpenThread } from "../nova/threads/store";
import { leavesThreadEvent } from "../nova/threads/schema";
import type { OperationType } from "./schema";

/**
 * A run that ended leaves a memory, and never anything else.
 *
 * ## Why this is called from the terminal transition and not from each tail
 *
 * There are ninety call sites of `completeOperationRun` and `failOperationRun`
 * across twenty-three files, and the restructure audit's plan was to append
 * "beside `speakAfterOperation`" — which exists in exactly two of them. Wiring
 * the other twenty-one is twenty-one chances to miss one, and a missing system
 * message is invisible: the thread simply has a gap nobody can see is a gap.
 *
 * The two store functions are the only place a run becomes terminal, and they
 * already return *whether this call performed the transition* — the exact
 * idempotency signal an append needs, built for replayed workflow steps. So the
 * message is written where the transition is, once, and a new operation type
 * gets one by existing.
 *
 * ## Why it can never fail a run
 *
 * A conversation entry is not worth failing a run that already succeeded over.
 * Everything here is inside a `try` that swallows, the same standing
 * `speakAfterOperation` has: *"returns void and never throws"*. A thread with a
 * gap is a worse product; a merge marked failed because a message could not be
 * written is a worse incident.
 *
 * ## What it must never write
 *
 * Words. An `event` row carries the run it is about and nothing else — the
 * sentence a founder reads is composed by `threads/view.ts` from today's table,
 * so a reworded product does not leave last month's phrasing in a row. The
 * migration's CHECK refuses the alternative rather than trusting this comment.
 */
export async function rememberOperationInThread(
  supabase: SupabaseClient,
  params: {
    operationId: string;
    projectId: string | null;
    userId: string;
    type: OperationType;
    /** What Vibe is calling this project's conversation, when it opens one. */
    threadTitle: string;
  },
): Promise<void> {
  /*
   * Account-level operations have no project, and a thread is project-scoped
   * (restructure audit §E.4 leaves account-level threads open). Nothing to
   * write, rather than a thread nobody could reach.
   */
  if (params.projectId === null) return;
  if (!leavesThreadEvent(params.type)) return;

  try {
    const thread = await ensureOpenThread(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      title: params.threadTitle,
    });

    await appendMessage(supabase, {
      thread,
      userId: params.userId,
      message: { author: "system", kind: "event", operationRunId: params.operationId },
    });
  } catch {
    /*
     * Deliberately silent. The operation this is the tail of has already
     * reached a terminal state that a founder's screen is reading; throwing
     * here would turn a missing conversation entry into a failed run, and
     * re-raising into a durable step would retry a transition that already
     * happened.
     */
  }
}

/**
 * What Vibe calls a project's first thread.
 *
 * A constant rather than a composed sentence, because the first thread is
 * opened by a run finishing rather than by a founder asking something — there
 * is no question to name it after. Slice 6's composer titles a thread from the
 * founder's first line, which is the better name and the one that needs a
 * person in the room to produce.
 */
export const FIRST_THREAD_TITLE = "Your product";
