import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectBreadcrumbTrail } from "@/components/layout/project-breadcrumb-trail";
import {
  PROJECT_SECTIONS,
  ProjectShell,
  ProjectSidebar,
  projectSectionHref,
  type ProjectNavItem,
} from "@/components/layout/project-shell";
import { AccountMenu } from "@/components/layout/account-menu";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import { getGithubIdentity } from "@/modules/github/identity";
import {
  getProjectWorkspaceContext,
  listProjectSwitcherOptions,
} from "@/modules/projects/workspace-context";
import { getProjectWorkspaceCounts } from "@/modules/projects/workspace-counts";

/**
 * The workspace frame, shared by every section route (Sprint UI-2 Part 2).
 *
 * ## What it loads, and why that list is short
 *
 * A layout runs on *every* route beneath it, so anything loaded here is paid
 * for by every project route. It therefore loads only what the frame itself
 * renders: the project's identity and stored repository connection, two
 * navigation counts, one account identity row and at most four sibling project
 * names for the switcher.
 *
 * The audit, opportunities, prepared changes, Deep Scan, impact and activity
 * are each loaded by the one route that shows them. That separation is the
 * whole point of the split — before it, opening the Business score signed
 * review-image URLs and ran the merge preflight.
 *
 * ## The counts, and what they are allowed to cost
 *
 * UI-1's badges came free because the single page had already loaded both
 * lists. UI-2 removed them rather than putting an opportunity read and a
 * prepared read into this layout, where every project route would pay.
 *
 * They are back (Sprint UI-2.5) as two `count`-only queries that transfer no
 * rows — see `workspace-counts.ts`. The switcher read is independently capped
 * at four alternatives, and the account identity is one unique row. Failures
 * in the optional counts/switcher render less furniture rather than breaking
 * the project; neither a badge nor a shortcut is worth a dead workspace.
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

  const [counts, github, siblingProjects] = await Promise.all([
    getProjectWorkspaceCounts(supabase, project.id),
    getGithubIdentity(supabase, session.userId),
    listProjectSwitcherOptions(supabase, {
      userId: session.userId,
      currentProjectId: project.id,
    }),
  ]);
  const identity = buildAccountIdentity({ email: session.email, github });

  /**
   * A badge only where the number carries information. Zero is hidden rather
   * than rendered: "0 next moves" is decoration, and it is indistinguishable
   * at a glance from a count that failed — which is exactly the confusion
   * `null` exists to prevent.
   */
  const countFor = (value: number | null): number | null => (value && value > 0 ? value : null);

  const navItems: ProjectNavItem[] = PROJECT_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    icon: section.icon,
    href: projectSectionHref(project.id, section.id),
    count:
      section.id === "action-plan"
        ? countFor(counts.nextMoves)
        : section.id === "agent"
          ? countFor(counts.prepared)
          : null,
    // Mint on Action Plan: those are things Vibe is offering to act on.
    // Agent is a neutral queue count, not an invitation.
    countTone: section.id === "action-plan" ? "accent" : "neutral",
  }));

  return (
    <ProjectShell
      sidebar={
        <ProjectSidebar
          projectId={project.id}
          projectName={project.name}
          repositoryFullName={project.repository?.fullName ?? null}
          connected={project.repository !== null}
          switcherItems={[
            {
              id: project.id,
              name: project.name,
              href: projectSectionHref(project.id, "home"),
            },
            ...siblingProjects.map((sibling) => ({
              ...sibling,
              href: projectSectionHref(sibling.id, "home"),
            })),
          ]}
          items={navItems}
          footer={<AccountMenu identity={identity} subtitle="Founder" placement="above" />}
        />
      }
    >
      <ProjectBreadcrumbTrail projectId={project.id} projectName={project.name} />
      {children}
    </ProjectShell>
  );
}
