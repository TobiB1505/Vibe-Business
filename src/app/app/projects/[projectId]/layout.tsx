import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  PROJECT_SECTIONS,
  ProjectHeader,
  ProjectShell,
  ProjectSidebar,
  projectSectionHref,
  type ProjectNavItem,
} from "@/components/layout/project-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getProjectWorkspaceContext } from "@/modules/projects/workspace-context";

/**
 * The workspace frame, shared by every section route (Sprint UI-2 Part 2).
 *
 * ## What it loads, and why that list is short
 *
 * A layout runs on *every* route beneath it, so anything loaded here is paid
 * for by all seven sections. It therefore loads only what the frame itself
 * renders: the project's identity and its repository connection.
 *
 * The audit, opportunities, prepared changes, Deep Scan, impact and activity
 * are each loaded by the one route that shows them. That separation is the
 * whole point of the split — before it, opening the Business score signed
 * review-image URLs and ran the merge preflight.
 *
 * ## No counts in the navigation
 *
 * UI-1's sidebar showed "3" beside Next moves and "2" beside Prepared. Those
 * came free because the page had already loaded both. Here they would cost an
 * opportunity read and a prepared-change read on every route, which is exactly
 * the cost this layout exists to avoid — so the badges are gone rather than
 * quietly re-introducing the coupling. They can come back the day a cheap
 * counts query exists.
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

  const supabase = await createClient();
  const project = await getProjectWorkspaceContext(supabase, {
    projectId,
    userId: session.userId,
  });

  // The same answer for "no such project" and "not yours", so a URL cannot be
  // used to discover which project ids exist.
  if (!project) notFound();

  const navItems: ProjectNavItem[] = PROJECT_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    href: projectSectionHref(project.id, section.id),
  }));

  return (
    <ProjectShell
      sidebar={
        <ProjectSidebar
          projectName={project.name}
          repositoryFullName={project.repository?.fullName ?? null}
          tone={project.repository ? (project.accessible ? "active" : "waiting") : "neutral"}
          items={navItems}
        />
      }
    >
      <ProjectHeader
        projectName={project.name}
        title={project.name}
        meta={
          project.repository ? (
            <>
              <a
                href={project.repository.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-fg-body hover:text-fg rounded-sm font-mono text-xs underline underline-offset-4 transition-colors"
              >
                {project.repository.fullName}
              </a>
              <span className="text-fg-muted font-mono text-xs">
                {project.repository.defaultBranch}
              </span>
              {/* The word carries the state, so colour is never the only signal
                  — and "GitHub access unavailable" stays the product's existing
                  wording rather than a friendlier, vaguer one. */}
              <StatusPill tone={project.accessible ? "success" : "waiting"} dot>
                {project.accessible ? "Connected" : "GitHub access unavailable"}
              </StatusPill>
            </>
          ) : (
            <StatusPill tone="neutral">No repository connected</StatusPill>
          )
        }
      />

      <div className="px-5 py-8 sm:px-8 sm:py-10">{children}</div>
    </ProjectShell>
  );
}
