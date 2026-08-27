import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestActionPlan } from "@/modules/action-plans/service";
import { getExecutionSpecById } from "@/modules/execution-contract/store";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import type { AgentTask } from "@/app/app/projects/[projectId]/agent/agent-task-panel";
import { findLatestOperation } from "@/modules/operations/store";
import type { ValidationCheck } from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import type { PreviewChange } from "@/app/app/projects/[projectId]/agent/agent-preview-stage";
import type { MergeSummary } from "@/app/app/projects/[projectId]/agent/agent-merge-stage";
import type { StoredExecutionEvent } from "./observability/events";
import {
  agentCoreState,
  agentStageSteps,
  type AgentCoreState,
  type AgentStage,
  type AgentStageStep,
} from "./observability/agent-stages";
import { readAgentRunForLiveView } from "./observability/run-view";
import { listExecutionEvents } from "./observability/store";
import { buildExecutionTimeline, type TimelineStep } from "./observability/timeline";
import { getAgentExecutionStatus } from "./service";

/**
 * What the Agent route needs to draw itself (UI-19).
 *
 * ## One read, because the five stages are one story
 *
 * The stages span an agent run and the prepared change it produced. Asking for
 * those separately from the component tree is how two halves of one stepper end
 * up disagreeing — the run says finished while the change still says
 * unvalidated, and the screen shows both.
 *
 * ## What it costs when nothing has run
 *
 * One row. A project that has never started the agent has no operation, so
 * there is no live model to build and no change to look up, and the page
 * renders its idle state off a single miss. The expensive reads only happen for
 * a project that has something to show.
 */
export type AgentWorkspaceView = {
  stages: AgentStageStep[];
  core: AgentCoreState;
  /**
   * The run's six phases, or null until a run exists.
   *
   * Built here from the event log rather than by `buildAgentExecutionLiveModel`,
   * and that is not a preference. The live model also reads execution
   * economics out of `ai_usage_events` — Vibe's internal cost ledger, which the
   * customer role deliberately cannot select. Mounting the dogfood model on a
   * customer page made the whole route throw `42501 permission denied`, and the
   * fix is emphatically not a grant: what a run cost Vibe to produce is not a
   * founder's to read, and the page never displayed it anyway.
   */
  timeline: TimelineStep[] | null;
  /** The change this run produced, once it has produced one. */
  change: PreparedChangeWorkspaceItem | null;
  /**
   * The Move this run is working on, when it can be resolved from stored
   * records. Null rather than a placeholder — a screen naming the wrong task is
   * worse than one naming none.
   */
  task: AgentTask | null;
  /** Which of the five the run is sitting on, so the route picks one body. */
  stage: AgentStage | null;
  /** Events that touched a file, for the validating stage's record. */
  fileEvents: StoredExecutionEvent[];
  /** The sandbox's own steps, as rows. Empty when nothing has been validated. */
  checks: ValidationCheck[];
  /** Named changes for the preview rail. Empty when nothing describes them. */
  previewChanges: PreviewChange[];
  mergeSummary: MergeSummary;
};

export async function readAgentWorkspace(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    /**
     * The prepared changes the route already read. Passed in rather than read
     * again: the workspace read is the expensive one on this route, and paying
     * for it twice to answer one question about one change would be the cost
     * UI-2 split it apart to avoid.
     */
    changes: readonly PreparedChangeWorkspaceItem[];
  },
): Promise<AgentWorkspaceView> {
  const { projectId, userId, changes } = params;

  const stored = await findLatestOperation(supabase, {
    projectId,
    operationType: "agent_execution",
  });

  const idle = () => {
    const stages = agentStageSteps({ timeline: null, runStatus: null, changeProgress: null });
    return {
      stages,
      core: agentCoreState(stages),
      timeline: null,
      change: null,
      task: null,
      stage: null,
      fileEvents: [],
      checks: [],
      previewChanges: [],
      mergeSummary: { filesChanged: 0 },
    };
  };

  if (stored === null) return idle();

  /*
   * Delegated rather than rebuilt. This is the call that also repairs a run
   * whose workflow died holding Credits — a read is the right moment for that
   * because it is the moment somebody cares — and reassembling the view here
   * would quietly skip it.
   */
  const operation = await getAgentExecutionStatus(supabase, {
    projectId,
    userId,
    operationId: stored.id,
  });
  if (operation === null) return idle();

  const runId = operation.agentExecutionRunId;
  if (runId === null) return idle();

  const [runView, events] = await Promise.all([
    readAgentRunForLiveView(supabase, { runId, projectId }),
    listExecutionEvents(supabase, { runId, projectId }),
  ]);

  /*
   * Vibe's own counts, from Vibe's own record. `file_read` is what the harness
   * reported reading; the verified count is what Vibe confirmed it changed —
   * never the number of files the runtime touched, which is a different and
   * larger number, and run b33635a1 is why anybody knows that.
   */
  const filesInspected = events.filter((event) => event.type === "file_read").length;
  const filesChanged = runView?.run.changedFileCount ?? null;

  const timeline = buildExecutionTimeline({
    events,
    status: operation.status,
    candidateFileCount: filesChanged,
    filesInspected,
  });

  /*
   * `resultId` is the prepared change a completed run wrote. Matched by id
   * rather than by taking the newest change: a project can hold several, and
   * the stepper is about *this* run's change. Taking the newest would show a
   * founder the gates of a change their last run did not produce.
   */
  const change = operation.resultId
    ? (changes.find((candidate) => candidate.id === operation.resultId) ?? null)
    : null;

  /*
   * The Move this run is working on.
   *
   * Followed from the run's own execution spec rather than guessed from the
   * newest Move: a spec names the opportunity it was authorized against, and a
   * screen naming the wrong task is worse than one naming none. Every lookup
   * below returns null rather than a fallback for the same reason.
   */
  const task = await resolveTask(supabase, { projectId, runView });

  const stages = agentStageSteps({
    timeline,
    runStatus: operation.status,
    changeProgress: change?.progress ?? null,
    filesInspected,
    filesChanged,
  });

  /*
   * The stage a body is drawn for. `active` rather than "the furthest done",
   * because a paused or failed run must not be shown the body of a stage it
   * never reached.
   */
  const stage = stages.find((step) => step.state === "active")?.stage ?? null;

  /* Only events that actually named a file belong in the validating record. */
  const fileEvents = events.filter(
    (event) => typeof event.metadata.path === "string" || typeof event.metadata.file === "string",
  );

  return {
    stages,
    core: agentCoreState(stages),
    timeline,
    change,
    task,
    stage,
    fileEvents,
    checks: validationChecks(change),
    // Nothing stored describes a change in prose, so the preview rail carries
    // no invented summaries. The frames and the file list carry the answer.
    previewChanges: [],
    mergeSummary: {
      filesChanged: change?.filePaths.length ?? 0,
      tests: testVerdict(change),
      build: buildVerdict(change),
    },
  };
}


