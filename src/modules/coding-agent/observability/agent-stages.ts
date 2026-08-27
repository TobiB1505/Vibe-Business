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
  /**
   * The run stopped here and asked the founder something only they can answer.
   *
   * Not `active`: nothing is running, and a stage that kept reporting progress
   * while waiting on a person would be narrating work nobody is doing. Not
   * `failed` either — the run did not go wrong, and an answer restarts it.
   */
  | "paused"
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

/**
 * One word per stage, from the imported tracker.
 *
 * Not tensed. The first build had "Product understood" / "Making the change" /
 * "Check that it works", which reads well in prose and fails in a rail: five
 * cells across, the long ones ran into their neighbours, and truncating them
 * produced "Product understo…". A stable noun never overflows, and the status
 * word underneath carries the tense — which is the design's own answer and the
 * better one.
 */
const LABELS: Record<AgentStage, string> = {
  understand: "Understand",
  build: "Build",
  validate: "Validate",
  preview: "Preview",
  // The design names the last stage for both halves of what it holds: the
  // founder decides, and only then does anything move.
  review: "Review & merge",
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

/**
 * Change stages that can only have been reached with validation behind them.
 *
 * Taken from `ChangeStage`'s own ordering rather than restated: everything from
 * `reviewing` onward requires a passing validation, which is why
 * `validation_failed` stops the gates dead.
 */
const VALIDATED: readonly ChangeStage[] = [
  "reviewing",
  "review_required",
  "review_unavailable",
  "awaiting_approval",
  "ready_to_merge",
  "merging",
  "stalled",
  "merged",
  "observed",
];

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
  const resolved: AgentStageState[] = runFailed
    ? machine.map((state) => (state === "pending" || state === "active" ? "skipped" : state))
    : runStatus === "needs_user"
      ? /*
         * The run stopped to ask the founder something. Nothing is executing,
         * so the stage it stopped on must not keep reporting progress — the
         * design calls this the moment everything mint goes amber, and the
         * reason it deserves its own state is that waiting on a person and
         * working are indistinguishable in every stepper that lacks one.
         */
        machine.map((state) => (state === "active" ? "paused" : state))
      : machine;

  /*
   * Validation has two sources and the change's is the stronger one.
   *
   * The run's own `validating` phase only fires when the harness validated
   * in-run. Validation of the *prepared change* is a separate operation, and a
   * change can pass every safety check without that phase ever existing. The
   * first live screen showed exactly that: "Check that it works — never
   * reached" beside a change whose checks had all passed, with stage four
   * already in progress. A stepper that says a stage was never reached while
   * the stage after it is running is not reporting, it is contradicting itself.
   */
  const changeValidated = changeProgress !== null && VALIDATED.includes(changeProgress.stage);
  const changeValidating = changeProgress?.stage === "validating";
  const changeValidationFailed = changeProgress?.stage === "validation_failed";

  if (changeValidationFailed) resolved[2] = "failed";
  else if (changeValidated && resolved[2] !== "failed") resolved[2] = "done";
  else if (changeValidating && resolved[2] !== "failed" && resolved[2] !== "done") {
    resolved[2] = "active";
  }

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
    label: labelFor(stage),
    state: states[stage],
    detail: detailFor(stage, states[stage], input),
  }));
}

function labelFor(stage: AgentStage): string {
  return LABELS[stage];
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
): string | null {
  // No detail: the rail's state word already says "Waiting for you", and
  // saying it twice on one line is the redundancy this product keeps removing.
  /*
   * Three states whose state word already says everything. A detail here would
   * be the same sentence twice on one line — the live rail read "Never
   * reached · Never reached", which is how you notice.
   */
  if (state === "paused" || state === "skipped" || state === "not_applicable") return null;

  if (stage === "understand" && state === "done" && typeof input.filesInspected === "number") {
    return `${input.filesInspected} ${input.filesInspected === 1 ? "file" : "files"} inspected`;
  }
  if (stage === "build" && state === "done" && typeof input.filesChanged === "number") {
    return `${input.filesChanged} ${input.filesChanged === 1 ? "file" : "files"} changed`;
  }
  /*
   * Deliberately not the change's headline. It is a full sentence written for a
   * panel, and in a rail cell it overflowed into the next stage's label on the
   * live screen. The stage's own body says it at the width it was written for.
   */
  return null;
}

