import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getExecutionSpecById } from "@/modules/execution-contract/store";
import { chainedDeliveriesOf } from "@/modules/execution-contract/spec";
import {
  getPreparedChangeWorkspaceItem,
  type PreparedChangeWorkspaceItem,
} from "@/modules/execution/workspace";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import type { AgentTask } from "@/app/app/projects/[projectId]/agent/agent-task-panel";
import { findLatestOperation } from "@/modules/operations/store";
import type { ValidationCheck } from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import type { PreviewChange } from "@/app/app/projects/[projectId]/agent/agent-preview-stage";
import type { MergeSummary } from "@/app/app/projects/[projectId]/agent/agent-merge-stage";
import type { StoredExecutionEvent } from "./observability/events";
import type { StoredExecutionInterrupt } from "./store";
import {
  agentCoreState,
  agentStageSteps,
  type AgentCoreState,
  type AgentStage,
  type AgentStageStep,
} from "./observability/agent-stages";
import { readAgentRunForLiveView } from "./observability/run-view";
import { listExecutionEvents } from "./observability/store";
import { findOpenInterruptForRun } from "./store";
import { getFounderInputRequestForInterrupt } from "@/modules/founder-input/store";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import { type TimelineStep } from "./observability/timeline";
import { runObservationFrom, type LiveFile } from "./observability/live-view";
import type { ValidationPhaseView, ValidationSummary } from "@/modules/validation/view";
import { findReservationForOperation } from "@/modules/credits/store";
import type { ChangeCost } from "@/components/system/cost-line";
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
  /** The Move id named by the run's own execution spec, for the return link. */
  taskOpportunityId: string | null;
  /** Which of the five the run is sitting on, so the route picks one body. */
  stage: AgentStage | null;
  /** The Agent's stored event record, shown beside the working Build stage. */
  fileEvents: StoredExecutionEvent[];
  /**
   * What the run is doing right now, in its own words, or null between
   * actions. Observed rather than narrated — it comes from the last event the
   * harness reported, so it cannot claim work that produced no event.
   */
  currentAction: string | null;
  /**
   * Every file this run touched, deduplicated, with what happened to it.
   *
   * `withheldBy` names the policy that kept a path out of the change rather
   * than dropping it silently — a file the agent tried to write and was
   * refused is a fact about the run, and a founder reading a change is owed
   * the difference between "not touched" and "not allowed".
   */
  files: readonly LiveFile[];
  /** The sandbox's own steps, as rows. Empty when nothing has been validated. */
  checks: ValidationCheck[];
  /**
   * How much of the profile ran, and why.
   *
   * Carried alongside the checks because the two only mean anything together:
   * a list with three of seven rows skipped invites "why did you not check
   * that?", and the depth is the answer. Null for a run validated before depth
   * existed — those ran everything, and labelling them now would be
   * relabelling history.
   */
  validationDepth: ValidationSummary["depth"];
  /** What this run cost, once the hold it ran against has settled. */
  cost: ChangeCost;
  /** Named changes for the preview rail. Empty when nothing describes them. */
  previewChanges: PreviewChange[];
  mergeSummary: MergeSummary;
  /**
   * The question the run stopped on, when one is open.
   *
   * Read only for a paused run: a closed interrupt is history, and a screen
   * showing an answered question as if it were still waiting would be the same
   * class of lie as a stage that keeps ticking after a run has stopped.
   */
  interrupt: StoredExecutionInterrupt | null;
  /**
   * The answerable form of that question, when one exists.
   *
   * Founder Input Resolution is the canonical path — `answerExecutionInterrupt`
   * in the store predates it and has no caller. Null when the interrupt has no
   * request behind it, which is an older execution the current contract cannot
   * answer.
   */
  founderInput: FounderInputRequest | null;
};

