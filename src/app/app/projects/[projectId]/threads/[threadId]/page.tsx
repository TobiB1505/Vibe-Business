import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { readThreadView } from "@/features/nova/thread/queries";
import { ThreadScreen } from "@/features/nova/thread/thread-view";
import { ProjectWorkspacePane } from "@/features/workspace/host/project-workspace-pane";
import { latestArtifactIn } from "@/modules/nova/threads/view";
import {
  parseArtifactRef,
  WORKSPACE_ARTIFACT_PARAM,
  WORKSPACE_ARTIFACT_REF_PARAM,
} from "@/modules/nova/artifacts";

export const metadata: Metadata = {
  title: "Conversation",
  description: "What has happened to this product, in order.",
};

/** The one value a query parameter can honestly be read as. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One conversation, and the thing it is about.
 *
 * An access gate and a composition, and nothing else (rule 86). The reads are
 * `features/nova/thread/queries.ts` and the pane's own; the screens are beside
 * them.
 *
 * ## Nova explains, the workspace shows
 *
 * Two columns from `lg` and two stacked sections below it, which is the whole
 * of [ADR 0109](../../../../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4 as a layout. The conversation is the wider of the two because it is the
 * thing being read; the pane is fixed at the width an artifact was drawn for.
 *
 * ## Which artifact
 *
 * The address, when it says. Otherwise the last thing Nova pointed at in this
 * thread — a conversation is about something, and the most recent pointer is
 * the honest answer to what. A parameter naming a kind that does not exist, or
 * omitting a reference the address needs, resolves to nothing rather than to a
 * guess: the pane then says what it is for, which is better than opening on a
 * section nobody asked for.
 *
 * A thread that is not this project's answers 404 rather than 403, which is the
 * same answer `requireProjectAccess` gives an id that does not exist — from
 * outside, "not yours" and "not there" must not be distinguishable.
 */
export default async function ProjectThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, threadId } = await params;
  const access = await requireProjectAccess(projectId);

  const view = await readThreadView(access.supabase, { projectId, threadId });
  if (view === null) notFound();

  const query = await searchParams;
  const artifact =
    parseArtifactRef(
      one(query[WORKSPACE_ARTIFACT_PARAM]),
      one(query[WORKSPACE_ARTIFACT_REF_PARAM]),
    ) ?? latestArtifactIn(view);

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
      {/*
        Its own heading rather than a `WorkspaceSection`. That component reads
        its title out of `WORKSPACE_SECTION_HEADINGS` — one static pair per
        section, so a page and the skeleton standing in for it cannot disagree —
        and a thread's title is the thread's own.
      */}
      <section aria-labelledby="thread-heading" className="flex min-w-0 flex-col gap-7">
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

      <ProjectWorkspacePane
        access={access}
        artifact={artifact}
        /* Sticky beside a long transcript: the thing under discussion should
           not scroll away from the sentence about it. Only where there is a
           column to be sticky in. */
        className="lg:sticky lg:top-6"
      />
    </div>
  );
}