/**
 * What the core is doing, derived from the stages rather than passed in.
 *
 * Three states and no fourth. A failed run is `settled` — still, not idle and
 * emphatically not working: a core that kept breathing over a failure would be
 * the animated equivalent of a status line that narrates work nobody is doing.
 * Which of the two settled meanings applies is carried by the caption and by
 * the rail, in words.
 */
export type AgentCoreState = "idle" | "working" | "waiting" | "settled";

export function agentCoreState(steps: readonly AgentStageStep[]): AgentCoreState {
  // Checked before `working`: a paused run has an amber hold, not a breath.
  if (steps.some((step) => step.state === "paused")) return "waiting";
  if (steps.some((step) => step.state === "active")) return "working";
  const untouched = steps.every((step) => step.state === "pending");
  return untouched ? "idle" : "settled";
}

/**
 * The line under the core.
 *
 * One table, and the only place these words live — the change-progress
 * vocabulary already learned that two places describing one state differently
 * is how a product starts disagreeing with itself.
 *
 * Every sentence here is about what *has* happened or what is happening now.
 * None promises a duration, and none says a stage is nearly done: the run has
 * no measured fraction, so "almost there" would be invention with a friendly
 * face.
 */
const CORE_CAPTIONS: Record<AgentStage, string> = {
  understand: "Vibe is reading your product to work out what the change needs.",
  build: "Vibe is making the change in an isolated copy of your code.",
  validate: "Vibe is checking the change before showing it to you.",
  preview: "Vibe is preparing what you need in order to decide.",
  review: "Everything is ready. Nothing is applied until you say so.",
};

export function agentCoreCaption(steps: readonly AgentStageStep[]): string {
  if (steps.some((step) => step.state === "paused")) {
    /*
     * Not "answering starts it again", which is what this said and is false.
     * `finalizeAgentRun` is explicit: a paused attempt must neither charge nor
     * invent a resume — resolution cancels this run, and a fresh attempt goes
     * through admission with its own hold. Saying otherwise promised a
     * continuation the architecture refuses to make.
     */
    return "Vibe stopped to ask you something. Your answer is what unblocks the work.";
  }

  const active = steps.find((step) => step.state === "active");
  if (active) return CORE_CAPTIONS[active.stage];

  if (steps.some((step) => step.state === "failed")) {
    return "This run stopped. Nothing was applied to your code.";
  }
  if (steps.every((step) => step.state === "pending")) {
    return "Vibe understands your product, your code and your goals, and is ready to work.";
  }
  const review = steps.find((step) => step.stage === "review");
  if (review?.state === "done") return "Your change is in. Vibe is watching what it does.";

  // Something happened and nothing is running: the rail says which stage that
  // was, and this line does not guess at a reason it cannot see.
  return "Vibe has stopped here. The stage above says where.";
}


/**
 * Whether a stage's own body is worth drawing.
 *
 * Wider than "is it active", and the first live build was not: the merge stage
 * appeared only while a change was waiting on a decision, so a founder whose
 * merge had stalled — the one moment they most need to see why — was shown
 * nothing, and neither was one looking back at a change already in. A stage
 * with a verdict has as much to say as one in progress; only `pending` and
 * `skipped` have nothing.
 */
export function stageHasBody(steps: readonly AgentStageStep[], stage: AgentStage): boolean {
  const state = steps.find((step) => step.stage === stage)?.state ?? "pending";
  return state === "active" || state === "paused" || state === "done" || state === "failed";
}
