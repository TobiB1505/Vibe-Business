import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { readThreadView } from "@/features/nova/thread/queries";
import { ThreadScreen } from "@/features/nova/thread/thread-view";

export const metadata: Metadata = {
  title: "Conversation",
  description: "What has happened to this product, in order.",
};

/**
 * One conversation, at its own address.
 *
 * An access gate and a composition, and nothing else (rule 86). The reads are
 * `features/nova/thread/queries.ts`; the screen is beside them.
 *
 * A thread that is not this project's answers 404 rather than 403, which is the
 * same answer `requireProjectAccess` gives an id that does not exist — from
 * outside, "not yours" and "not there" must not be distinguishable.
 */
export default async function ProjectThreadPage({
  params,
}: {
  params: Promise<{ projectId: string; threadId: string }>;
}) {
  const { projectId, threadId } = await params;
  const access = await requireProjectAccess(projectId);

  const view = await readThreadView(access.supabase, { projectId, threadId });
  if (view === null) notFound();

  /*
   * Its own heading rather than a `WorkspaceSection`. That component reads its
   * title out of `WORKSPACE_SECTION_HEADINGS` — one static pair per section,
   * so a page and the skeleton standing in for it cannot disagree — and a
   * thread's title is the thread's own. Threads are not a rail section yet
   * either; the *Threads* destination arrives with the shell (Slice 7).
   */
  return (
    <section aria-labelledby="thread-heading" className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="text-mint text-[0.68rem] font-semibold tracking-[0.15em] uppercase">
          Conversation
        </span>
        <h1 id="thread-heading" className="text-fg text-headline font-bold sm:text-display">
          {view.thread.title}
        </h1>
      </div>

      <ThreadScreen view={view} />
    </section>
  );
}