export async function readAgentWorkspace(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    repositoryFullName: string | null;
    /** Exact artifact named by the Agent URL, after bounded parsing. */
    selectedPreparedChangeId: string | null;
  },
): Promise<AgentWorkspaceView> {
  const { projectId, userId, repositoryFullName, selectedPreparedChangeId } =
    params;

  const [stored, selectedChange] = await Promise.all([
    findLatestOperation(supabase, {
      projectId,
      operationType: "agent_execution",
    }),
    selectedPreparedChangeId
      ? getPreparedChangeWorkspaceItem(supabase, {
          projectId,
          userId,
          repositoryFullName,
          preparedChangeId: selectedPreparedChangeId,
        })
      : Promise.resolve(null),
  ]);

  const idle = (change: PreparedChangeWorkspaceItem | null = null): AgentWorkspaceView => {
    const stages = agentStageSteps({
      timeline: null,
      runStatus: null,
      changeProgress: change?.progress ?? null,
    });
    const task = taskFromChange(change);
    return {
      stages,
      core: agentCoreState(stages, false),
      timeline: null,
      change,
      task,
      taskOpportunityId: change?.opportunityId ?? null,
      stage: stageForWorkspace(stages, change),
      fileEvents: [],
      currentAction: null,
      files: [],
      checks: validationChecks(change),
      validationDepth: change?.validation?.depth ?? null,
      cost: { kind: "unknown" },
      previewChanges: [],
      mergeSummary: mergeSummaryFor(change),
      interrupt: null,
      founderInput: null,
    };
  };

  if (stored === null) return idle(selectedChange);

  /*
   * A selected deterministic or historical artifact must never inherit the
   * activity and task of the latest unrelated agent run. Its own stored Move
   * origin and gate state are the complete, truthful workspace in that case.
   */
  if (selectedChange !== null && stored.resultId !== selectedChange.id) {
    return idle(selectedChange);
  }

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
  if (operation === null) return idle(selectedChange);

  const runId = operation.agentExecutionRunId;
  if (runId === null) return idle(selectedChange);

  const [runView, events, interrupt, change, reservation] = await Promise.all([
    readAgentRunForLiveView(supabase, { runId, projectId }),
    listExecutionEvents(supabase, { runId, projectId }),
    /*
     * Only asked for a run that actually stopped. A closed interrupt is
     * history, and one read per page load for a question that cannot be open
     * is a cost with no answer behind it.
     */
    operation.status === "needs_user"
      ? findOpenInterruptForRun(supabase, { projectId, agentExecutionRunId: runId })
      : Promise.resolve(null),
    selectedChange !== null
      ? Promise.resolve(selectedChange)
      : operation.resultId
        ? getPreparedChangeWorkspaceItem(supabase, {
            projectId,
            userId,
            repositoryFullName,
            preparedChangeId: operation.resultId,
          })
        : Promise.resolve(null),
    /*
     * What the run cost, from the hold it was charged against (audit R23).
     *
     * One read, keyed on the operation — the reservation is where the money
     * went, and nothing joined it to the change, so a merged change could not
     * say what it cost. Read for every run rather than only merged ones: a
     * release is as much an answer as a charge, and a founder whose run was
     * refunded should be told rather than left assuming the reserved figure
     * was taken.
     */
    findReservationForOperation(supabase, { operationRunId: stored.id, projectId }),
  ]);

  /*
   * One derivation of the run, shared with the operator's view (audit C7).
   *
   * This built its own timeline because the full live model reads execution
   * economics out of `ai_usage_events`, which the customer role cannot select
   * — so mounting it here threw `42501`. The split makes that unnecessary:
   * `runObservationFrom` touches no usage ledger and carries no USD, and the
   * two screens now order events and count files by the same rules instead of
   * by two hand-kept copies of them.
   */
  const observation = runObservationFrom(events, {
    operation,
    projectId,
    run: runView?.run ?? null,
  });
  const timeline = observation.timeline;

  /*
   * `settled` carries the number the account was actually charged; `released`
   * says the hold came back. A run with no reservation was free, and `unknown`
   * renders nothing rather than inventing a zero (ADR 0094's rule, in the
   * other direction).
   */
  const cost: ChangeCost =
    reservation === null
      ? { kind: "unknown" }
      : reservation.status === "settled" && reservation.settledCredits !== null
        ? { kind: "settled", credits: reservation.settledCredits }
        : reservation.status === "released" || reservation.status === "expired"
          ? { kind: "released" }
          : { kind: "pending" };

  /*
   * `file_read` is what the harness reported reading; the changed count is
   * what Vibe confirmed it changed — never the number of files the runtime
   * touched, which is a different and larger number, and run b33635a1 is why
   * anybody knows that. Both come from the shared observation now.
   */
  const filesInspected = observation.metrics.filesRead;
  const filesChanged = runView?.run.changedFileCount ?? null;

  /*
   * The Move this run is working on.
   *
   * Followed from the run's own execution spec rather than guessed from the
   * newest Move: a spec names the opportunity it was authorized against, and a
   * screen naming the wrong task is worse than one naming none. Every lookup
   * below returns null rather than a fallback for the same reason.
   */
  /*
   * The task and the open question are independent, and both are independent of
   * the change lookup above. Sequenced, they were the slowest part of a page
   * that a founder reloads while waiting for a run.
   */
  const [resolvedTask, founderInput] = await Promise.all([
    resolveTask(supabase, { projectId, runView }),
    interrupt
      ? getFounderInputRequestForInterrupt(supabase, {
          projectId,
          executionInterruptId: interrupt.id,
        })
      : Promise.resolve(null),
  ]);

  let task = resolvedTask.task;
  let taskOpportunityId = resolvedTask.opportunityId;

  /*
   * The change's own stored origin, when the Move it came from is no longer in
   * the current set — regenerated, most likely.
   *
   * It carries the same three fields the panel wants and it was captured with
   * the change, so it says what the run was actually working on rather than
   * what the newest Move happens to be. Without it the column beside the orb
   * was simply empty on screen, which reads as broken rather than as absent.
   */
  if (task === null && change?.origin) {
    task = {
      title: change.origin.title,
      problem: change.origin.problem,
      whyNow: change.origin.whyNow || null,
      impact: null,
      effort: null,
      lens: null,
      // The stored origin is the Move's, not a step's. Naming no step is the
      // honest answer; inventing one from the newest plan would not be.
      step: null,
      steps: [],
    };
    taskOpportunityId = change.opportunityId;
  }

  const stages = agentStageSteps({
    timeline,
    runStatus: operation.status,
    changeProgress: change?.progress ?? null,
    filesInspected,
    filesChanged,
  });

  /*
   * The stage a body is drawn for: the one the run is *on*.
   *
   * Not "the furthest done" — a paused or failed run must never be shown the
   * body of a stage it never reached. But `paused` counts alongside `active`,
   * because a run that stopped to ask a question is still standing on the stage
   * it stopped in. Matching `active` alone sent that run to the top of the
   * rail, which is the one moment a founder most needs to land where the
   * question is.
   */
  const stage = stageForWorkspace(stages, change);

  /*
   * Every event, not only the ones naming a file.
   *
   * The first build filtered to path-bearing events, which threw away most of
   * what Vibe actually did — the commands it ran, the searches it made, the
   * milestones it passed. "Vibe activity" then showed four file writes and
   * called that the activity.
   *
   * The audience split says `internal` events are the per-file, per-command
   * detail that makes a run diagnosable, and this is the screen where a founder
   * watches it happen. Secrets are stripped from every stored event by the
   * redaction layer, and every summary is Vibe-authored from a closed
   * vocabulary — there is no model narration in here to leak.
   */
  const fileEvents = events;

  /* Only a live operation makes the orb move. A finished run whose change is
     waiting on a founder is not Vibe working. */
  const running = operation.status === "queued" || operation.status === "running";

  return {
    stages,
    core: agentCoreState(stages, running),
    timeline,
    change,
    task,
    taskOpportunityId,
    stage,
    fileEvents,
    currentAction: observation.currentAction,
    files: observation.files,
    checks: validationChecks(change),
    validationDepth: change?.validation?.depth ?? null,
    cost,
    // Nothing stored describes a change in prose, so the preview rail carries
    // no invented summaries. The frames and the file list carry the answer.
    previewChanges: [],
    mergeSummary: mergeSummaryFor(change),
    interrupt,
    founderInput,
  };
}

