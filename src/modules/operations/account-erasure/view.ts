import { OPERATION_STATUSES, isActive, type OperationStatus } from "../schema";
import type { ErasureRecord } from "./service";

/**
 * What the account settings screen should show about erasure.
 *
 * Three states, derived rather than stored, because the operation row already
 * knows and a second flag would be a second truth. The distinction that earns
 * its keep is `failed` versus `idle`: they render very differently and look
 * identical to anybody who only asked "is one running".
 */
export type ErasureViewState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "failed"; reason: ErasureFailureReason };

/**
 * The refusals a person can act on, plus one bucket for the rest.
 *
 * Every value here is a closed code from the orchestrator, never a database
 * message. VB-003 is the reason: a failed lifecycle operation that reports a
 * raw error is how "deleted successfully" ended up on screen for a deletion
 * that had not happened.
 */
export const ERASURE_FAILURE_REASONS = [
  "billing_not_finalized",
  "stripe_cancel_failed",
  "project_deletion_failed",
  "erasure_start_failed",
  "unknown",
] as const;

export type ErasureFailureReason = (typeof ERASURE_FAILURE_REASONS)[number];

const KNOWN = new Set<string>(ERASURE_FAILURE_REASONS);

/** `isActive()` over an unvalidated string, since this reads a database column. */
function isErasureActive(status: string): boolean {
  return (OPERATION_STATUSES as readonly string[]).includes(status) && isActive(status as OperationStatus);
}

export function erasureViewState(record: ErasureRecord | null): ErasureViewState {
  if (!record) return { kind: "idle" };

  // `isActive()`'s three statuses, never the store's two. An erasure paused in
  // `needs_user` is still holding the account closed, and showing an inviting
  // button beside it would be a lie about what pressing it would do — the same
  // trap ADR 0056 §10 names on the deletion gate.
  if (isErasureActive(record.status)) return { kind: "running" };

  if (record.status !== "failed") return { kind: "idle" };

  const reason = record.failureCode ?? "unknown";
  return { kind: "failed", reason: KNOWN.has(reason) ? (reason as ErasureFailureReason) : "unknown" };
}
