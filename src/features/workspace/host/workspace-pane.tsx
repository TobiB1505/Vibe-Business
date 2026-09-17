import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "@/components/ui/icons.generated";
import { EmptyState } from "@/components/ui/states";
import { MonoLabel } from "@/components/ui/typography";
import type { ArtifactRef } from "@/modules/nova/artifacts";
import { cn } from "@/lib/utils/cn";
import { artifactOpen } from "./artifact-open";
import { WORKSPACE_ANCHOR } from "../registry/artifacts";

/**
 * The workspace: what Nova is talking about, beside what she said about it.
 *
 * ## Why this is a parameter and not a route
 *
 * [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4 asks for the artifact to be visible *while the conversation stays
 * visible*. A route would have replaced the conversation, and "returning to it"
 * would then have needed a mechanism — a stored scroll position, a back stack,
 * a remembered thread. A query parameter on the thread's own address needs
 * none of that, because the founder never left: the transcript is the same
 * rendered tree, the composer keeps its draft, and the address is shareable.
 *
 * ## Why the pane is a column above `lg` and a section below it
 *
 * ADR 0108 says the workspace is a bottom sheet on a phone, and this is a
 * stacked section instead. The reason is DOM rather than taste: a sheet is a
 * `<dialog>`, a column is an `<aside>`, and a server-rendered artifact cannot
 * be in both without being rendered twice — two copies of a business map, two
 * sets of ids, two of every control inside a review gate. The founder reaches
 * it the same way either way (a chip in the conversation, the phone's
 * *Workspace* tab), it is deep-linkable, and returning is scrolling rather than
 * dismissing. What ADR 0108 was protecting against is a *squeezed column*; a
 * section at full width is the other honest answer to that.
 *
 * ## Why this file holds no read
 *
 * So that a browser can see it. The artifacts are resolved by
 * `ProjectWorkspacePane`, which needs a session-scoped Supabase client, and the
 * fixture route the browser suite drives has neither a session nor a database.
 * A pane that resolved its own artifact would be a pane nothing could screenshot
 * at 390px — which is rule 69's third question answered with a shrug.
 *
 * ## What it does not decide
 *
 * Which artifact. The parameter says, and the parameter comes from a chip the
 * founder pressed or a link they followed. When there is none, the thread's own
 * most recent artifact message is the default — Nova pointed at it, so it is
 * what the conversation is about.
 */
export function WorkspacePane({
  projectId,
  artifact,
  className,
  children,
}: {
  projectId: string;
  /** What to show, already parsed and checked. Null draws the resting state. */
  artifact: ArtifactRef | null;
  className?: string;
  /** The artifact itself, resolved by whoever holds a database handle. */
  children?: ReactNode;
}) {
  return (
    <aside
      id={WORKSPACE_ANCHOR}
      aria-label="Workspace"
      data-testid="workspace-pane"
      className={cn("flex min-w-0 scroll-mt-6 flex-col gap-4", className)}
    >
      {artifact === null ? (
        <Resting />
      ) : (
        <>
          <WorkspaceHeader projectId={projectId} artifact={artifact} />
          {children}
        </>
      )}
    </aside>
  );
}

/**
 * What the pane is showing, and the way out to the whole of it.
 *
 * The name comes from the section table through `artifactOpen`, which is the
 * same table the rail and the page heading read — a third copy here is the
 * drift `WORKSPACE_SECTION_HEADINGS` exists because of.
 */
function WorkspaceHeader({ projectId, artifact }: { projectId: string; artifact: ArtifactRef }) {
  const open = artifactOpen(projectId, artifact);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MonoLabel className="tracking-[0.18em]">{open.label}</MonoLabel>
      <Link
        href={open.href}
        className={cn(
          "text-fg-secondary hover:text-fg-body rounded-inline inline-flex items-center gap-1.5",
          "text-label font-medium transition-interactive",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        Open in full
        <ArrowRightIcon size={14} aria-hidden className="shrink-0" />
      </Link>
    </div>
  );
}

/**
 * The pane with nothing in it yet.
 *
 * Not an error and not an invitation to navigate: the conversation beside it is
 * the thing to use, and this says what will appear here when it does. A pane
 * that listed every section would be the second navigation ADR 0109 §4 refuses
 * — *"the workspace is not a second navigation"*.
 */
function Resting() {
  return (
    <EmptyState
      title="Nothing open yet"
      description="When Nova points at something — your business reading, a Move, a change waiting for you — it opens here, beside what she said about it."
    />
  );
}
