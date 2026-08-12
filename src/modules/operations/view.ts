import { isRetryable, type OperationFailureCode } from "./failures";
import type { OperationStage, OperationStatus } from "./schema";

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
  auditId: string | null;
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
    resultId: input.auditId,
    // A stalled operation stops being polled: continuing would be a request
    // every few seconds, forever, for an answer that is not coming.
    shouldPoll: live && !stalled,
    retryAllowed: failureCode !== null && isRetryable(failureCode),
    stalled,
  };
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
  running_ai: "Analyzing business",
  validating: "Validating result",
  persisting: "Saving result",
  completed: "Completed",
};
