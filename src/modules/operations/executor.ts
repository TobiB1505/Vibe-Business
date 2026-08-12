import type { OperationType } from "./schema";

/**
 * The execution boundary (Sprint 7 §4).
 *
 * Deliberately two methods and one argument. Everything the durable run needs
 * is already in the database, so the only thing that has to cross this
 * boundary is an operation id — which is also what keeps customer evidence out
 * of a third-party durable log (§14).
 *
 * There is no provider selection here, and no second adapter. The point of the
 * interface is not portability theatre: it is that the Business Audit domain
 * stays callable from a test without a workflow platform, and that the
 * application never learns a provider's vocabulary.
 */

export type StartOperationInput = {
  operationId: string;
  operationType: OperationType;
};

export type StartOperationResult =
  | { ok: true; runId: string }
  | { ok: false; error: "execution_start_failed" };

export interface OperationExecutor {
  /** Human-readable provider name, recorded for support. */
  readonly name: string;

  /**
   * Enqueues durable work and returns as soon as it is accepted.
   *
   * Must not wait for the operation to finish — the entire point of the sprint
   * is that the initiating request does not own the lifecycle.
   */
  start(input: StartOperationInput): Promise<StartOperationResult>;
}
