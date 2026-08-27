import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import {
  PLAN_OPPORTUNITY_PARAM,
  sanitizeRequestedOpportunityId,
} from "@/modules/action-plans/source";
import { isDogfoodEligibleProject } from "@/modules/coding-agent/website-preflight";
import {
  getActivePreparationFor,
  getLatestFailedPreparationFor,
  getOpportunityExecutionSummaries,
} from "@/modules/execution/service";
import { buildOpportunityActionState } from "@/modules/execution/view";
import { getPreparedChangeWorkspace } from "@/modules/execution/workspace";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { buildAgentFocus } from "@/modules/projects/agent-focus";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildAgentContext } from "@/modules/projects/command-center";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { AgentPanel } from "../agent-panel";
import { PreparedChangesSection, type PreparedChangeCard } from "../prepared-changes-section";

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
 * ## The Move a founder arrived with (UI-S3 §3)
 *
 * `?plan=` names one Move. It is untrusted text: sanitized, then resolved
 * against this project's own set, and a stale or foreign id degrades to the
 * ordinary unfocused page rather than to an error or to rank 1.
 *
 * The reads it costs happen **only when a valid id is present**, and only for
 * that one Move — so the ordinary visit to this already-expensive route costs
 * exactly what it cost before. What the focus produces is a statement and a
 * link back to the Action Plan. It starts nothing: preparing a change is
 * priced and confirmed beside the Move it belongs to (Rule 60).
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
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [PLAN_OPPORTUNITY_PARAM]?: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);
  const resolvedSearchParams = await searchParams;

  // Untrusted, and never used as a lookup until it has been bounded. It becomes
  // a focus only by matching a Move this project's own set contains.
  const requestedOpportunityId = sanitizeRequestedOpportunityId(
    resolvedSearchParams[PLAN_OPPORTUNITY_PARAM],
  );

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

  /*
   * What Vibe may do about the Move the founder arrived with.
   *
   * Three reads, all skipped entirely without a valid id, and all scoped to
   * that one Move rather than to the set — this route already reads the most
   * per view of any in the workspace, and a focus must not make an unfocused
   * visit more expensive.
   *
   * The answer comes from `buildOpportunityActionState`, the same function the
   * Action Plan renders, so the two screens cannot disagree about whether Vibe
   * has an executor for this work.
   */
  const focusedMove = requestedOpportunityId
    ? (opportunities?.set.opportunities.find((entry) => entry.id === requestedOpportunityId) ??
      null)
    : null;

  const focusAction = focusedMove
    ? await (async () => {
        const [summaries, activeOperation, failedOperation] = await Promise.all([
          getOpportunityExecutionSummaries(supabase, projectId),
          getActivePreparationFor(supabase, { projectId, opportunityId: focusedMove.id }),
          getLatestFailedPreparationFor(supabase, { projectId, opportunityId: focusedMove.id }),
        ]);

        const summary = summaries.find((entry) => entry.opportunityId === focusedMove.id);
        // No summary at all means no repository snapshot exists yet. That is a
        // missing premise rather than a verdict on the Move, and `buildAgentFocus`
        // says so rather than calling it unautomatable.
        if (!summary) return null;

        return buildOpportunityActionState({
          opportunity: focusedMove,
          capability: summary.capability,
          preparedChangeId: summary.preparedChangeId,
          activeOperation,
          failedOperation,
          blockedReason: null,
        });
      })()
    : null;

  const focus = buildAgentFocus({
    requestedOpportunityId,
    opportunities: opportunities?.set.opportunities ?? [],
    action: focusAction,
  });

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

  return (
    <WorkspaceSection
      id="agent"
      title="Agent"
      description="Each change moves through validation, preview, review and your approval before anything can be merged."
    >
      <div className="flex flex-col gap-5">
        <AgentPanel
          context={context}
          focus={focus}
          preparedCount={changes.length}
          planHref={projectSectionHref(project.id, "action-plan")}
          agentHref={projectSectionHref(project.id, "agent")}
          productHref={projectSectionHref(project.id, "my-product")}
          executionHref={executionHref}
        />

        {changes.length > 0 ? (
          <PreparedChangesSection
            projectId={project.id}
            changes={changes}
            planHref={projectSectionHref(project.id, "action-plan")}
          />
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
