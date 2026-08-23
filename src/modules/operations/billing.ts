import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReleaseReason } from "@/modules/credits/balance";
import {
  authorizeOperationCredits,
  availableSpendableCredits,
  findOperationReservation,
  releaseOperationCredits,
  settleOperationCredits,
} from "@/modules/credits/operation-billing";
import { resolveBillingOwner } from "@/modules/credits/service";
import { retailChargeFor, type RetailOperationKind } from "@/modules/credits/retail";
import { findCreditAccountByUser } from "@/modules/credits/store";
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

/** What an operation costs and whether the wallet covers it, right now. */
export type OperationCreditCost = {
  requiredCredits: CreditUnits;
  availableCredits: CreditUnits;
  affordable: boolean;
};

/**
 * The price of an operation and the balance behind it, or null when it is free.
 *
 * Both numbers, unconditionally — which is the difference between this and
 * {@link checkOperationAffordability}. A screen that can only learn the price
 * at the moment it is refused cannot say "another one costs 35 Credits" while
 * the customer can still afford it, and that gap is exactly what produced a
 * disabled button claiming Credits were unavailable next to a funded account.
 *
 * Deliberately **read-only**: it looks the wallet up rather than ensuring one.
 * This runs during page render, and rendering a price must not mint a billing
 * account as a side effect — a customer who has never spent anything simply has
 * a balance of zero, which is the true answer and the one the start path will
 * reach anyway.
 */
export async function resolveOperationCreditCost(
  supabase: SupabaseClient,
  params: { projectId: string; operation: RetailOperationKind; now?: Date },
): Promise<OperationCreditCost | null> {
  const now = params.now ?? new Date();
  const price = retailChargeFor(params.operation, now);
  if (!price) return null;

  const owner = await resolveBillingOwner(supabase, params.projectId);
  const account = owner ? await findCreditAccountByUser(supabase, owner.userId) : null;
  const availableCredits = account
    ? await availableSpendableCredits(supabase, account.id, now)
    : ZERO_CREDITS;

  return {
    requiredCredits: price.creditUnits,
    availableCredits,
    affordable: availableCredits >= price.creditUnits,
  };
}

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
  const cost = await resolveOperationCreditCost(supabase, params);
  if (!cost || cost.affordable) return { ok: true };

  return {
    refusal: "insufficient_credits",
    requiredCredits: cost.requiredCredits,
    availableCredits: cost.availableCredits,
  };
}

/**
 * Holds an operation's price before any provider work begins (§39, §43, §78).
 *
 * The idempotency key defaults to the operation run id, which is what makes a
 * double-click safe: the second click loses the operation's own
 * `operation_runs_single_active_idx` and never reaches here, and if it somehow
 * did, the same key would return the same hold rather than take a second one.
 * Two clicks cannot spend 70 Credits.
 *
 * `idempotencyKey` overrides that default only for an operation that
 * legitimately takes more than one hold across its lifetime — today, only a
 * business-audit re-acquiring its hold after a pause released it (ADR 0041
 * §P2). The default key cannot be reused there: it would find the first
 * (now released) reservation and replay it rather than taking a fresh one.
 */
export async function holdOperationCredits(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    operationRunId: string;
    operation: RetailOperationKind;
    now?: Date;
    idempotencyKey?: string;
  },
): Promise<{ ok: true; hold: OperationBillingHold } | { ok: false } & OperationBillingRefusal> {
  const authorized = await authorizeOperationCredits(supabase, {
    projectId: params.projectId,
    operation: params.operation,
    idempotencyKey: params.idempotencyKey ?? `operation:${params.operationRunId}`,
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
 * Whether Credits are currently held for this operation (§39, §43).
 *
 * The durable, server-side proof that a customer already paid to run something
 * their entitlement does not include. A workflow step revalidates its premises
 * against live state rather than trusting anything carried across the step
 * boundary — and re-asking the *entitlement* alone gets the wrong answer for a
 * paid run, because the entitlement is genuinely spent and saying so would fail
 * an operation whose price is already reserved.
 *
 * `active` and nothing else: a released hold funded nothing, and a settled one
 * belongs to work that already completed.
 */
export async function operationHasCreditHold(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<boolean> {
  const reservation = await findOperationReservation(supabase, operationRunId);
  return reservation?.status === "active";
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
 *
 * `reason` overrides the `providerUsageOccurred`-derived default for a release
 * neither of its two outcomes describes — today, only a paused operation
 * releasing its hold before any provider call for the pause's own reason
 * (`cancelled_before_usage`, ADR 0041 §P2): stopping to ask a question is
 * neither a failure nor abandonment, and forcing it through the boolean would
 * misrecord why the Credits came back.
 */
export async function releaseOperationBilling(
  supabase: SupabaseClient,
  params: { operationRunId: string; providerUsageOccurred?: boolean; reason?: ReleaseReason },
): Promise<void> {
  const reservation = await findOperationReservation(supabase, params.operationRunId);
  if (!reservation || reservation.status !== "active") return;

  await releaseOperationCredits(supabase, {
    reservationId: reservation.id,
    reason: params.reason ?? (params.providerUsageOccurred ? "abandoned_with_usage" : "failed_without_usage"),
  });
}
