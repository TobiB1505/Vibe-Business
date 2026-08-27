"use client";

import { usePathname } from "next/navigation";
import { ProjectBreadcrumb, projectSectionLabel } from "./project-shell";

/**
 * The project breadcrumb, with the current route as its last step.
 *
 * A client component for the same reason `ProjectNav` is one: the answer is
 * derived from `usePathname`, so it is correct after a hard refresh, after
 * browser Back, and in a tab opened from a link — the three cases a value the
 * layout guessed once gets wrong.
 *
 * It resolves nothing the rail does not already own. `projectSectionLabel`
 * reads the same `PROJECT_SECTIONS` table that builds the hrefs, so a renamed
 * or moved section cannot leave a stale word in the trail.
 */
export function ProjectBreadcrumbTrail({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const pathname = usePathname();
  return (
    <ProjectBreadcrumb
      projectName={projectName}
      section={projectSectionLabel(projectId, pathname) ?? undefined}
    />
  );
}
