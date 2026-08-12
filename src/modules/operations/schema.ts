/**
 * The durable operation model (Sprint 7 §5).
 *
 * Two axes, deliberately separated:
 *
 *  - **status** is lifecycle: what may still happen to this operation.
 *  - **stage** is progress: where the work has got to.
 *
 * Conflating them is the usual mistake, and it produces states like "running"
 * meaning both "queued somewhere" and "currently calling a provider" — which
 * is precisely the distinction that decides whether a retry is safe.
 *
 * Both are closed sets. Free-form status strings would put UI copy, retry
 * policy and cost safety at the mercy of a typo.
 *
 * There are no percentages here on purpose (§5). A four-step pipeline whose
 * third step takes 50 seconds has no honest percentage, and inventing one
 * teaches users to distrust the number.
 */

export const OPERATION_TYPES = ["business_audit"] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const OPERATION_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OPERATION_STAGES = [
  "preparing",
  "counting_tokens",
  "running_ai",
  "validating",
  "persisting",
  "completed",
] as const;
export type OperationStage = (typeof OPERATION_STAGES)[number];

/** Statuses from which nothing further happens. Completed operations are immutable. */
export const TERMINAL_STATUSES: readonly OperationStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: OperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** True while an operation still owns its input identity and must not be duplicated. */
export function isActive(status: OperationStatus): boolean {
  return status === "queued" || status === "running";
}

/**
 * The point of no return for cost (§24).
 *
 * Once the paid inference stage has been entered, the provider may already
 * have been billed, so nothing downstream may quietly start it again and
 * cancellation cannot be honestly promised.
 */
export function hasEnteredPaidWork(stage: OperationStage): boolean {
  return stage === "running_ai" || stage === "validating" || stage === "persisting" || stage === "completed";
}
