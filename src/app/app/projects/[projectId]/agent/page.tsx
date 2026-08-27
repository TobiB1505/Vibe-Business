import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { EmptyState, Notice } from "@/components/ui/states";
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
import { readAgentWorkspace } from "@/modules/coding-agent/agent-workspace";
import { agentCoreCaption } from "@/modules/coding-agent/observability/agent-stages";
import { AgentPanel } from "../agent-panel";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { preparedChangeAnchorId } from "@/components/layout/project-shell";
import { ChangeGates } from "./change-gates";
import { AgentTaskPanel } from "./agent-task-panel";
import { Surface } from "@/components/ui/surface";
import { AgentActivity } from "./agent-activity";
import { AgentValidationChecks } from "./agent-validation-checks";
import { AgentReadyFacts } from "./agent-start-cta";
import { AgentQuestionPanel } from "./agent-question-panel";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { resolveAgentInterruptAction } from "./interrupt-actions";
import { AgentFileActivity } from "./agent-file-activity";
import { AgentMergeStage } from "./agent-merge-stage";
import { AgentPreviewStage } from "./agent-preview-stage";
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
    }) as Promise<PreparedChangeWorkspaceItem[]>,
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

  const planHref: string = projectSectionHref(project.id, "action-plan");
  /* One binding, so the gate panels below read as one change rather than as
     seven reaches into the workspace view. */
  const change = workspace.change;

  return (
    <WorkspaceSection
      id="agent"
      title="Agent"
      description="Each change moves through validation, preview, review and your approval before anything can be merged."
    >
      <div className="flex flex-col gap-5">
        {/*
          A run that stopped to ask something makes the question the only
          primary object on the screen, above the stages. It is the one state
          where the founder is the blocker.
        */}
        {workspace.interrupt !== null && (
          <AgentQuestionPanel interrupt={workspace.interrupt}>
            {workspace.founderInput !== null ? (
              <FounderInputCard
                projectId={project.id}
                request={workspace.founderInput}
                context="runtime_execution"
                resolveAction={resolveAgentInterruptAction}
                presentation="workspace"
              />
            ) : (
              /*
                An older execution, from before Founder Input Resolution. Its
                question is readable and cannot be answered under the current
                contract, and saying that is better than an input that resolves
                nothing.
              */
              <Notice tone="waiting" label="answer required">
                This run stopped before the current question format existed, so it cannot be
                answered here. Starting a fresh attempt is the way forward.
              </Notice>
            )}
          </AgentQuestionPanel>
        )}

        {workspace.timeline !== null ? (
          <AgentWorkspacePanel
            stages={workspace.stages}
            core={workspace.core}
            caption={agentCoreCaption(workspace.stages)}
            aside={
              /*
                By the validating stage the interesting question has changed
                from "what is happening" to "what did it touch", so the rail
                switches from the phase list to the record of files.
              */
              workspace.stage === "validate" ? (
                <AgentFileActivity events={workspace.fileEvents} />
              ) : (
                <AgentActivity
                  steps={workspace.timeline}
                  live={workspace.core === "working" || workspace.core === "waiting"}
                />
              )
            }
          >
            {workspace.stage === "validate" ? (
              <AgentValidationChecks checks={workspace.checks} />
            ) : (
              /*
                The Move, in its own stored words. Absent when the run cannot be
                followed back to one — a screen naming the wrong task would be
                worse than one naming none.
              */
              workspace.task !== null && <AgentTaskPanel task={workspace.task} compact />
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
              focus={focus}
              preparedCount={changes.length}
              planHref={planHref}
              agentHref={projectSectionHref(project.id, "agent")}
              productHref={projectSectionHref(project.id, "my-product")}
              executionHref={executionHref}
            />
          </AgentWorkspacePanel>
        )}

        {workspace.timeline === null && (
          /*
            The reference draws an estimated duration and an expected file
            range here. Neither has anything behind it — no estimator exists,
            and how many files a run touches is unknown until it has touched
            them. What is true before a run starts is where it happens and what
            it is working from, so the strip says that instead.
          */
          <AgentReadyFacts
            repository={project.repository?.fullName ?? null}
            liveUrl={project.productionUrl ?? null}
          />
        )}

        {workspace.stage === "preview" && change !== null && (
          <Surface level="section" padding="lg">
            <AgentPreviewStage
              images={change.reviewImages}
              changes={workspace.previewChanges}
              filesChanged={change.filePaths.length}
              reviewHref={`#${preparedChangeAnchorId(change.id)}`}
              filesHref={change.compareUrl ?? undefined}
            />
          </Surface>
        )}

        {workspace.stage === "review" && change !== null && (
          <Surface level="section" padding="lg">
            <AgentMergeStage
              summary={workspace.mergeSummary}
              files={change.filePaths.map((path) => ({ path }))}
              allChecksPassed={change.validation?.status === "passed"}
              branchName={change.branchName}
              baseBranch={change.baseBranch}
              commitSha={change.commitSha}
              compareUrl={change.compareUrl}
              reviewHref={`#${preparedChangeAnchorId(change.id)}`}
              canMerge={change.progress.approved}
            />
          </Surface>
        )}

        {change !== null && (
          <ChangeGates projectId={project.id} change={change} planHref={planHref} />
        )}

        {changes.length === 0 && workspace.timeline === null && (
          <EmptyState
            title="Nothing prepared yet"
            description="When you let Vibe act on one of your next moves, it appears here with its checks, its preview and your approval."
          />
        )}

      </div>
    </WorkspaceSection>
  );
}
