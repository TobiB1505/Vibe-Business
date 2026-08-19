import { isRetryable, type OperationFailureCode } from "./failures";
import { isTerminal, isWorking, type OperationStage, type OperationStatus } from "./schema";

/**
 * The safe operation DTO (Sprint 7 §16, §17).
 *
 * What is deliberately absent: the workflow run id, the execution provider,
 * any persisted step state, provider internals, prompts, and model output.
 * The browser is told what is happening and what it may do about it — nothing
 * that describes how the orchestration works.
 *
 * Pure and synchronous, so every state the UI can render is a unit test.
 */

export type OperationView = {
  operationId: string;
  status: OperationStatus;
  stage: OperationStage;
  startedAt: string | null;
  completedAt: string | null;
  /** Typed code only, mapped to copy in the UI. */
  failureCode: OperationFailureCode | null;
  /** The audit this operation produced, once it has one. */
  resultId: string | null;
  /** Whether the client should keep asking. False for every terminal state. */
  shouldPoll: boolean;
  /** Whether offering "Try again" is honest for this failure. */
  retryAllowed: boolean;
  /**
   * Running far longer than the work could plausibly take.
   *
   * A durable run can in principle be lost by the platform, and an operation
   * row would then stay `running` forever. Rather than have the UI poll
   * indefinitely (§20), this says so and lets the user start a fresh run.
   */
  stalled: boolean;
};

/**
 * When a live operation stops being believable.
 *
 * The measured audit is ~50 seconds end to end. Ten minutes is far outside
 * that, and is chosen to be unambiguous rather than tight: a false "stalled"
 * on a merely slow provider would invite a duplicate paid run.
 */
export const OPERATION_STALL_THRESHOLD_MS = 10 * 60 * 1000;

