import {
  PROJECT_SECTIONS,
  ProjectRail,
  projectSectionHref,
  type ProjectNavItem,
} from "@/components/layout/project-shell";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { activePlanName } from "@/modules/billing/plan-name";
import { readAgentRailStatus } from "@/modules/coding-agent/agent-workspace";
import {
  getProjectFrameContext,
  listProjectSwitcherOptions,
} from "@/modules/projects/workspace-context";
import { getProjectWorkspaceCounts } from "@/modules/projects/workspace-counts";

/**
 * The product's navigation, for the `@rail` slot (UI-13).
 *
 * ## Why the rail is not rendered by the project layout any more
 *
 * Because the `<aside>` has to outlive it. It used to be rendered by
 * `projects/[projectId]/layout.tsx`, which meant the whole element was
 * unmounted on the way into Settings and a different one — a different width —
 * was mounted in its place. The slot keeps the box in the layout above and
 * swaps only what is inside, which is the difference between a navigation that
 * unfolds and a page that appears to reload.
 *
 * ## What it loads
 *
 * The project context, two `count`-only queries, the Agent's live state, at
 * most four sibling names and one subscription row for the plan badge. The
 * project context is shared with the workspace layout through
 * `getProjectFrameContext`, so this costs one read between them, not two.
 *
 * All of it once per *product*, not once per click: the rail is a layout now
 * (`@rail/projects/[projectId]/layout.tsx`), so moving between sections
 * re-renders a null page underneath it and nothing here runs again.
 *
 * Failures in the optional reads render less furniture rather than breaking
 * the product; a badge is not worth a dead workspace.
 *
 * ## Ownership
 *
 * An unresolvable project renders no rail rather than a 404. "No such project"
 * and "not yours" are the same answer here as everywhere else — but the answer
 * belongs to the route the founder actually navigated to, and furniture beside
 * it has no business deciding the response code. What matters is the half this
 * does enforce: a rail is never drawn for a product the caller cannot read.
 */
export async function ProjectRailSlot({ projectId }: { projectId: string }) {
  const session = await requireSession();

  const project = await getProjectFrameContext(projectId, session.userId);
  if (!project) return null;

  const supabase = await createClient();

  const [counts, siblingProjects, agentStatus, planName] = await Promise.all([
    getProjectWorkspaceCounts(supabase, project.id),
    listProjectSwitcherOptions(supabase, {
      userId: session.userId,
      currentProjectId: project.id,
    }),
    readAgentRailStatus(supabase, project.id),
    activePlanName(supabase, session.userId),
  ]);

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
    count: section.id === "action-plan" ? countFor(counts.nextMoves) : null,
    /*
     * The Agent says what it is doing rather than how many changes it has
     * produced. The count is still true and still reachable — it is on the
     * page itself — but it is not what a glance at the rail is asking.
     */
    status: section.id === "agent" ? agentStatus : null,
    // Mint on Action Plan: those are things Vibe is offering to act on.
    // Agent is a neutral queue count, not an invitation.
    countTone: section.id === "action-plan" ? "accent" : "neutral",
  }));

  return (
    <ProjectRail
      projectId={project.id}
      projectName={project.name}
      connected={project.repository !== null}
      planName={planName}
      switcherItems={[
        {
          id: project.id,
          name: project.name,
          href: projectSectionHref(project.id, "home"),
          // Known, because this render resolved it. The siblings' connections
          // were not read, so they carry no line rather than a guessed one.
          repositoryFullName: project.repository?.fullName ?? null,
        },
        ...siblingProjects.map((sibling) => ({
          ...sibling,
          href: projectSectionHref(sibling.id, "home"),
        })),
      ]}
      items={navItems}
    />
  );
}