/** Impact and effort are already closed enums; this only narrows their type. */
const CHIP = ["high", "medium", "low"] as const;
type Chip = (typeof CHIP)[number];
const chip = (value: string): Chip => (CHIP.includes(value as Chip) ? (value as Chip) : "medium");

async function resolveTask(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    runView: Awaited<ReturnType<typeof readAgentRunForLiveView>>;
  },
): Promise<AgentTask | null> {
  const specId = params.runView?.executionSpecId;
  if (!specId) return null;

  const spec = await getExecutionSpecById(supabase, { projectId: params.projectId, specId });
  if (!spec) return null;

  const opportunities = await getLatestOpportunities(supabase, params.projectId);
  const move = opportunities?.set.opportunities.find((entry) => entry.id === spec.opportunityId);
  /*
   * The Move is gone from the current set — regenerated, most likely. The run
   * is still real and the rail still describes it; only the task's own words
   * are unavailable, and inventing them from the newest Move would put a
   * different problem's headline over this run.
   */
  if (!move) return null;

  const plan = await getLatestActionPlan(supabase, params.projectId);
  /*
   * Only this run's own plan. `getLatestActionPlan` answers "the newest", which
   * is a different question: a plan regenerated after the run started would
   * list steps this run was never given.
   */
  const steps =
    plan && plan.plan.id === spec.actionPlanId
      ? plan.plan.steps.map((step) => step.title)
      : [];

  return {
    title: move.title,
    problem: move.problem,
    whyNow: move.whyNow || null,
    impact: chip(move.impact),
    effort: chip(move.effort),
    lens: move.primaryLens,
    steps,
  };
}


/**
 * The sandbox's steps, as rows the screen can draw.
 *
 * `install`, `typecheck`, `test`, `build` are the steps the validator plans and
 * runs. The reference composition also drew "Linting" and "Security scan";
 * neither exists, and a tick beside a check nobody ran is the one thing a
 * safety screen must never show.
 */
const CHECK_ROWS: { step: string; name: string; detail: string }[] = [
  { step: "install", name: "Dependencies", detail: "Installing packages" },
  { step: "typecheck", name: "Type safety", detail: "Checking types" },
  { step: "test", name: "Tests", detail: "Running unit and integration tests" },
  { step: "build", name: "Production build", detail: "Building for production" },
];

function validationChecks(change: PreparedChangeWorkspaceItem | null): ValidationCheck[] {
  const status = change?.validation?.status ?? null;
  if (status === null) return [];

  /*
   * The card carries the run's overall status rather than its per-step results,
   * so every row reports that one verdict. A row claiming a step-level outcome
   * the card cannot see would be worse than a row that is honestly coarse.
   */
  const state: ValidationCheck["state"] =
    status === "passed" ? "passed" : status === "failed" ? "failed" : "running";

  return CHECK_ROWS.map((row) => ({ name: row.name, detail: row.detail, state }));
}

/**
 * The card carries the validation run's overall status, not per-step results,
 * so tests and build report the same verdict in their own vocabulary. Claiming
 * a step-level outcome nothing can see would be worse than being honestly
 * coarse.
 */
function testVerdict(change: PreparedChangeWorkspaceItem | null): MergeSummary["tests"] {
  const status = change?.validation?.status ?? null;
  if (status === "passed") return "passing";
  if (status === "failed") return "failing";
  return "not_run";
}

function buildVerdict(change: PreparedChangeWorkspaceItem | null): MergeSummary["build"] {
  const status = change?.validation?.status ?? null;
  if (status === "passed") return "successful";
  if (status === "failed") return "failed";
  return "not_run";
}