function taskFromChange(change: PreparedChangeWorkspaceItem | null): AgentTask | null {
  if (!change?.origin) return null;
  return {
    title: change.origin.title,
    problem: change.origin.problem,
    whyNow: change.origin.whyNow || null,
    impact: null,
    effort: null,
    lens: null,
    // No spec, so no step: the run is real and the rail describes it, but which
    // step it is doing is unavailable rather than guessed.
    step: null,
    steps: [],
  };
}

/** The first gate that genuinely needs attention for this exact artifact. */
function stageForWorkspace(
  stages: AgentStageStep[],
  change: PreparedChangeWorkspaceItem | null,
): AgentStage | null {
  const live = stages.find(
    (step) => step.state === "active" || step.state === "paused",
  )?.stage;
  if (live) return live;
  if (change === null) return null;

  switch (change.progress.stage) {
    case "not_validated":
    case "validating":
    case "validation_failed":
      return "validate";
    case "reviewing":
    case "review_required":
    case "review_unavailable":
      return "preview";
    default:
      return "review";
  }
}

function mergeSummaryFor(change: PreparedChangeWorkspaceItem | null): MergeSummary {
  return {
    filesChanged: change?.filePaths.length ?? 0,
    /* Absent when preparation could not measure every file; never fake zero. */
    ...(change?.lineStats
      ? {
          linesAdded: change.lineStats.added,
          linesRemoved: change.lineStats.removed,
        }
      : {}),
    tests: testVerdict(change),
    build: buildVerdict(change),
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
): Promise<{ task: AgentTask | null; opportunityId: string | null }> {
  const specId = params.runView?.executionSpecId;
  if (!specId) return { task: null, opportunityId: null };

  const spec = await getExecutionSpecById(supabase, { projectId: params.projectId, specId });
  if (!spec) return { task: null, opportunityId: null };

  const opportunities = await getLatestOpportunities(supabase, params.projectId);
  const move = opportunities?.set.opportunities.find((entry) => entry.id === spec.opportunityId);
  /*
   * The Move is gone from the current set — regenerated, most likely. The run
   * is still real and the rail still describes it; only the task's own words
   * are unavailable, and inventing them from the newest Move would put a
   * different problem's headline over this run.
   */
  if (!move) return { task: null, opportunityId: spec.opportunityId };

  /*
   * What this run will do, from the run's own immutable instruction package.
   *
   * It used to be every title in the project's newest Action Plan, which
   * answered a different question twice over: the plan may have been
   * regenerated since the run started (the old guard emptied the list entirely
   * when it had), and even the right plan lists four steps this run was never
   * given. A founder reading "Vibe will…" over the whole Move could not tell
   * which part was being built.
   *
   * The spec cannot drift: it is the boundary that was compiled, and it names
   * exactly the run's own step plus the preparation folded into it.
   */
  const objective = spec.spec.objective;
  const planned = [
    ...objective.preparation.map((entry) => ({
      order: entry.stepOrder,
      title: entry.title,
      kind: "preparation" as const,
    })),
    { order: spec.stepOrder, title: objective.stepTitle, kind: "delivery" as const },
    /* The rest of the chain, if this run carried one. Read off the spec's own
       fields rather than recomposed, so preparation and delivery cannot drift
       apart on a screen the way they could if one list carried both. */
    ...chainedDeliveriesOf(spec.spec).map((entry) => ({
      order: entry.stepOrder,
      title: entry.title,
      kind: "delivery" as const,
    })),
  ].sort((a, b) => a.order - b.order);

  return {
    opportunityId: spec.opportunityId,
    task: {
      title: move.title,
      problem: move.problem,
      whyNow: move.whyNow || null,
      impact: chip(move.impact),
      effort: chip(move.effort),
      lens: move.primaryLens,
      step: { order: spec.stepOrder, title: objective.stepTitle },
      steps: planned.map((entry) => ({ title: entry.title, kind: entry.kind })),
    },
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
/**
 * The validation's own phases, as the founder reads them (audit R32).
 *
 * ## What was here before
 *
 * Four fixed rows — dependencies, types, tests, build — every one of them
 * reporting the run's *overall* verdict, because the card was thought to carry
 * nothing finer. Its comment said so and was honest about being coarse.
 *
 * It was not true. `change.validation` is already a `ValidationSummary` — the
 * workspace builds one for the card's own progress — and it has carried
 * per-phase results, durations, skip reasons and the source-integrity check
 * all along. The agent workspace was the only surface not reading them, so a
 * founder on the stage that decides saw four rows repeating one verdict where
 * the validation panel two clicks away showed which steps ran, which were
 * skipped, and why.
 *
 * ## The vocabularies
 *
 * A phase is `active` while it runs and `not_run` when the validation never
 * reached it. The check rows say `running` and `pending` for the same two
 * things — a difference in copy, not in meaning, so it is mapped rather than
 * reconciled. `skipped` stays `skipped`: a step that did not need to run is
 * not a step that has not run yet.
 */
const PHASE_STATE: Record<ValidationPhaseView["state"], ValidationCheck["state"]> = {
  passed: "passed",
  failed: "failed",
  active: "running",
  pending: "pending",
  skipped: "skipped",
  not_run: "pending",
  /* A step the sandbox cut off produced no verdict, which is a failure. */
  timed_out: "failed",
};

const SKIP_REASONS: Record<string, string> = {
  outside_depth: "not needed for this change",
  not_configured: "your project defines no such step",
  unsupported: "Vibe cannot run this here",
};

function validationChecks(change: PreparedChangeWorkspaceItem | null): ValidationCheck[] {
  const run = change?.validation ?? null;
  if (run === null) return [];

  return run.phases.map((phase) => ({
    name: phase.label,
    detail:
      phase.state === "skipped"
        ? `Skipped — ${phase.skipReason ? (SKIP_REASONS[phase.skipReason] ?? "not needed here") : "not needed here"}`
        : phase.state === "active"
          ? phase.activeLabel
          : phase.label,
    state: PHASE_STATE[phase.state],
  }));
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

/**
 * One word for the navigation rail (UI-19, `AgentRail.dc.html`).
 *
 * The rail used to carry a count of prepared changes — "13" — which is a real
 * number and the wrong one: a founder glancing at the sidebar wants to know
 * what the agent is *doing*, not how many artifacts it has accumulated. The
 * design says so plainly by putting a state word and a pulsing dot there.
 *
 * One row, the same cost as the counts it sits beside. `null` when the project
 * has never run the agent — an absent state, not a claim of readiness, because
 * whether Vibe is ready is a question `buildAgentContext` answers with evidence
 * and this read has none.
 */
export async function readAgentRailStatus(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const stored = await findLatestOperation(supabase, {
    projectId,
    operationType: "agent_execution",
  });
  if (stored === null) return null;

  switch (stored.status) {
    case "queued":
    case "running":
      return "Running";
    case "needs_user":
      return "Waiting";
    case "failed":
    case "cancelled":
      return "Stopped";
    default:
      return "Ready";
  }
}
