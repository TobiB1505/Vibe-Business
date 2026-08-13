import type { AuditRunFailure } from "@/modules/business-audit/runner";
import type { AuditPrerequisite } from "@/modules/business-audit/service";
import type { OpportunityRunFailure } from "@/modules/opportunities/runner";
import type { ExecutionFailureCode } from "@/modules/execution/schema";
import type { ValidationFailureCode } from "@/modules/validation/schema";
import type { PreviewFailureCode } from "@/modules/change-preview/schema";

/**
 * Every way a durable operation can end badly (Sprint 7 §21).
 *
 * A closed union, composed from the audit domain's own codes plus the ones
 * that only exist because execution is now durable. Closed because the UI maps
 * each to copy, and a string that slips through would reach a user as either
 * nothing or as an internal identifier.
 */

export type OperationExecutionFailure =
  /** The operation row vanished, or never existed. */
  | "operation_not_found"
  /** The project is gone, or its owner no longer matches the operation's. */
  | "project_not_found"
  /** Evidence changed between the click and the step; the identity no longer matches. */
  | "inputs_changed"
  /** The audit row was already claimed by another in-flight run. */
  | "already_running"
  /**
   * A paid call was started and its outcome was never recorded.
   *
   * The provider may have billed it. This code exists so that ambiguity ends
   * the operation instead of silently buying a second inference (§11).
   */
  | "inference_interrupted"
  /** The execution provider refused to accept the durable run. */
  | "execution_start_failed"
  /** Prioritization needs a diagnosis to prioritize from (Sprint 8 §34). */
  | "audit_missing"
  /** The audit is older than the evidence that exists now (Sprint 8 §34). */
  | "audit_stale";

export type OperationFailureCode =
  | AuditRunFailure
  | OpportunityRunFailure
  | ExecutionFailureCode
  | AuditPrerequisite
  | ValidationFailureCode
  | PreviewFailureCode
  | OperationExecutionFailure;

/**
 * Failures where starting the same operation again is a sane thing to offer.
 *
 * Deliberately conservative: `inference_interrupted` is absent because we do
 * not know whether the user was already charged, and offering a one-click
 * retry on a maybe-billed call is how a durable system quietly doubles a bill.
 * The user can still start a new run deliberately — this only controls whether
 * the product suggests it.
 */
const RETRYABLE: readonly OperationFailureCode[] = [
  "provider_rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_overloaded",
  "token_count_failed",
  "execution_start_failed",
  "inputs_changed",
  "already_running",
  // Both are fixed by doing something first, and the UI says what. Offering
  // the button is honest because the user can act on it.
  "audit_missing",
  "audit_stale",
];

export function isRetryable(code: OperationFailureCode): boolean {
  return RETRYABLE.includes(code);
}
