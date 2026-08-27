import type { ChangeProgress, ChangeStage } from "@/modules/execution/change-progress";
import type { OperationStatus } from "@/modules/operations/schema";
import type { ExecutionPhase } from "./events";
import type { TimelineStep } from "./timeline";

/**
 * The Agent workspace as five stages (UI-19).
 *
 * ## Why this is not the execution timeline
 *
 * The timeline has six phases and all six belong to one agent run. The five
 * stages a founder is shown span *two* durable objects: the run produces a
 * prepared change, and Preview and Review are gates on that change — separate
 * operations, a separate stage vocabulary, and in Review's case a human
 * decision rather than a machine state.
 *
 * So this composes rather than replaces. Stages 1 to 3 are a projection over
 * `buildExecutionTimeline`; stages 4 and 5 are a projection over
 * `deriveChangeProgress`. Neither is re-decided here — this reads the answers
 * those two already gave and says which stage the work is sitting on.
 *
 * ## Derived, never stored
 *
 * The same reason the timeline gives: a stored progress record is a second
 * source of truth that can disagree with the event log, and the disagreement
 * always surfaces at the worst moment — a run that failed with a stage still
 * ticking.
 *
 * ## The three honesty rules it inherits, and the one it adds
 *
 * 1. **An unknown position is not the start.** If nothing can be located, every
 *    stage reads pending rather than guessing a position.
 * 2. **`skipped` is not `pending`.** A run that ended without reaching a stage
 *    reads "we never got there"; a run still going reads "not yet". Those look
 *    identical in a stepper and mean opposite things to somebody deciding
 *    whether to keep waiting.
 * 3. **No percentage.** An agent run's length depends on a repository nobody
 *    has measured. Five named stages where one is lit is the honest form.
 * 4. **New here: a stage can be inapplicable.** A preview is temporary and
 *    optional, so a change can legitimately reach review without one ever
 *    existing. That is not failure and it is not pending — parking it at
 *    pending forever would promise something that is never coming.
 */

export const AGENT_STAGES = ["understand", "build", "validate", "preview", "review"] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

export type AgentStageState =
  | "pending"
  | "active"
  | "done"
  | "failed"
  /** The run ended before reaching this stage. */
  | "skipped"
  /** This stage does not apply to this change, and never will. */
  | "not_applicable";

export type AgentStageStep = {
  stage: AgentStage;
  /** Outcome language, tensed to the state. */
  label: string;
  state: AgentStageState;
  /** One short line of measured detail, or null when there is nothing true to say. */
  detail: string | null;
};

const LABELS: Record<AgentStage, Record<"pending" | "active" | "done", string>> = {
  understand: {
    pending: "Understand your product",
    active: "Understanding your product",
    done: "Product understood",
  },
  build: {
    pending: "Make the change",
    active: "Making the change",
    done: "Change made",
  },
  validate: {
    pending: "Check that it works",
    active: "Checking that it works",
    done: "Checks passed",
  },
  preview: {
    pending: "Prepare a preview",
    active: "Preparing your preview",
    done: "Preview ready",
  },
  review: {
    pending: "Your review",
    active: "Ready for your review",
    done: "Merged",
  },
};

/** Which execution phases feed each of the first three stages. */
const PHASES_OF: Record<"understand" | "build" | "validate", readonly ExecutionPhase[]> = {
  understand: ["preparing"],
  build: ["working"],
  // Vibe's own verification of the candidate, the branch it prepares from it,
  // and the independent sandbox run — one wait, as far as a person is concerned.
  validate: ["reviewing_change", "preparing_branch", "validating"],
};

/**
 * Collapse several timeline phases into one stage.
 *
 * Failure wins over everything: a stage containing one failed phase is failed,
 * whatever its other phases say. Otherwise the stage is done only when all of
 * its phases are, which is what stops "Checks passed" appearing while one of
 * the three checks is still running.
 */
function stateFromPhases(steps: readonly TimelineStep[], phases: readonly ExecutionPhase[]): AgentStageState {
  const mine = steps.filter((step) => phases.includes(step.phase));
  if (mine.length === 0) return "pending";
  if (mine.some((step) => step.state === "failed")) return "failed";
  if (mine.some((step) => step.state === "active")) return "active";
  if (mine.every((step) => step.state === "done")) return "done";
  if (mine.some((step) => step.state === "skipped")) return "skipped";
  return "pending";
}

/**
 * Where the prepared change puts Preview.
 *
 * `review_unavailable` becomes inapplicable rather than failed: the comparison
 * is not there, but that is a fact about the artifact and not a verdict on the
 * change. The panel underneath knows whether it expired or failed to capture,
 * and says so — the same division of labour `stalled` has with the merge panel.
 */
