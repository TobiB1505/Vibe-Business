import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizeOperationCredits,
  availableSpendableCredits,
  findOperationReservation,
  releaseOperationCredits,
  settleOperationCredits,
} from "@/modules/credits/operation-billing";
import { resolveBillingOwner } from "@/modules/credits/service";
import { retailChargeFor, type RetailOperationKind } from "@/modules/credits/retail";
import { ensureCreditAccount } from "@/modules/credits/store";
import { ZERO_CREDITS, type CreditUnits } from "@/modules/credits/units";

/**
 * Where billing meets a durable operation (BILLING CORE-2 §39–§45, §77, §78,
 * §79, §80, §81).
 *
 * ## The seam, and what stays on each side of it
 *
 * Billing knows nothing about what an audit is. Operations know nothing about
 * lots, allocation or expiry. What crosses between them is three questions:
 *
 * ```
 * before the work    can this be funded, and hold the price
 * work delivered     charge exactly once
 * work failed        give the hold back
 * ```
 *
 * Nothing about audit, opportunity or planner *reasoning* changes — no prompt,
 * no rubric, no schema, no model. Billing wraps the operation boundary and
 * stops there (§103).
 *
 * ## Reading is never charged (§42, §81)
 *
 * This module is called from exactly one place in each start path: after the
 * reuse check and the already-active check, both of which return earlier.
 * Opening a stored audit, reloading a page, navigating to an existing
 * Opportunity Set or Action Plan therefore cannot reach a reservation, because
 * those paths never get this far. Billing follows new work, not requests.
 */

export type OperationBillingRefusal = {
  refusal: "insufficient_credits";
  requiredCredits: CreditUnits;
  availableCredits: CreditUnits;
};

export type OperationBillingHold =
  | { billable: false }
  | { billable: true; reservationId: string; requiredCredits: CreditUnits; policyVersion: string };

/**
 * Whether a customer can afford an operation, before anything is created.
 *
 * A cheap read, not the authority. It exists so the common refusal does not
 * leave a failed operation row behind, and so the UI can answer "you need 35,
 * you have 20" without starting anything. The real gate is the reservation —
 * this check can be stale by the time it returns, and the reservation cannot.
 */
export async function checkOperationAffordability(
  supabase: SupabaseClient,
  params: { projectId: string; operation: RetailOperationKind; now?: Date },
): Promise<{ ok: true } | OperationBillingRefusal> {
  const now = params.now ?? new Date();
  const price = retailChargeFor(params.operation, now);
  if (!price) return { ok: true };

  const owner = await resolveBillingOwner(supabase, params.projectId);
  if (!owner) {
    return {
      refusal: "insufficient_credits",
      requiredCredits: price.creditUnits,
      availableCredits: ZERO_CREDITS,
    };
  }

  const { account } = await ensureCreditAccount(supabase, owner.userId);
  const available = await availableSpendableCredits(supabase, account.id, now);

  if (available < price.creditUnits) {
    return {
      refusal: "insufficient_credits",
      requiredCredits: price.creditUnits,
      availableCredits: available,
    };
  }

  return { ok: true };
}

/**
 * Holds an operation's price before any provider work begins (§39, §43, §78).
 *
 * The idempotency key is the operation run id, which is what makes a
 * double-click safe: the second click loses the operation's own
 * `operation_runs_single_active_idx` and never reaches here, and if it somehow
 * did, the same key would return the same hold rather than take a second one.
 * Two clicks cannot spend 70 Credits.
 */
export async function holdOperationCredits(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    operationRunId: string;
    operation: RetailOperationKind;
    now?: Date;
  },
): Promise<{ ok: true; hold: OperationBillingHold } | { ok: false } & OperationBillingRefusal> {
  const authorized = await authorizeOperationCredits(supabase, {
    projectId: params.projectId,
    operation: params.operation,
    idempotencyKey: `operation:${params.operationRunId}`,
    operationRunId: params.operationRunId,
    now: params.now,
  });

  if (!authorized.ok) {
    return {
      ok: false,
      refusal: "insufficient_credits",
      requiredCredits: authorized.requiredCredits,
      availableCredits: authorized.availableCredits,
    };
  }

  if (!authorized.billable) return { ok: true, hold: { billable: false } };

  return {
    ok: true,
    hold: {
      billable: true,
      reservationId: authorized.reservationId,
      requiredCredits: authorized.requiredCredits,
      policyVersion: authorized.policyVersion,
    },
  };
}

/**
 * Charges a delivered operation (§39, §79).
 *
 * Called from the operation's own terminal completion transition, which is
 * already guarded so it runs at most once — so this inherits exactly-once from
 * the transition, and is idempotent underneath it anyway.
 *
 * A free operation has no reservation and this is a no-op; that is the same
 * code path, not a special case, because `findOperationReservation` simply
 * finds nothing.
 */
export async function settleOperationBilling(
  supabase: SupabaseClient,
  params: { operationRunId: string; policyVersion?: string },
): Promise<void> {
  const reservation = await findOperationReservation(supabase, params.operationRunId);
  if (!reservation || reservation.status !== "active") return;

  await settleOperationCredits(supabase, {
    reservationId: reservation.id,
    // The policy that priced the hold. Stored on the charge so history never
    // re-rates under a future card (§38).
    policyVersion: params.policyVersion ?? "retail-v1",
  });
}

/**
 * Returns a hold when an operation did not deliver (§45, §80).
 *
 * The approved V1 failure policy: a Vibe failure, a provider failure, and an
 * operation that produced no usable result are all 0 charged. The customer
 * keeps their Credits; Vibe absorbs whatever it already paid the provider.
 *
 * `abandoned_with_usage` records the honest version of that when inference had
 * already run — real provider spend happened, and the release refuses to
 * pretend it did not, even though the customer is not charged for it.
 */
export async function releaseOperationBilling(
  supabase: SupabaseClient,
  params: { operationRunId: string; providerUsageOccurred?: boolean },
): Promise<void> {
  const reservation = await findOperationReservation(supabase, params.operationRunId);
  if (!reservation || reservation.status !== "active") return;

  await releaseOperationCredits(supabase, {
    reservationId: reservation.id,
    reason: params.providerUsageOccurred ? "abandoned_with_usage" : "failed_without_usage",
  });
}
