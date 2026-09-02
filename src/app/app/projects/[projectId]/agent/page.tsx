import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SkeletonSection } from "@/components/ui/skeleton";
import {
  WorkspaceSection,
  preparedChangeAnchorId,
  projectSectionHref,
} from "@/components/layout/project-shell";
import { Notice } from "@/components/ui/states";
import {
  AGENT_CHANGE_PARAM,
  PLAN_OPPORTUNITY_PARAM,
  planMoveHref,
  sanitizeRequestedChangeId,
  sanitizeRequestedOpportunityId,
} from "@/modules/action-plans/source";
import {
  getActivePreparationFor,
  getLatestFailedPreparationFor,
  getOpportunityExecutionSummaries,
} from "@/modules/execution/service";
import { buildOpportunityActionState } from "@/modules/execution/view";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { buildAgentFocus } from "@/modules/projects/agent-focus";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { readAgentWorkspace } from "@/modules/coding-agent/agent-workspace";
import {
  resolveDogfoodPlanRoutes,
  resolveRouteAgentEconomics,
} from "@/modules/coding-agent/website-preflight";
import {
  agentCoreCaption,
  agentCoreState,
  agentStageSteps,
} from "@/modules/coding-agent/observability/agent-stages";
import { AgentTrustPanel } from "./agent-header";
import type { AgentTask } from "./agent-task-panel";
import { AgentActivity } from "./agent-activity";
import { AgentValidationChecks } from "./agent-validation-checks";
import { AgentValidateAction } from "./agent-validate-action";
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
import { AgentReadyStage } from "./agent-ready-stage";
import { AgentRunTaskHeader } from "./agent-run-task-header";
import { AgentPreviewActions, AgentReviewDecision } from "./agent-stage-actions";
import { AgentStartAction } from "./agent-start-action";
import { formatCreditsForDisplay } from "@/modules/credits/units";
import { forecastRun } from "@/modules/coding-agent/run-forecast";
import { forecastDriverNotes, forecastEvidenceNote } from "@/modules/coding-agent/view";

/**
 * The customer-facing Agent workspace.
 *
 * One Move is the task, one agent run is the work, and that run's exact
 * prepared change supplies validation, preview, review, approval and merge.
 * The route never assembles the project's historical changes: resolving the
 * result id on the durable operation keeps the hot path bounded to the object
 * the founder is actually looking at.
 *
 * `?plan=` is an address, never authority. It is bounded before use. When it
 * matches the immutable task already bound to this run, that persisted binding
 * is sufficient and no second Action Plan read is paid. A different requested
 * Move is resolved against the project's current set and uses the same
 * execution answer as the Action Plan.
 *
 * The gate order remains service-owned. Navigation changes only which view of
 * the run is visible; it cannot make validation pass, create an approval or
 * authorize a merge.
 */
export default async function ProjectAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    [PLAN_OPPORTUNITY_PARAM]?: string;
    [AGENT_CHANGE_PARAM]?: string;
  }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);
  const resolvedSearchParams = await searchParams;

  /*
   * The section header reaches the browser before the workspace does (VB-023,
   * B15).
   *
   * `readAgentWorkspace` resolves the run's own prepared change, and building
   * that card can sign review images and run a read-only merge preflight
   * against GitHub. Awaiting it in the route body means the whole screen —
   * header, trust panel, chrome — waits on a network round trip to somebody
   * else's API. It streams instead, and `workspace-routes.test.ts` holds the
   * boundary in place.
   *
   * The description is one sentence for every state, because it renders before
   * the state is known. A header that first said "Vibe can work on your
   * product" and then swapped to "Vibe is working on your task" would be a
   * false status line arriving one tick early. It lives in
   * `WORKSPACE_SECTION_HEADINGS` now, which is what stops the same sentence
   * from arriving twice in two different wordings.
   */
  return (
    <WorkspaceSection id="agent" actions={<AgentTrustPanel />}>
      <Suspense fallback={<SkeletonSection />}>
        <AgentWorkspaceBody
          supabase={supabase}
          project={project}
          userId={userId}
          resolvedSearchParams={resolvedSearchParams}
        />
      </Suspense>
    </WorkspaceSection>
  );
}

/**
 * Everything the Agent screen shows once its workspace is known.
 *
 * A separate component only so the boundary above has something to suspend on:
 * an `await` in the route body would block the whole page again, however it
 * were written. Nothing here decides anything the route used to decide — the
 * read model does, exactly as it did when the route awaited it directly.
 */
