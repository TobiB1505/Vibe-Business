import "server-only";

import Link from "next/link";
import { Suspense } from "react";
import { ArrowRightIcon } from "@/components/ui/icons.generated";
import { EmptyState } from "@/components/ui/states";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { ArtifactRef } from "@/modules/nova/artifacts";
import type { ProjectAccess } from "@/modules/projects/workspace-context";
import { cn } from "@/lib/utils/cn";
import { artifactOpen } from "./artifact-open";
import { artifactView } from "./artifact-views";
import { WorkspacePane } from "./workspace-pane";

/**
 * The pane, with the reads behind it.
 *
 * ## Why the frame and the reads are two files
 *
 * Because the frame is the part a browser has to be able to see, and every read
 * reached from here needs a session-scoped Supabase client. It is also the cost
 * the artifact registry is written to avoid: this file's import graph is ten
 * features' server code, and a pane that carried it would drag all of it into
 * anything that wanted the frame.
 *
 * The same shape `NovaRoom` has for the same reason — the room is a grid that
 * takes nodes, and what fills them is the caller's.
 */
export function ProjectWorkspacePane({
  access,
  artifact,
  className,
}: {
  access: ProjectAccess;
  artifact: ArtifactRef | null;
  className?: string;
}) {
  return (
    <WorkspacePane projectId={access.project.id} artifact={artifact} className={className}>
      {/*
        Its own boundary, so the conversation paints without waiting for the
        artifact's read. A prepared change signs review images and runs a merge
        preflight; a transcript should never be held behind that.
      */}
      {artifact !== null && (
        <Suspense fallback={<PaneSkeleton />}>
          <Artifact access={access} artifact={artifact} />
        </Suspense>
      )}
    </WorkspacePane>
  );
}

async function Artifact({ access, artifact }: { access: ProjectAccess; artifact: ArtifactRef }) {
  const result = await artifactView(access, artifact);

  if (result.kind === "view") return result.node;

  const open = artifactOpen(access.project.id, artifact);

  /*
   * An artifact that is read at its own address. The reason is shown rather
   * than hidden behind a bare button: a founder who presses a link deserves to
   * know why it is a link and not the thing itself.
   */
  return (
    <EmptyState
      title={open.label}
      description={result.reason}
      action={
        <Link
          href={open.href}
          className={cn(
            "bg-mint text-ink rounded-control inline-flex items-center gap-2 px-4 py-2",
            "text-body font-semibold transition-interactive hover:opacity-90",
            "focus-visible:ring-mint focus-visible:ring-offset-surface-1 focus-visible:ring-2",
            "focus-visible:ring-offset-2 focus-visible:outline-none",
          )}
        >
          Open {open.label}
          <ArrowRightIcon size={15} aria-hidden className="shrink-0" />
        </Link>
      }
    />
  );
}

function PaneSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <SkeletonBlock className="rounded-panel h-40 w-full" />
      <SkeletonBlock className="rounded-inline h-4 w-3/4" />
      <SkeletonBlock className="rounded-inline h-4 w-1/2" />
    </div>
  );
}