export type BuildOperationViewInput = {
  operationId: string;
  status: OperationStatus;
  stage: OperationStage;
  failureCode: string | null;
  resultId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export function buildOperationView(
  input: BuildOperationViewInput,
  now: Date = new Date(),
): OperationView {
  const live = input.status === "queued" || input.status === "running";
  const failureCode = (input.failureCode as OperationFailureCode | null) ?? null;

  const since = Date.parse(input.startedAt ?? input.createdAt);
  const stalled = live && Number.isFinite(since) && now.getTime() - since > OPERATION_STALL_THRESHOLD_MS;

  return {
    operationId: input.operationId,
    status: input.status,
    stage: input.stage,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    failureCode,
    resultId: input.resultId,
    // A stalled operation stops being polled: continuing would be a request
    // every few seconds, forever, for an answer that is not coming.
    shouldPoll: live && !stalled,
    retryAllowed: failureCode !== null && isRetryable(failureCode),
    stalled,
  };
}

/**
 * What a poller should do about an operation, as one word (UI-4 §5).
 *
 * ## The ambiguity this removes
 *
 * `shouldPoll` answers one question — "ask again?" — and three different
 * situations answer it "no": the operation finished, the operation is waiting
 * on a person, and the operation has been running so long it is presumed
 * lost. Every panel that treated "stopped polling" as "finished" was therefore
 * wrong in two of the three cases, and several did.
 *
 * So the phase is named rather than inferred. `settled` is the only one that
 * means the work is over.
 */
export type OperationPollPhase =
  /** Nothing to watch. */
  | "idle"
  /** Doing work. Keep asking. */
  | "working"
  /** Paused on a question only the founder can answer. Stop asking — the
   *  answer arrives through the form, not through the poll. */
  | "waiting_user"
  /** Running far past what the work could take. Stop asking, and say so. */
  | "stalled"
  /** Completed, failed or cancelled. */
  | "settled";

export function operationPollPhase(operation: OperationView | null): OperationPollPhase {
  if (!operation) return "idle";
  if (isTerminal(operation.status)) return "settled";
  if (operation.status === "needs_user") return "waiting_user";
  if (operation.stalled) return "stalled";
  if (isWorking(operation.status)) return "working";

  return "idle";
}

/**
 * Which of two answers about an operation is the newer one (UI-4 §5).
 *
 * A panel holds two: what the start action just returned, and what the poller
 * last saw. Rather than syncing them, derive which is newer — a poll result
 * for the started operation supersedes it; anything else means the poller has
 * not caught up yet.
 *
 * Written out here because five panels had each derived it for themselves,
 * and the one that got it wrong showed a just-started audit flickering back
 * to its start button.
 */
export function freshestOperation(
  polled: OperationView | null,
  started: OperationView | null,
): OperationView | null {
  if (started && polled?.operationId !== started.operationId) return started;
  return polled ?? started;
}

/**
 * Whether a polled answer is worth re-rendering the server component for
 * (UI-4 §5).
 *
 * The rule the preview panel paid for: refresh on the *transition*, never on
 * the tick. A page render can cost provider calls and several reads, so at a
 * two-second interval a refresh can outlast the gap until the next one, and
 * each supersedes the one still in flight — hundreds of re-renders for one
 * state change, of which one may never land.
 *
 * Compared as strings because the shapes differ per surface: an operation
 * status, a preview state, an outcome state. What matters is only whether the
 * poll is naming something other than what is on screen.
 */
export function shouldRefreshForState(polled: string | null | undefined, rendered: string): boolean {
  if (polled === null || polled === undefined) return false;
  return polled !== rendered;
}

/**
 * Progress copy (§18).
 *
 * Names the work, not a percentage. A four-step pipeline whose third step is
 * ~50 seconds of inference has no honest percentage, and a progress bar that
 * sits at 60% for a minute teaches people to distrust it.
 */
export const OPERATION_STAGE_LABELS: Record<OperationStage, string> = {
  preparing: "Preparing evidence",
  counting_tokens: "Preparing evidence",
  // Written to the person who is being waited on, not about them.
  asking_founder: "Waiting for you",
  running_ai: "Analyzing business",
  prioritizing: "Finding your highest-impact opportunities",
  // Names the work as the founder would describe it, not as the code does.
  planning: "Working out how to do this",
  preflight: "Checking your current product state",
  generating_change: "Preparing the change",
  writing_repository: "Creating an isolated branch",
  verifying_repository: "Verifying the change",
  validating: "Validating result",
  persisting: "Saving result",
  // Isolated validation. Each names a real step the user could verify, which
  // is the whole reason the stage list is granular rather than "working…".
  provisioning: "Starting an isolated environment",
  acquiring_source: "Fetching the prepared commit",
  verifying_source: "Verifying the prepared commit",
  securing_sandbox: "Securing the environment",
  installing: "Installing dependencies",
  typechecking: "Checking types",
  testing: "Running tests",
  building: "Building application",
  collecting_results: "Collecting results",
  cleaning_up: "Cleaning up",
  // Temporary preview. "Restoring" rather than "building": the build already
  // happened, and saying otherwise would misdescribe what a preview is.
  restoring_artifact: "Restoring the validated build",
  verifying_artifact: "Verifying the restored build",
  starting_server: "Starting the application",
  checking_preview: "Checking the preview responds",
  // Visual review. Named for what is being photographed, because "capturing"
  // alone leaves a user wondering which half is happening.
  capturing_before: "Capturing current live product",
  capturing_after: "Capturing preview",
  persisting_artifacts: "Preparing comparison",
  // Safe merge (Sprint 11C §18). Named so a user watching their default
  // branch being written to can see which half is happening — the check that
  // revalidates their approval, or the write itself.
  authorizing: "Rechecking the repository and your approval",
  writing_default_ref: "Updating the default branch",
  verifying_default_ref: "Verifying the default branch",
  converging: "Recording the result",
  // Outcome verification (Sprint 12A §29). Names the wait honestly: production
  // may not have updated yet, and pretending to know how long that takes would
  // be the same lie as a percentage.
  observing: "Checking your public product",
  evaluating: "Comparing what was expected with what was observed",
  // Business measurement (Sprint 12B §23). Factual progress only — never
  // "looking good", which would be a conclusion drawn before the window closed.
  // Product Understanding (CORE-1 §27, §45). The only stages a user reads
  // verbatim rather than through a translation, so they are written in the
  // product's voice and never mention analysis, snapshots, or models.
  reading_code: "Reading what you built",
  reading_public_product: "Looking at your public product",
  understanding_product: "Putting it together",
  collecting_baseline: "Collecting the baseline period",
  collecting_post: "Collecting the post-change period",
  comparing: "Comparing the two periods",
  // Agentic execution (EXECUTION CORE-4 §21). Four durable steps, named for
  // what a waiting user is told. The agent's own moment-to-moment activity is
  // reported separately, from the tool calls Vibe brokered — these say where
  // the *workflow* is, which is the only thing this stage list can honestly
  // claim to know while a step is mid-flight.
  preparing_workspace: "Setting up an isolated copy of your code",
  running_agent: "Making the change",
  extracting_change: "Working out exactly what changed",
  verifying_change: "Checking the change is inside its limits",
  completed: "Completed",
};
