import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { readOpenThreadId } from "@/features/nova/thread/queries";
import { EmptyThread } from "@/features/nova/thread/thread-view";
import { threadPath } from "@/lib/routing/project-urls";

export const metadata: Metadata = {
  title: "Conversation",
  description: "What has happened to this product, in order.",
};

/**
 * This project's conversation, wherever it currently is.
 *
 * A stable address that resolves to the open thread rather than a screen of its
 * own — which is what lets a link from Nova's rail, and the shell's *Threads*
 * destination when it arrives (Slice 7), point somewhere that stays correct as
 * threads come and go.
 *
 * A project with nothing written down yet renders the same empty state the
 * thread screen does, rather than 404ing or redirecting somewhere else: "there
 * is no conversation yet" is an answer, and it is the one a founder who
 * followed the link is owed.
 *
 * Opening this creates nothing. A thread is opened by something *happening* —
 * `rememberOperationInThread`, at a run's terminal transition — so that reading
 * a screen never writes a row.
 */
export default async function ProjectThreadsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);

  const threadId = await readOpenThreadId(access.supabase, projectId);
  if (threadId !== null) redirect(threadPath(projectId, threadId));

  return (
    <section aria-labelledby="thread-heading" className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="text-mint text-[0.68rem] font-semibold tracking-[0.15em] uppercase">
          Conversation
        </span>
        <h1 id="thread-heading" className="text-fg text-headline font-bold sm:text-display">
          Nothing written down yet
        </h1>
      </div>

      <EmptyThread />
    </section>
  );
}
