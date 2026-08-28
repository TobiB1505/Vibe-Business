import {
  WorkspaceSection,
  projectSectionHref,
} from "@/components/layout/project-shell";
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
import { AgentTrustPanel } from "./agent-header";
import { ChangeGates } from "./change-gates";
import { AgentTaskPanel } from "./agent-task-panel";
import { AgentActivity } from "./agent-activity";
import { AgentValidationChecks } from "./agent-validation-checks";
import { AgentValidateAction } from "./agent-validate-action";
import { AgentReadyFacts } from "./agent-start-cta";
import { AgentQuestionPanel } from "./agent-question-panel";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { resolveAgentInterruptAction } from "./interrupt-actions";
import { AgentFileActivity } from "./agent-file-activity";
import { AgentMergeStage } from "./agent-merge-stage";
import { AgentPreviewStage } from "./agent-preview-stage";
import { AgentWorkspacePanel } from "./agent-workspace-panel";
import { AgentCore } from "./agent-core";
import { AgentBuildStage } from "./agent-build-stage";
import { AgentValidateStage } from "./agent-validate-stage";

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

  const [changes, profile, repositorySnapshot, opportunities] =
    await Promise.all([
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
    ? (opportunities?.set.opportunities.find(
        (entry) => entry.id === requestedOpportunityId,
      ) ?? null)
    : null;

  const focusAction = focusedMove
    ? await (async () => {
        const [summaries, activeOperation, failedOperation] = await Promise.all(
          [
            getOpportunityExecutionSummaries(supabase, projectId),
            getActivePreparationFor(supabase, {
              projectId,
              opportunityId: focusedMove.id,
            }),
            getLatestFailedPreparationFor(supabase, {
              projectId,
              opportunityId: focusedMove.id,
            }),
          ],
        );

        const summary = summaries.find(
          (entry) => entry.opportunityId === focusedMove.id,
        );
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
    hasRepositoryUnderstanding:
      project.repository !== null && Boolean(repositorySnapshot?.result),
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

  /* Whether anything is actually happening. The orb turns for this and
     nothing else — a settled run gets no orb at all. */
  const live = workspace.core === "working" || workspace.core === "waiting";

  return (
    <WorkspaceSection
      id="agent"
      title="Agent"
      description={
        workspace.timeline === null
          ? "Vibe can work on your product and prepare changes for your review."
          : "Vibe is working on your task and preparing changes for your review."
      }
      actions={<AgentTrustPanel />}
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
                This run stopped before the current question format existed, so
                it cannot be answered here. Starting a fresh attempt is the way
                forward.
              </Notice>
            )}
          </AgentQuestionPanel>
        )}

        {/*
          One panel, five bodies, all rendered here and switched on the client.
          The founder is looking at one run from five angles rather than
          navigating between five pages, and every angle is already paid for by
          the read above.
        */}
        <AgentWorkspacePanel
          stages={workspace.stages}
          initialStage={
            workspace.stage ?? (workspace.timeline === null ? null : "review")
          }
          /*
            What Vibe is working on, above the rail and on every stage. It used
            to sit inside the Understand body, so it disappeared the moment the
            founder looked at any other stage — five steps with no statement of
            what they were steps toward.
          */
          header={
            workspace.task !== null ? (
              <AgentTaskPanel task={workspace.task} compact />
            ) : undefined
          }
          bodies={{
            /*
              The ready state, and the way back to it. A founder whose last run
              is finished can start the next one from here — before this, the
              readiness card appeared only for a project that had never run at
              all, so the one control that begins work disappeared the moment
              it was first used.
            */
            understand: (
              <div className="flex flex-col gap-6">
                <AgentPanel
                  context={context}
                  focus={focus}
                  preparedCount={changes.length}
                  planHref={planHref}
                  agentHref={projectSectionHref(project.id, "agent")}
                  productHref={projectSectionHref(project.id, "my-product")}
                  executionHref={executionHref}
                />
                {/*
                  What is true before a run starts: where it happens and what
                  it is working from. The reference draws an estimated duration
                  and a file range here; neither has an estimator behind it.
                */}
                <AgentReadyFacts
                  repository={project.repository?.fullName ?? null}
                  liveUrl={project.productionUrl ?? null}
                />
              </div>
            ),
            build: <AgentBuildStage task={workspace.task} live={live} />,
            /*
              Two columns, so the stage reads as the reference draws it: what is
              being checked, beside the checks themselves, with the run's own
              activity in the aside. The checks alone were a list of shields
              with no sentence saying what they were for.
            */
            validate: (
              <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
                <AgentValidateStage running={live} />
                <div className="flex min-w-0 flex-col gap-5">
                  <AgentValidationChecks checks={workspace.checks} />
                  {change !== null && (
                    <AgentValidateAction
                      projectId={project.id}
                      preparedChangeId={change.id}
                      label={
                        change.validation === null
                          ? "Run the checks"
                          : "Validate again"
                      }
                    />
                  )}
                </div>
              </div>
            ),
            preview:
              change === null ? undefined : (
                <div className="flex min-w-0 flex-col gap-6">
                  <AgentPreviewStage
                    images={change.reviewImages}
                    changes={workspace.previewChanges}
                    filesChanged={change.filePaths.length}
                    filesHref={change.compareUrl ?? undefined}
                  />
                  {/*
                    The controls that produce what the frames above are missing.
                    Without a capture the stage is two empty rectangles, and the
                    button that fills them used to sit far below under the old
                    section — which is why the preview appeared to do nothing.
                  */}
                  <ChangeGates
                    projectId={project.id}
                    change={change}
                    planHref={planHref}
                    stage="preview"
                    chrome={false}
                  />
                </div>
              ),
            review:
              change === null ? undefined : (
                <div className="flex min-w-0 flex-col gap-6">
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
                  {/*
                    The decision, and the change's own record. This is the last
                    stage, so the approval, the merge and what the change did in
                    production belong here rather than in a second section below
                    the panel — which is what that section was, and why the
                    screen said everything twice.
                  */}
                  <ChangeGates
                    projectId={project.id}
                    change={change}
                    planHref={planHref}
                    stage="review"
                  />
                </div>
              ),
          }}
          asides={{
            /*
              The orb has exactly two moments, and they are the two the
              reference gives it: the hero before a run, and the run itself. A
              finished merge gets none — it had been appearing beside one,
              saying "Vibe is preparing what you need in order to decide".
            */
            understand:
              workspace.core === "idle" ? (
                <AgentCore
                  state="idle"
                  headline="Vibe is ready to work"
                  caption={agentCoreCaption(workspace.stages)}
                  size="hero"
                />
              ) : undefined,
            build: (
              <div className="flex flex-col items-center gap-6">
                {live && (
                  <AgentCore
                    state={workspace.core}
                    caption={agentCoreCaption(workspace.stages)}
                    size="compact"
                  />
                )}
                {workspace.timeline !== null && (
                  <AgentActivity steps={workspace.timeline} live={live} />
                )}
              </div>
            ),
            /*
              Each stage reports its own kind of progress. Build shows what the
              agent did — files, commands, searches. Validate shows the checks'
              own run, not the agent's, which is what made the old panel read as
              the wrong activity under the right heading.
            */
            validate:
              workspace.fileEvents.length > 0 ? (
                <AgentFileActivity
                  events={workspace.fileEvents}
                  title="Validation activity"
                />
              ) : undefined,
          }}
        />

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
