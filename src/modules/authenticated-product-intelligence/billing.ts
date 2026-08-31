import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { ReleaseReason } from "@/modules/credits/balance";
import {
  authorizeOperationCredits,
  releaseOperationCredits,
  settleOperationCredits,
  type AuthorizeOperationCreditsResult,
} from "@/modules/credits/operation-billing";
import { resolveBillingOwner } from "@/modules/credits/service";
import { findCreditAccountByUser, findReservationByIdempotencyKey } from "@/modules/credits/store";
import type { DeepScanAccessMode } from "./entitlement";

/**
 * The Credit hold behind an additional Deep Scan (`launch-v1`, PRODUCT.md §12.1).
 *
 * ## Why a reservation and not a charge
 *
 * Because the entitlement rule this module has always enforced is the same rule
 * money has to follow. PRODUCT.md §12.1 lists six outcomes that must *not* cost
 * a user their included scan — a created session, a failed analysis, a
 * cancelled session, an expired session, never reaching the authenticated
 * origin, and our own persistence failing — and every one of them must
 * equally not cost a paying user Credits. A charge would have to be refunded;
 * a hold is simply released, and a release is a truer record of what happened.
 *
 * So the shape is exactly `credits/operation-billing.ts`'s, and deliberately so:
 *
 * ```
 * reserve   before the browser exists      startDeepScan
 * settle    a snapshot was persisted       analyzeDeepScan, on success only
 * release   anything else                  every terminal path
 * ```
 *
 * ## Why the session id, and why it is minted before the session
 *
 * A hold has to be taken before Vibe pays Browserbase for a browser — that is
 * the whole point of §18's ordering, and discovering an empty wallet after
 * buying a session is both a cost leak and an insult. But the hold also needs a
 * durable identity that the settle and release paths can find again, and the
 * only one that survives the whole lifecycle is the session row's id.
 *
 * Hence: Vibe mints the session id first, holds against it, and then passes it
 * to the insert. There is no window in which a browser exists without a hold,
 * and no reservation that cannot be found from the session it belongs to.
 *
 * ## Why service-role
 *
 * `billing_credit_reservations`, `billing_credit_ledger` and
 * `billing_credit_allocations` carry select policies and deliberately no write
 * policy for any authenticated client, so a hold taken with the caller's
 * cookie-scoped client is refused with `42501`. Ownership is not taken from the
 * caller's arguments either: `resolveBillingOwner` reads it from the persisted
 * project row (Rule 53).
 */

/** The reservation identity of one Deep Scan attempt. */
export function deepScanIdempotencyKey(sessionId: string): string {
  return `deep-scan:${sessionId}`;
}

/**
 * Holds the price of an additional Deep Scan before any browser is created.
 *
 * ## Why the access mode is a parameter and not something this looks up
 *
 * `authorizeOperationCredits` resolves the retail price of `deep_scan` and
 * knows nothing about entitlements — it would hold 25 Credits for *every* scan,
 * including the one the project is entitled to. Whether this particular scan is
 * the included one was decided by `authorizeDeepScan`, from the existence of a
 * persisted snapshot, and that decision is the only correct answer to the
 * question. Re-deriving it here would be a second answer, and the failure mode
 * is charging somebody for their free scan.
 *
 * So the caller passes what the entitlement decided, and an included scan
 * returns `{ ok: true, billable: false }` without touching the billing
 * machinery at all — the same free path `retail.ts`'s `free` operations take,
 * and for the same reason: there is no amount to reserve.
 */
export async function holdDeepScanCredits(params: {
  projectId: string;
  sessionId: string;
  /** What `authorizeDeepScan` decided this scan is paid for by. */
  accessMode: DeepScanAccessMode;
}): Promise<AuthorizeOperationCreditsResult> {
  if (params.accessMode !== "credits") return { ok: true, billable: false };

  return authorizeOperationCredits(createServiceClient(), {
    projectId: params.projectId,
    operation: "deep_scan",
    idempotencyKey: deepScanIdempotencyKey(params.sessionId),
    // Deliberately null. A Deep Scan is not a durable operation — it has no row
    // in `operation_runs` and no `OPERATION_TYPES` entry — and inventing one to
    // satisfy a foreign key would put a fake operation in a customer's history.
    // `billing_credit_reservations_single_active_operation_idx` is partial on
    // `operation_run_id is not null`, so nothing here weakens it; one live
    // browser per project is already enforced by the entitlement.
    operationRunId: null,
  });
}

/** The hold taken for one Deep Scan attempt, or null when there was none. */
async function reservationFor(
  supabase: ReturnType<typeof createServiceClient>,
  params: { projectId: string; sessionId: string },
): Promise<{ id: string; status: string; rateCardVersion: string | null } | null> {
  const owner = await resolveBillingOwner(supabase, params.projectId);
  if (!owner) return null;

  const account = await findCreditAccountByUser(supabase, owner.userId);
  if (!account) return null;

  const reservation = await findReservationByIdempotencyKey(supabase, {
    creditAccountId: account.id,
    idempotencyKey: deepScanIdempotencyKey(params.sessionId),
  });

  return reservation
    ? {
        id: reservation.id,
        status: reservation.status,
        rateCardVersion: reservation.rateCardVersion,
      }
    : null;
}

/**
 * Charges an additional Deep Scan, once, after its snapshot was persisted.
 *
 * The policy version is read back off the hold rather than resolved again. A
 * charge must name the policy that *produced* it (retail §38), and a scan that
 * started under one policy and finished after a price change would otherwise be
 * recorded under a policy that never priced it. The reservation is the only
 * place that fact survives.
 *
 * Idempotent through `settleOperationCredits`, which returns the existing
 * charge for an already-settled hold rather than taking a second one.
 */
export async function settleDeepScanCredits(params: {
  projectId: string;
  sessionId: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const reservation = await reservationFor(supabase, params);
  if (!reservation || reservation.status !== "active") return;

  await settleOperationCredits(supabase, {
    reservationId: reservation.id,
    policyVersion: reservation.rateCardVersion ?? "unknown",
  });
}

/**
 * Gives back the hold on any outcome that did not persist a snapshot.
 *
 * Safe to call on a scan that was never billable and on one already closed:
 * `releaseOperationCredits` refuses a non-active reservation rather than
 * handing capacity back twice, and a missing reservation is simply nothing to
 * release.
 */
export async function releaseDeepScanCredits(params: {
  projectId: string;
  sessionId: string;
  reason: ReleaseReason;
}): Promise<void> {
  const supabase = createServiceClient();
  const reservation = await reservationFor(supabase, params);
  if (!reservation || reservation.status !== "active") return;

  await releaseOperationCredits(supabase, {
    reservationId: reservation.id,
    reason: params.reason,
  });
}
