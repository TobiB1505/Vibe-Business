import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { cancelSubscriptionsForErasure } from "@/modules/billing/subscription";
import { deleteProjectLifecycle } from "../project-lifecycle/service";
import { completeOperationRun, failOperationRun, getOperationRunById, setOperationStage } from "../store";
import {
  deleteIdentity,
  deleteIdentityRows,
  findUnfinalizedHold,
  listOwnedProjectIds,
  scrubAuditMetadata,
  tombstoneOwnership,
} from "./store";

/**
 * Account erasure, as eleven ordered steps (ADR 0056 §4).
 *
 * The order is not cosmetic: each step exists because the one before it made it
 * possible or safe, and two of the dependencies are enforced by the database
 * rather than by this file. Step 11 cannot run before step 4, because deleting
 * `auth.users` while a project still exists is refused — measured, and by F3's
 * installation reference rather than by the `execution_specs` trigger the step
 * order implies. Step 6 cannot run before step 4 for the same reason.
 *
 * ## What "step" means here
 *
 * Each exported function below is one durable step. They are grouped so that a
 * retry re-runs work that is idempotent and never re-runs work that is not: the
 * Stripe call and the identity deletion each stand alone, and everything
 * between them converges to the same state however many times it runs.
 *
 * ## The failures are typed and the erasure stops on them
 *
 * There is no partial success. An erasure that half-completed and left a live
 * subscription nobody can see is strictly worse than one that refused, so every
 * step returns a reason and the workflow stops rather than continuing past it.
 */

export type ErasureFailure =
  | "identity_not_found"
  | "billing_not_finalized"
  | "stripe_cancel_failed"
  | "project_deletion_failed"
  | "identity_rows_failed"
  | "tombstone_failed"
  | "audit_scrub_failed"
  | "identity_delete_failed";

export type StepOutcome<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; failureCode: ErasureFailure };

export type ErasureDeps = { supabase: SupabaseClient };

/**
 * The owner of this erasure, read from the operation row and nowhere else.
 *
 * A step is handed an operation id and nothing else. It re-reads the row and
 * uses that row's `user_id`, so no caller can name an identity to erase — the
 * obligation `lib/supabase/service.ts` states, and the one where getting it
 * wrong deletes the wrong person.
 */
async function ownerOf(deps: ErasureDeps, operationId: string): Promise<string | null> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation || operation.operationType !== "account_erasure") return null;

  return operation.userId;
}

/** Steps 1 and 3. Step 1's account-wide closure is the insert trigger (ADR 0057 §5). */
export async function admitErasureStep(
  deps: ErasureDeps,
  operationId: string,
): Promise<StepOutcome> {
  const userId = await ownerOf(deps, operationId);
  if (!userId) return { ok: false, failureCode: "identity_not_found" };

  await setOperationStage(deps.supabase, { operationId, stage: "preparing", markRunning: true });

  let held: boolean;
  try {
    held = await findUnfinalizedHold(deps.supabase, userId);
  } catch {
    return { ok: false, failureCode: "billing_not_finalized" };
  }

  // Waits or refuses; never settles or releases. ADR 0056 §10.
  if (held) return { ok: false, failureCode: "billing_not_finalized" };

  await recordAuditEvent(deps.supabase, {
    userId,
    eventType: "account.erasure_started",
    metadata: { operationId },
  });

  return { ok: true };
}

/**
 * Step 2 — the external effect, before any local state is touched.
 *
 * First for the reason ADR 0056 §9 gives: deleting the local identity does not
 * stop the card being charged, it only removes Vibe's ability to see that it is
 * happening. A failure here stops the erasure rather than proceeding.
 */
export async function cancelSubscriptionStep(
  deps: ErasureDeps,
  operationId: string,
): Promise<StepOutcome> {
  const userId = await ownerOf(deps, operationId);
  if (!userId) return { ok: false, failureCode: "identity_not_found" };

  const cancelled = await cancelSubscriptionsForErasure(deps.supabase, userId);
  if (!cancelled.ok) return { ok: false, failureCode: "stripe_cancel_failed" };

  return { ok: true };
}

/**
 * Step 4 — every project, one at a time, through the §3 machine.
 *
 * Reusing `deleteProjectLifecycle` rather than writing a second deletion path
 * is the point: one mechanism means one set of safety gates, one storage sweep
 * and one place where the rules can be wrong. A project that cannot drain stops
 * the whole erasure and names itself, so the failure is actionable rather than
 * "something did not delete".
 */
