import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { isDogfoodEligibleProject } from "@/modules/coding-agent/website-preflight";
import { getPreparedChangeWorkspace } from "@/modules/execution/workspace";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildAgentContext } from "@/modules/projects/command-center";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { readAgentWorkspace } from "@/modules/coding-agent/agent-workspace";
import { agentCoreCaption } from "@/modules/coding-agent/observability/agent-stages";
import { AgentPanel } from "../agent-panel";
import { PreparedChangesSection, type PreparedChangeCard } from "../prepared-changes-section";
import { AgentTaskPanel } from "./agent-task-panel";
import { AgentActivity } from "./agent-activity";
import { AgentWorkspacePanel } from "./agent-workspace-panel";

/**
 * Agent (Sprint UI-2 Part 2 as Prepared; reframed by CORE-5).
 *
 * ## What the page is now about
 *
 * The same lifecycle, told as the work of a team member rather than as a queue
 * of artifacts. `AgentPanel` opens with what Vibe's engineer knows about this
 * business; the prepared changes below it are what it has produced. Nothing
 * about the gates changed.
 *
 * The three extra reads this costs — the product profile, the repository
 * snapshot and the opportunity set — are existence checks, and each is a
 * single row. They are what makes the readiness claim derived rather than
 * asserted.
 *
 * ## The expensive route, and the only one that should be
 *
 * This is where the prepared-change workspace read model is called, and it is
 * the reason UI-2 Part 1 extracted it. Per change it reads validation, preview,
 * review, approval, outcome and business impact; for an approved change it
 * additionally spends up to four read-only GitHub calls; for a ready review it
 * signs image URLs; for a running preview it asks the sandbox provider for an
 * origin.
 *
 * That cost is legitimate *here*, because this is the screen that shows all of
 * it. Before the split, every other section paid it too.
 *
 * ## Gates
 *
 * The order — validation → preview → review → human approval → safe merge →
 * outcome — is decided by the services behind the read model and rendered by
 * `PreparedChangesSection`. Nothing on this route re-decides it, and no gate
 * can be skipped by arriving at this URL directly: the state comes from
 * persisted rows, not from navigation.
 */
export default async function ProjectAgentPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const [changes, profile, repositorySnapshot, opportunities] = await Promise.all([
    getPreparedChangeWorkspace(supabase, {
      projectId,
      userId,
      repositoryFullName: project.repository?.fullName ?? null,
    }) as Promise<PreparedChangeCard[]>,
    getLatestProfile(supabase, projectId),
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
  ]);

  const context = buildAgentContext({
    hasProductUnderstanding: profile !== null,
    // Connected *and* read. A repository Vibe has never analyzed is not code
    // it can work from.
    hasRepositoryUnderstanding: project.repository !== null && Boolean(repositorySnapshot?.result),
    hasBusinessGoals: (opportunities?.set.opportunities.length ?? 0) > 0,
  });

  /*
   * The internal execution surface, offered only where the allowlist already
   * allows it. Resolved server-side; the link's absence is the same answer the
   * route itself gives (`notFound`), so nothing here reveals that it exists.
   */
  const executionHref = isDogfoodEligibleProject(project.id)
    ? `/app/projects/${project.id}/agent-dogfood`
    : null;

  /*
   * The five-stage view of the latest run, and the change it produced.
   *
   * Reuses the prepared changes this route already read rather than paying for
   * the workspace twice — that read is the expensive one here, and it is the
   * cost UI-2 Part 1 split apart in the first place.
   */
  const workspace = await readAgentWorkspace(supabase, {
    projectId: project.id,
    userId,
    changes,
  });

  return (
    <WorkspaceSection
      id="agent"
      title="Agent"
      description="Each change moves through validation, preview, review and your approval before anything can be merged."
    >
      <div className="flex flex-col gap-5">
        {workspace.timeline !== null ? (
          <AgentWorkspacePanel
            stages={workspace.stages}
            core={workspace.core}
            caption={agentCoreCaption(workspace.stages)}
            aside={
              <AgentActivity
                steps={workspace.timeline}
                live={workspace.core === "working" || workspace.core === "waiting"}
              />
            }
          >
            {/*
              The Move, in its own stored words. Absent when the run cannot be
              followed back to one — a screen naming the wrong task would be
              worse than one naming none.
            */}
            {workspace.task !== null && (
              <AgentTaskPanel task={workspace.task} compact />
            )}
          </AgentWorkspacePanel>
        ) : (
          /*
            Nothing has ever run. The readiness card is the honest thing to show
            — it describes what Vibe knows and points at where work is chosen,
            and it starts nothing, because preparing a change is a priced action
            that belongs beside the Move it is for.
          */
          <AgentWorkspacePanel
            stages={workspace.stages}
            core={workspace.core}
            caption={agentCoreCaption(workspace.stages)}
          >
            <AgentPanel
              context={context}
              preparedCount={changes.length}
              planHref={projectSectionHref(project.id, "action-plan")}
              productHref={projectSectionHref(project.id, "my-product")}
              executionHref={executionHref}
            />
          </AgentWorkspacePanel>
        )}

        {changes.length > 0 ? (
          <PreparedChangesSection projectId={project.id} changes={changes} />
        ) : (
          <EmptyState
            title="Nothing prepared yet"
            description="When you let Vibe act on one of your next moves, the prepared change appears here with its validation, preview, review and approval state."
          />
        )}
      </div>
    </WorkspaceSection>
  );
}