function previewState(stage: ChangeStage): AgentStageState {
  switch (stage) {
    case "not_validated":
    case "validating":
      return "pending";
    // Nothing downstream can start, so nothing downstream ever will.
    case "validation_failed":
      return "skipped";
    case "reviewing":
    case "review_required":
      return "active";
    case "review_unavailable":
      return "not_applicable";
    default:
      return "done";
  }
}

/** Where the prepared change puts Review. Merged is the only "done". */
function reviewState(stage: ChangeStage): AgentStageState {
  switch (stage) {
    case "validation_failed":
      return "skipped";
    case "awaiting_approval":
    case "ready_to_merge":
    case "merging":
      return "active";
    // The repository moved or the merge was refused: this cannot advance on
    // its own, and a spinner would say otherwise.
    case "stalled":
      return "failed";
    case "merged":
    case "observed":
      return "done";
    default:
      return "pending";
  }
}

export type AgentWorkspaceInput = {
  /** The run's own timeline, or null when no run has ever started. */
  timeline: readonly TimelineStep[] | null;
  /** The run's status, or null when no run has ever started. */
  runStatus: OperationStatus | null;
  /** The change the run produced, once one exists. */
  changeProgress: ChangeProgress | null;
  /** Files the harness read, for the Understand stage's one measured line. */
  filesInspected?: number | null;
  /** Vibe's own verified candidate count, for the Build stage's. */
  filesChanged?: number | null;
};

const TERMINAL: readonly OperationStatus[] = ["completed", "failed", "cancelled"];

/**
 * The five stages, in order.
 *
 * With no run at all every stage is pending — which is the ready state, and is
 * the truth: nothing has happened. With a run that ended badly, the stages it
 * never reached are skipped rather than pending, so the stepper stops implying
 * that waiting will help.
 */
export function agentStageSteps(input: AgentWorkspaceInput): AgentStageStep[] {
  const { timeline, runStatus, changeProgress } = input;

  const runEnded = runStatus !== null && TERMINAL.includes(runStatus);
  const runFailed = runStatus === "failed" || runStatus === "cancelled";

  const machine: AgentStageState[] =
    timeline === null
      ? ["pending", "pending", "pending"]
      : [
          stateFromPhases(timeline, PHASES_OF.understand),
          stateFromPhases(timeline, PHASES_OF.build),
          stateFromPhases(timeline, PHASES_OF.validate),
        ];

  /*
   * A failed run leaves everything it did not finish as skipped. Without this
   * a run that died in Build shows Validate as pending forever, which reads as
   * "still to come" for work that will never happen.
   */
  const resolved = runFailed
    ? machine.map((state) => (state === "pending" || state === "active" ? "skipped" : state))
    : machine;

  const gatesUnreachable = runFailed || resolved.some((state) => state === "failed");

  const preview: AgentStageState =
    changeProgress !== null
      ? previewState(changeProgress.stage)
      : gatesUnreachable
        ? "skipped"
        : "pending";

  const review: AgentStageState =
    changeProgress !== null
      ? reviewState(changeProgress.stage)
      : gatesUnreachable
        ? "skipped"
        : "pending";

  const states: Record<AgentStage, AgentStageState> = {
    understand: resolved[0]!,
    build: resolved[1]!,
    validate: resolved[2]!,
    preview,
    review,
  };

  return AGENT_STAGES.map((stage) => ({
    stage,
    label: labelFor(stage, states[stage]),
    state: states[stage],
    detail: detailFor(stage, states[stage], input, runEnded),
  }));
}

function labelFor(stage: AgentStage, state: AgentStageState): string {
  if (state === "done") return LABELS[stage].done;
  if (state === "active") return LABELS[stage].active;
  return LABELS[stage].pending;
}

/**
 * One measured line, or nothing.
 *
 * Every number here comes from something Vibe recorded: files read from the
 * harness's own tool stream, files changed from the verified candidate. There
 * is deliberately no estimate of duration or of how many files a run *will*
 * touch — no estimator exists, and inventing one would be the same lie as a
 * progress percentage in a slower disguise.
 */
function detailFor(
  stage: AgentStage,
  state: AgentStageState,
  input: AgentWorkspaceInput,
  runEnded: boolean,
): string | null {
  if (state === "skipped") return runEnded ? "Never reached" : null;
  if (state === "not_applicable") return "Not available for this change";

  if (stage === "understand" && state === "done" && typeof input.filesInspected === "number") {
    return `${input.filesInspected} ${input.filesInspected === 1 ? "file" : "files"} inspected`;
  }
  if (stage === "build" && state === "done" && typeof input.filesChanged === "number") {
    return `${input.filesChanged} ${input.filesChanged === 1 ? "file" : "files"} changed`;
  }
  // The change's own sentence, already written to the founder and already the
  // only place those words live.
  if ((stage === "preview" || stage === "review") && input.changeProgress !== null) {
    return state === "active" ? input.changeProgress.headline : null;
  }
  return null;
}