export async function deleteProjectsStep(
  deps: ErasureDeps,
  operationId: string,
): Promise<StepOutcome<{ deletedProjects: number }>> {
  const userId = await ownerOf(deps, operationId);
  if (!userId) return { ok: false, failureCode: "identity_not_found" };

  await setOperationStage(deps.supabase, { operationId, stage: "cleaning_up" });

  let projectIds: string[];
  try {
    projectIds = await listOwnedProjectIds(deps.supabase, userId);
  } catch {
    return { ok: false, failureCode: "project_deletion_failed" };
  }

  for (const projectId of projectIds) {
    const deleted = await deleteProjectLifecycle({ projectId, userId });
    if (!deleted.ok) {
      await recordAuditEvent(deps.supabase, {
        userId,
        projectId,
        eventType: "project.deletion_failed",
        metadata: { operationId, reason: deleted.reason },
      });
      return { ok: false, failureCode: "project_deletion_failed" };
    }
  }

  return { ok: true, deletedProjects: projectIds.length };
}

/**
 * Steps 5 to 9 — delete what must not survive, tombstone what must.
 *
 * One step because the two halves have one precondition (step 4 has run) and no
 * dependency on each other, and because splitting them would put a durable
 * boundary in the middle of a sequence that is idempotent end to end.
 */
export async function tombstoneAccountStep(
  deps: ErasureDeps,
  operationId: string,
): Promise<StepOutcome> {
  const userId = await ownerOf(deps, operationId);
  if (!userId) return { ok: false, failureCode: "identity_not_found" };

  await setOperationStage(deps.supabase, { operationId, stage: "persisting" });

  try {
    await deleteIdentityRows(deps.supabase, userId);
  } catch {
    return { ok: false, failureCode: "identity_rows_failed" };
  }

  try {
    await tombstoneOwnership(deps.supabase, userId);
  } catch {
    return { ok: false, failureCode: "tombstone_failed" };
  }

  return { ok: true };
}

/**
 * Step 10 — anonymize the audit log in place (§8).
 *
 * Before step 11 rather than after, because the scrub is keyed on `user_id` and
 * step 11 is what nulls it. Reversing them would leave every payload intact
 * with no way left to find the rows.
 */
export async function scrubAuditStep(
  deps: ErasureDeps,
  operationId: string,
): Promise<StepOutcome<{ scrubbedEvents: number }>> {
  const userId = await ownerOf(deps, operationId);
  if (!userId) return { ok: false, failureCode: "identity_not_found" };

  try {
    const scrubbedEvents = await scrubAuditMetadata(deps.supabase, userId);
    return { ok: true, scrubbedEvents };
  } catch {
    return { ok: false, failureCode: "audit_scrub_failed" };
  }
}

/**
 * Step 11, and the operation's own terminal write.
 *
 * They are one step because the operation row cannot report an outcome it
 * reaches after its owner is gone unless the two happen together — and because
 * the receipt has to be written on the far side of the deletion. An
 * `account.erased` event recorded *before* the delete would claim an erasure
 * that might still fail; recorded after, it carries no owner at all, which is
 * both the honest record and exactly what retention should keep.
 *
 * The operation row itself survives with both owner columns nulled by the same
 * cascade (ADR 0057 §2). That is what makes "did this erasure succeed" a
 * question with an answer, rather than an inference from an absent row.
 */
export async function deleteIdentityStep(
  deps: ErasureDeps,
  operationId: string,
): Promise<StepOutcome> {
  const userId = await ownerOf(deps, operationId);
  if (!userId) return { ok: false, failureCode: "identity_not_found" };

  const deleted = await deleteIdentity(deps.supabase, userId);
  if (!deleted.ok) return { ok: false, failureCode: "identity_delete_failed" };

  await completeOperationRun(deps.supabase, { operationId, resultId: null });

  await recordAuditEvent(deps.supabase, {
    // There is nobody left to attribute this to, and that is the point.
    userId: null,
    eventType: "account.erased",
    metadata: { operationId },
  });

  return { ok: true };
}

/** One failure, recorded once, on the operation the workflow was carrying. */
export async function failErasure(
  deps: ErasureDeps,
  operationId: string,
  failureCode: ErasureFailure,
): Promise<void> {
  const userId = await ownerOf(deps, operationId);

  await failOperationRun(deps.supabase, { operationId, failureCode });

  if (userId) {
    await recordAuditEvent(deps.supabase, {
      userId,
      eventType: "account.erasure_failed",
      metadata: { operationId, failureCode },
    });
  }
}
