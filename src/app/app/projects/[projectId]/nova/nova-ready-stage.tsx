import { Suspense } from "react";
import { projectSectionHref } from "@/components/layout/project-shell";
import { AgentReadyStage } from "../agent/agent-ready-stage";
import { agentStartControls } from "../agent/agent-start-controls";
import type { AgentTask } from "../agent/agent-task-panel";
import { listMeasuredRunObservations } from "@/modules/coding-agent/measured-runs-store";
import { forecastRun } from "@/modules/coding-agent/run-forecast";
import {
  forecastDriverNotes,
  forecastEvidenceNote,
  runCeilingLabel,
} from "@/modules/coding-agent/view";
import {
  resolveAgentPlanRoutes,
  resolveRouteAgentEconomics,
} from "@/modules/coding-agent/website-preflight";
import { resolveBuildChain } from "@/modules/execution-contract/chain";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { requireProjectAccess } from "@/modules/projects/workspace-context";

/**
 * The offer to start a run, in Nova's thread.
 *
 * ## The objection this answers rather than overrides
 *
 * `execution_offered` was the one moment routed away from Home, and
 * `ELSEWHERE`'s docblock said exactly why: `startAgentRunAction` takes a step
 * key and a `chain` boolean, those are two pieces of work at two prices, and
 * *"offering one of them here would be offering half a decision at a price the
 * founder was not shown the alternative to."*
 *
 * That is a requirement, not a prohibition. `AgentReadyStage` is the screen
 * that shows both, and `AgentStartControls` is now one component instead of a
 * pair written out on the Agent page — so the thread cannot print a figure the
 * page would not.
 *
 * ## What it refuses to offer
 *
 * A run for a step that is not the agent's. `VIBE_EXECUTABLE_MODES` is
 * `deterministic` *and* `agentic`, so Nova's moment can be raised for either;
 * an agent run is what the second one means. For a deterministic step this
 * draws nothing, and the plan link the moment still carries is the way on. The
 * Agent route makes the same distinction, by filtering its resolution on
 * `mode === "agentic"`.
 *
 * ## What it costs, and why it streams
 *
 * `resolveAgentPlanRoutes` reads state and never the network — `read.ts` had to
 * correct that belief once already, and its docblock records it: *"reads state,
 * never the network: no live HEAD, no site crawl."* Five tables, the plan and
 * the snapshot. On top of that: the Move set, and this account's completed runs
 * for the forecast. Everything else — the chain, both ceilings, the forecast —
 * is pure over what those returned.
 *
 * It is a second resolution: Nova's own reading resolves the routes to answer
 * *whether* a step is offered and keeps only its order and title. Widening that
 * would put fields on `NovaFocusFacts`, which is the pure ranking layer and
 * uses none of them. So the block asks again, behind a `Suspense` boundary,
 * where Home's first paint cannot wait on it — the same arrangement the Agent
 * route uses for the same reason.
 *
 * ## The two notices it does not carry
 *
 * A stale repository read and an unanswered workspace choice are their own Nova
 * moments, and both outrank this one — `repository_read_outdated` is `blocked`
 * and `workspace_choice_required` is `decision`, against this one's `ready`. If
 * either is true, `execution_offered` is not the moment on screen, so a notice
 * about it here would be a second copy of a sentence the ranking already
 * decided to lead with.
 */
export function NovaReadyStage({ projectId }: { projectId: string }) {
  return (
    <Suspense fallback={null}>
      <NovaReadyStageBody projectId={projectId} />
    </Suspense>
  );
}

async function NovaReadyStageBody({ projectId }: { projectId: string }) {
  const { supabase, userId } = await requireProjectAccess(projectId);

  const routes = await resolveAgentPlanRoutes(supabase, { projectId, userId });
  if (!routes.available) return null;

  /*
   * The same step Nova's ranking raised: the lowest-ordered resolution Vibe
   * could carry out. Narrowed to `agentic` here, because that is the only one
   * this offer's control can start.
   */
  const resolution = [...routes.resolutions]
    .filter((entry) => entry.mode === "agentic")
    .sort((a, b) => a.stepOrder - b.stepOrder)[0];
  if (!resolution) return null;

  const step = routes.plan.steps.find((entry) => entry.order === resolution.stepOrder);
  if (!step) return null;

  const chain = resolveBuildChain({
    head: step,
    steps: routes.plan.steps,
    completed: routes.completedSteps,
    capabilityContext: { repository: routes.snapshot },
  });

  /* Two figures from one function with different member sets, so a button's
     number is the number that gets charged. */
  const stepEconomics = resolveRouteAgentEconomics({
    projectId,
    members: [step],
    headRiskClass: resolution.riskClass,
  });
  const chainEconomics =
    chain.members.length > 1
      ? resolveRouteAgentEconomics({
          projectId,
          members: chain.members,
          headRiskClass: resolution.riskClass,
        })
      : null;

  /*
   * A ceiling this offer cannot price is an offer with no price, and this
   * surface exists to carry one. Nothing is drawn rather than a control with a
   * figure missing beside it.
   */
  if (stepEconomics === null) return null;

  const [opportunities, observations] = await Promise.all([
    getLatestOpportunities(supabase, projectId),
    listMeasuredRunObservations(supabase),
  ]);

  const move =
    opportunities?.set.opportunities.find((entry) => entry.id === routes.plan.opportunityId) ?? null;

  const forecast = forecastRun({
    at: new Date(),
    step,
    riskClass: resolution.riskClass,
    snapshot: routes.snapshot,
    observations,
  });

  /*
   * The step the button would start, named — not just the Move it belongs to.
   * The Agent route's own reason: the control submits exactly one step key, and
   * a caption naming only the Move left a founder unable to tell which part of
   * a five-step plan was about to be built.
   */
  const task: AgentTask | null = move
    ? {
        title: move.title,
        problem: move.problem,
        whyNow: move.whyNow || null,
        impact: move.impact,
        effort: move.effort,
        lens: move.primaryLens,
        step: { order: step.order, title: step.title },
        steps: [
          ...routes.plan.steps
            .filter((entry) => resolution.absorbedPreparation.includes(entry.order))
            .map((entry) => ({ order: entry.order, title: entry.title, kind: "preparation" as const })),
          ...chain.members.map((entry) => ({
            order: entry.order,
            title: entry.title,
            kind: "delivery" as const,
          })),
        ]
          .sort((a, b) => a.order - b.order)
          .map((entry) => ({ title: entry.title, kind: entry.kind })),
      }
    : null;

  const ceiling = runCeilingLabel(stepEconomics.budget.maxCredits);

  /*
   * The same offer the plan page builds, from the same place — two nodes,
   * because only the primary control belongs inside the swept pill.
   */
  const controls = agentStartControls({
    projectId,
    step,
    chain,
    chainMaxCredits: chainEconomics?.budget.maxCredits ?? null,
    creditEstimate: ceiling,
    repositoryReadHref: projectSectionHref(projectId, "my-product"),
  });

  return (
    <AgentReadyStage
      presentation="block"
      task={task}
      planHref={projectSectionHref(projectId, "action-plan")}
      repository={null}
      liveUrl={null}
      caption=""
      creditEstimate={ceiling}
      forecastNotes={
        forecast ? [forecastEvidenceNote(forecast), ...forecastDriverNotes(forecast)] : undefined
      }
      startAction={controls.primary}
      startBeneath={controls.beneath ?? undefined}
    />
  );
}
