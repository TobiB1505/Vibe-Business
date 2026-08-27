import { createServiceClient } from "@/lib/supabase/service";
import {
  admitErasureStep,
  cancelSubscriptionStep,
  deleteIdentityStep,
  deleteProjectsStep,
  failErasure,
  scrubAuditStep,
  tombstoneAccountStep,
  type ErasureDeps,
  type ErasureFailure,
} from "./execution";

/**
 * The durable account erasure (ADR 0056 §4, ADR 0057).
 *
 * ```
 * admit ─▶ cancel Stripe ─▶ delete projects ─▶ tombstone ─▶ scrub audit ─▶ delete identity
 *  gate      external          reuses §3         idempotent    irreversible    terminal
 * ```
 *
 * ## Why the external effect is second and not last
 *
 * ADR 0056 §9. Deleting the local identity does not stop the card being
 * charged; it only removes Vibe's ability to see that it is happening. So
 * Stripe is cancelled before any local state is touched, and a failure to
 * cancel stops the erasure here rather than proceeding — an erasure that
 * half-succeeded and left a live subscription nobody can see is strictly worse
 * than one that refused.
 *
 * ## Retries
 *
 * `cancelSubscription` and `deleteIdentity` are `maxRetries = 0`, and for the
 * same reason the preview teardown gives: a platform retry of an external call
 * buys ambiguity for nothing, and re-entry recovers better because the step
 * re-reads the world and finds the work already done. Both are idempotent in
 * principle — cancelling a cancelled subscription and deleting a deleted user
 * are their intended outcomes — but "idempotent" is the reason re-entry is
 * safe, not a reason to let the platform retry blindly (rule 73).
 *
 * Everything between them may retry. Deleting an already-deleted project is a
 * no-op, setting an already-null column is a no-op, and scrubbing an
 * already-scrubbed payload is a no-op because the transform is pure and its
 * output contains none of the keys it removes.
 *
 * ## Why there is no `try` around the tail
 *
 * A step that fails records its reason and stops the erasure. Swallowing one to
 * "get to the end" would produce exactly the half-erased account §9 rules out —
 * an identity deleted while its subscription still bills, or a billing graph
 * tombstoned under an identity that still exists.
 */

function deps(): ErasureDeps {
  return { supabase: createServiceClient() };
}

async function admit(operationId: string) {
  "use step";
  return admitErasureStep(deps(), operationId);
}

async function cancelSubscription(operationId: string) {
  "use step";
  return cancelSubscriptionStep(deps(), operationId);
}
// A platform retry cannot tell "Stripe was never called" from "it was called
// and the answer was lost". Re-entry is the recovery path.
cancelSubscription.maxRetries = 0;

async function deleteProjects(operationId: string) {
  "use step";
  return deleteProjectsStep(deps(), operationId);
}

async function tombstone(operationId: string) {
  "use step";
  return tombstoneAccountStep(deps(), operationId);
}

async function scrubAudit(operationId: string) {
  "use step";
  return scrubAuditStep(deps(), operationId);
}

async function deleteIdentityAndComplete(operationId: string) {
  "use step";
  return deleteIdentityStep(deps(), operationId);
}
// The one write in this workflow that cannot be un-done or repeated.
deleteIdentityAndComplete.maxRetries = 0;

async function recordFailure(operationId: string, failureCode: ErasureFailure) {
  "use step";
  await failErasure(deps(), operationId, failureCode);
}

export async function accountErasureWorkflow(operationId: string) {
  "use workflow";

  // Written out rather than looped. The eleven steps are a sequence with a
  // fixed order that ADR 0056 §4 argues for one dependency at a time, and a
  // reader checking that order against the ADR should be able to see it.
  const admitted = await admit(operationId);
  if (!admitted.ok) return stop(operationId, admitted.failureCode);

  const cancelled = await cancelSubscription(operationId);
  if (!cancelled.ok) return stop(operationId, cancelled.failureCode);

  const projects = await deleteProjects(operationId);
  if (!projects.ok) return stop(operationId, projects.failureCode);

  const tombstoned = await tombstone(operationId);
  if (!tombstoned.ok) return stop(operationId, tombstoned.failureCode);

  const scrubbed = await scrubAudit(operationId);
  if (!scrubbed.ok) return stop(operationId, scrubbed.failureCode);

  const erased = await deleteIdentityAndComplete(operationId);
  if (!erased.ok) return stop(operationId, erased.failureCode);
}

async function stop(operationId: string, failureCode: ErasureFailure): Promise<void> {
  await recordFailure(operationId, failureCode);
}
