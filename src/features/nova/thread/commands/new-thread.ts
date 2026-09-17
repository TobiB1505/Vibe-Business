"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { countMessages, findOpenThread, openNewThread } from "@/modules/nova/threads/store";
import { NEW_THREAD_TITLE } from "@/modules/nova/threads/schema";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { threadPath, threadsPath } from "@/lib/routing/project-urls";

/**
 * *New chat* (ADR 0109 §1).
 *
 * ## Why pressing it twice does not make two empty threads
 *
 * Because the second press means the same thing as the first: *give me
 * somewhere to start*. If the conversation that is currently open has nothing
 * in it, that is already somewhere to start, and a second empty thread beside
 * it would be two identical rows in the founder's own list with no way to tell
 * them apart. So an empty open thread is reused and the founder lands in the
 * same place either way — which is what they asked for both times.
 *
 * A thread with anything in it is never reused. That is the whole point of the
 * button.
 *
 * ## Why this writes under the founder's own session
 *
 * `nova_threads` grants `authenticated` an insert on three columns behind a
 * policy that reads ownership off the project row, so RLS is the authority here
 * rather than a check in this function. The service-role client is foreclosed
 * for this layer by name (restructure audit §C.8) and would be the wrong tool
 * anyway: a founder opening their own conversation is exactly the case RLS is
 * for.
 */
export async function startNewThreadAction(projectId: string): Promise<void> {
  const access = await requireProjectAccess(projectId);

  const open = await findOpenThread(access.supabase, projectId);

  const thread =
    open !== null && (await countMessages(access.supabase, { threadId: open.id })) === 0
      ? open
      : await openNewThread(access.supabase, {
          projectId,
          userId: access.userId,
          title: NEW_THREAD_TITLE,
        });

  revalidatePath(threadsPath(projectId));
  redirect(threadPath(projectId, thread.id));
}