async function AgentWorkspaceBody({
  supabase,
  project,
  userId,
  resolvedSearchParams,
}: {
  supabase: SupabaseClient;
  project: Awaited<ReturnType<typeof requireProjectAccess>>["project"];
  userId: string;
  resolvedSearchParams: {
    [PLAN_OPPORTUNITY_PARAM]?: string;
    [AGENT_CHANGE_PARAM]?: string;
  };
}) {
  const projectId = project.id;

  // Untrusted, and never used as a lookup until it has been bounded. It becomes
  // a focus only by matching a Move this project's own set contains.
  const requestedOpportunityId = sanitizeRequestedOpportunityId(
    resolvedSearchParams[PLAN_OPPORTUNITY_PARAM],
  );
  const requestedPreparedChangeId = sanitizeRequestedChangeId(
    resolvedSearchParams[AGENT_CHANGE_PARAM],
  );

  /*
   * One run, one result. The workspace now resolves only the prepared change
   * named by that run instead of assembling every historical change and then
   * discarding all but one. This is the route's critical loading path.
   */
  const workspace = await readAgentWorkspace(supabase, {
    projectId: project.id,
    userId,
    repositoryFullName: project.repository?.fullName ?? null,
    selectedPreparedChangeId: requestedPreparedChangeId,
  });

  /*
   * The normal handoff carries the Move that the durable run already names.
   * Trust that project-scoped immutable binding instead of loading the entire
   * Action Plan and three execution summaries again on every stage refresh.
   * A different requested Move still goes through the full current-set check.
   */
  const requestedTaskMatchesRun =
    requestedOpportunityId !== null &&
    workspace.task !== null &&
    requestedOpportunityId === workspace.taskOpportunityId;

  const opportunities =
    requestedOpportunityId && !requestedTaskMatchesRun
      ? await getLatestOpportunities(supabase, projectId)
      : null;

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
  const focusedMove =
    requestedOpportunityId && !requestedTaskMatchesRun
      ? (opportunities?.set.opportunities.find(
          (entry) => entry.id === requestedOpportunityId,
        ) ?? null)
      : null;

  const focusedMoveOwnsReadyView =
    focusedMove !== null && focusedMove.id !== workspace.taskOpportunityId;

  /*
   * A founder may inspect a different Move while an older run remains the
   * project's latest. That old run must not masquerade as work on the selected
   * Move. Keep the task-ready view and leave its later stages empty until this
   * Move owns a run or an exact prepared artifact.
   */
  const readyStages = focusedMoveOwnsReadyView
    ? agentStageSteps({ timeline: null, runStatus: null, changeProgress: null })
    : workspace.stages;
  const displayedWorkspace = focusedMoveOwnsReadyView
    ? {
        ...workspace,
        stages: readyStages,
        core: agentCoreState(readyStages, false),
        timeline: null,
        change: null,
        stage: null,
        fileEvents: [],
        checks: [],
        previewChanges: [],
        mergeSummary: { filesChanged: 0 },
        interrupt: null,
        founderInput: null,
      }
    : workspace;

  const basePlanHref: string = projectSectionHref(project.id, "action-plan");
  const taskOpportunityId = focusedMove?.id ?? workspace.taskOpportunityId;
  const planHref = taskOpportunityId
    ? planMoveHref(basePlanHref, taskOpportunityId)
    : basePlanHref;

  /* One binding, so the gate panels below read as one change rather than as
     seven reaches into the workspace view. */
  const change = displayedWorkspace.change;

  /*
   * Before a run exists, `workspace.task` is correctly null: no execution spec
   * has bound a task yet. A founder who arrived from one named Move has still
   * supplied an honest task for the ready hero, so use that Move's own fields
   * without pretending its plan steps were already bound to a run.
   */
  const readyTask: AgentTask | null = focusedMove
    ? {
        title: focusedMove.title,
        problem: focusedMove.problem,
        whyNow: focusedMove.whyNow || null,
        impact: focusedMove.impact,
        effort: focusedMove.effort,
        lens: focusedMove.primaryLens,
        // No run is bound yet, so no step is either. `readyStageTask` below
        // names the one the button would start, once the route has resolved it.
        step: null,
        steps: [],
      }
    : displayedWorkspace.task;
  const agentWorking =
    displayedWorkspace.core === "working" || displayedWorkspace.core === "waiting";

  /*
   * Agent economics are intentionally still allowlist-only. The ready screen
   * may be carrying the task from the run/change binding rather than from a
   * newly focused Move, so key admission to the exact displayed task instead
   * of to `focusedMove` alone. That was the defect behind the stale "Open
   * Action Plan" fallback even though the task was already on screen.
   *
   * This read stays off the hot path while a run is active. The server action
   * repeats the complete preflight on click, so this render remains
   * discoverability, never admission.
   */
  /* The focus answer and start discoverability are independent. Keep them in
     one parallel read window so restoring the real start control does not
     reintroduce the old serial Agent-page latency. */
  const [focusAction, agentRoutes] = await Promise.all([
    focusedMove
      ? (async () => {
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
      : Promise.resolve(null),
    readyTask !== null &&
    taskOpportunityId !== null &&
    !agentWorking
      ? resolveDogfoodPlanRoutes(supabase, { projectId, userId })
      : Promise.resolve(null),
  ]);

  const focus = requestedTaskMatchesRun
    ? null
    : buildAgentFocus({
        requestedOpportunityId,
        opportunities: opportunities?.set.opportunities ?? [],
        action: focusAction,
      });
  const agenticResolution =
    agentRoutes?.available && agentRoutes.plan.opportunityId === taskOpportunityId
      ? agentRoutes.resolutions.find((resolution) => resolution.mode === "agentic")
      : null;
  const agenticStep =
    agentRoutes?.available && agenticResolution
      ? (agentRoutes.plan.steps.find(
          (step) => step.order === agenticResolution.stepOrder,
        ) ?? null)
      : null;
  /*
   * The ceiling for the step that would actually run (launch-v1).
   *
   * Resolved here rather than carried on the route set, because the Agent price
   * is per execution pricing class and the class is a property of this step —
   * see `resolveRouteAgentEconomics`.
   */
  const routeEconomics =
    agenticStep && agenticResolution
      ? resolveRouteAgentEconomics({
          projectId,
          step: agenticStep,
          riskClass: agenticResolution.riskClass,
        })
      : null;
  /*
   * The ready hero names the step the button would start, not just the Move.
   *
   * `agenticStep` is what `AgentStartAction` submits, and until this existed
   * the caption said "Run this Move here" over a button that starts exactly one
   * step — silently the first agentic one in the plan. The founder could not
   * tell which.
   */
  const readyStageTask: AgentTask | null =
    readyTask && agenticStep && agenticResolution
      ? {
          ...readyTask,
          step: { order: agenticStep.order, title: agenticStep.title },
          steps: [
            ...(agentRoutes?.available ? agentRoutes.plan.steps : [])
              .filter((step) => agenticResolution.absorbedPreparation.includes(step.order))
              .map((step) => ({ order: step.order, title: step.title })),
            { order: agenticStep.order, title: agenticStep.title },
          ]
            .sort((a, b) => a.order - b.order)
            .map((entry) => entry.title),
        }
      : readyTask;

  const creditEstimate = routeEconomics
    ? formatCreditsForDisplay(routeEconomics.budget.maxCredits)
    : null;

  /*
   * What stands behind that ceiling (ADR 0072).
   *
   * Free and offline: pure over the static run history plus the snapshot the
   * route resolver already read. It produces no money and no second number —
   * the ceiling is the figure, and this says how much evidence is under it and
   * what about this run pushes toward the top of it.
   */
  const runForecast =
    agenticStep && agenticResolution
      ? forecastRun({
          at: new Date(),
          step: agenticStep,
          riskClass: agenticResolution.riskClass,
          snapshot: agentRoutes?.available ? agentRoutes.snapshot : null,
        })
      : null;

  /* Whether anything is actually happening. The orb turns for this and
     nothing else — a settled run gets no orb at all. */
  const live = agentWorking;

  return (
    <div className="flex flex-col gap-5">
        {/*
          A run that stopped to ask something makes the question the only
          primary object on the screen, above the stages. It is the one state
          where the founder is the blocker.
        */}
        {displayedWorkspace.interrupt !== null && (
          <AgentQuestionPanel interrupt={displayedWorkspace.interrupt}>
            {displayedWorkspace.founderInput !== null ? (
              <FounderInputCard
                projectId={project.id}
                request={displayedWorkspace.founderInput}
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
        <div
          id={change === null ? undefined : preparedChangeAnchorId(change.id)}
          data-prepared-change-id={change?.id}
          data-testid={change === null ? undefined : "prepared-change"}
          className="scroll-mt-24"
        >
          <AgentWorkspacePanel
            stages={displayedWorkspace.stages}
            initialStage={displayedWorkspace.stage}
            /*
              The compact task identity used by the three decision stages. Ready
              and Build carry the same task inside their own target composition.
            */
            header={
              <AgentRunTaskHeader
                task={displayedWorkspace.task}
                stage={
                  displayedWorkspace.stage === null
                    ? "Run settled"
                    : (displayedWorkspace.stages.find(
                        (step) => step.stage === displayedWorkspace.stage,
                      )?.label ?? "Current run")
                }
                filesChanged={change === null ? null : change.filePaths.length}
              />
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
              <AgentReadyStage
                task={readyStageTask}
                planHref={planHref}
                repository={project.repository?.fullName ?? null}
                liveUrl={project.productionUrl ?? null}
                startAction={
                  agenticStep ? (
                    <AgentStartAction
                      projectId={project.id}
                      stepKey={agenticStep.id}
                      /* Where a stale-code refusal sends the founder. Built here,
                         never in the panel — the panel does not know what the
                         workspace's segments are called. */
                      repositoryReadHref={projectSectionHref(project.id, "my-product")}
                    />
                  ) : undefined
                }
                creditEstimate={creditEstimate}
                forecastNotes={
                  runForecast
                    ? [forecastEvidenceNote(runForecast), ...forecastDriverNotes(runForecast)]
                    : undefined
                }
                caption={
                  (requestedTaskMatchesRun && change !== null) ||
                  (focus?.kind === "focused" && focus.action.kind === "already_prepared")
                    ? "This Move already has a prepared change. Review its checks, preview and approval here."
                    : agenticStep
                      ? `Run step ${String(agenticStep.order).padStart(2, "0")} of this Move here. Vibe carries that one step through a secure, reviewable flow.`
                      : readyTask
                        ? "This Move is selected, but an Agent run is not currently available for it."
                        : "Choose a Move from your Action Plan, then return here to run it with Vibe."
                }
              />
            ),
            build: (
              <AgentBuildStage
                task={displayedWorkspace.task}
                live={live}
                core={
                  <AgentCore
                    state={displayedWorkspace.core}
                    headline={live ? "Vibe is building your change" : "The build stage is complete"}
                    caption={agentCoreCaption(displayedWorkspace.stages)}
                    size="compact"
                  />
                }
                activity={
                  displayedWorkspace.fileEvents.length > 0 ? (
                    <AgentFileActivity
                      events={displayedWorkspace.fileEvents}
                      title="Live activity"
                      live={live}
                    />
                  ) : displayedWorkspace.timeline === null ? (
                    <Notice tone="info" label="Live activity">
                      Activity appears here when the run starts.
                    </Notice>
                  ) : (
                    <AgentActivity
                      steps={displayedWorkspace.timeline}
                      title="Agent progress"
                      live={live}
                    />
                  )
                }
              />
            ),
            /* What is being checked, the checks, and the run's own activity —
               the target's three-column validation workspace. */
            validate: (
              <AgentValidateStage
                running={live}
                checks={
                  displayedWorkspace.checks.length > 0 ? (
                    <AgentValidationChecks checks={displayedWorkspace.checks} />
                  ) : (
                    <Notice tone="info" label="Validation checks">
                      Checks appear here when a prepared change reaches validation.
                    </Notice>
                  )
                }
                action={
                  change !== null ? (
                    <AgentValidateAction
                      projectId={project.id}
                      preparedChangeId={change.id}
                      rerun={change.validation !== null}
                      label={
                        change.validation === null
                          ? "Run the checks"
                          : "Validate again"
                      }
                    />
                  ) : undefined
                }
              />
            ),
            preview:
              change === null ? undefined : (
                <div className="flex min-w-0 flex-col gap-6">
                  <AgentPreviewStage
                    images={change.reviewImages}
                    changes={displayedWorkspace.previewChanges}
                    filesChanged={change.filePaths.length}
                    /* Counted at preparation time, from both sides of every
                       file. Absent when the change could not be measured
                       whole — shown as nothing, never as zero. */
                    linesAdded={change.lineStats?.added}
                    linesRemoved={change.lineStats?.removed}
                    filesHref={change.compareUrl ?? undefined}
                    reviewReady={change.review.state === "ready"}
                    actions={<AgentPreviewActions projectId={project.id} change={change} />}
                  />
                </div>
              ),
            review:
              change === null ? undefined : (
                <div className="flex min-w-0 flex-col gap-6">
                  <AgentMergeStage
                    summary={displayedWorkspace.mergeSummary}
                    files={change.files.map((file) => ({
                      path: file.path,
                      ...(file.linesAdded !== null && file.linesRemoved !== null
                        ? { added: file.linesAdded, removed: file.linesRemoved }
                        : {}),
                    }))}
                    allChecksPassed={change.validation?.status === "passed"}
                    branchName={change.branchName}
                    baseBranch={change.baseBranch}
                    commitSha={change.commitSha}
                    compareUrl={change.compareUrl}
                    backHref={planHref}
                    decision={<AgentReviewDecision projectId={project.id} change={change} />}
                    canMerge={change.merge.state === "ready"}
                  />
                </div>
              ),
            }}
          />
      </div>
    </div>
  );
}
