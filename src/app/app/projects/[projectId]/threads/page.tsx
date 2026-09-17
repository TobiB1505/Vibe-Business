import type { Metadata } from "next";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { readThreadList } from "@/features/nova/thread/queries";
import { ThreadList } from "@/features/nova/thread/thread-list";
import { THREADS_HEADING } from "@/features/nova/thread/thread-skeleton";

export const metadata: Metadata = {
  title: "Conversations",
  description: "Every conversation this product has had.",
};

/**
 * This project's conversations.
 *
 * ## What this route used to be, and why it changed
 *
 * A redirect to whichever thread was open. That was right while a project could
 * only have one — the address meant *this project's conversation* and resolving
 * it to the single thread was the whole job. Slice 7's *New chat* makes a
 * second one possible, and an address that silently picked one of several would
 * be the product deciding which conversation a founder meant.
 *
 * Every link into it still works: `threadsPath` is unchanged, the shell's
 * *Threads* destination is this, and a thread's own address is unaffected.
 *
 * Opening this creates nothing. A thread is opened by something *happening* —
 * `rememberOperationInThread` at a run's terminal transition — or by a founder
 * pressing *New chat*, which is a command and not a render. A read that created
 * a row would mean looking at a screen wrote one.
 */
export default async function ProjectThreadsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);

  const entries = await readThreadList(access.supabase, projectId);

  return (
    <section aria-labelledby="threads-heading" className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="text-mint text-[0.68rem] font-semibold tracking-[0.15em] uppercase">
          {THREADS_HEADING.eyebrow}
        </span>
        <h1 id="threads-heading" className="text-fg text-headline font-bold sm:text-display">
          {THREADS_HEADING.title}
        </h1>
      </div>

      <ThreadList projectId={projectId} entries={entries} />
    </section>
  );
}
