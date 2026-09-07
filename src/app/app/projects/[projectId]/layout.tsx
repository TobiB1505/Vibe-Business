import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectBreadcrumbTrail } from "@/components/layout/project-breadcrumb-trail";
import { RecordVisit } from "@/components/layout/record-visit";
import { ProjectShell } from "@/components/layout/project-shell";
import { requireSession } from "@/modules/auth/session";
import { getProjectFrameContext } from "@/modules/projects/workspace-context";

/**
 * The workspace column, shared by every section route (Sprint UI-2 Part 2).
 *
 * ## What it loads, and why the list got shorter
 *
 * One project row, for the breadcrumb. Everything else this used to load —
 * the navigation counts, the Agent's live status, the sibling products, the
 * account identity and the balance — belonged to the rail, and the rail is now
 * the `@rail` slot beside this layout (UI-13). The project row itself is
 * shared with that slot through `getProjectFrameContext`, which memoizes for
 * the length of one render, so the move cost no extra query.
 *
 * The audit, opportunities, prepared changes, Deep Scan, impact and activity
 * are each loaded by the one route that shows them. That separation is the
 * whole point of the split — before it, opening the Business score signed
 * review-image URLs and ran the merge preflight.
 *
 * ## Ownership
 *
 * Resolved here for the frame, and again in each route. An App Router layout
 * does not gate the routes beneath it — they render independently — so a route
 * that trusted its layout to have checked would be reachable by direct URL.
 * Every route re-checks; see the route files.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const session = await requireSession();
  const { projectId } = await params;

  // The same answer for "no such project" and "not yours", so a URL cannot be
  // used to discover which project ids exist.
  const project = await getProjectFrameContext(projectId, session.userId);
  if (!project) notFound();

  return (
    <ProjectShell>
      {/* So `/app` comes back here rather than to whichever product the
          ranking happens to put first. A client leaf: only a mount is an
          opening, and a write during render would also run on prefetch. */}
      <RecordVisit projectId={project.id} />
      <ProjectBreadcrumbTrail projectId={project.id} projectName={project.name} />
      {children}
    </ProjectShell>
  );
}
