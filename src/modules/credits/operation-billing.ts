import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { sweepExpiredCredits } from "./grants";
import {
  allocateReservation,
  listActiveLots,
  listReservationAllocations,
  releaseReservationAllocations,
  settleReservationAllocations,
} from "./lot-store";
import { spendableCapacity } from "./lots";
import { retailChargeFor, type RetailChargeResolution, type RetailOperationKind } from "./retail";
import { releaseReservation, resolveBillingOwner, settleReservation } from "./service";
import { claimReservation, ensureCreditAccount, getReservation } from "./store";
import { creditUnits, type CreditUnits, ZERO_CREDITS } from "./units";
import type { ReleaseReason } from "./balance";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * Charging a customer for a predictable operation
 * (BILLING CORE-2 §39, §40, §41, §42, §43, §44, §45, §90).
 *
 * ## The shape, and why every step is in this order
 *
 * ```
 * sweep expired lots     so the balance being checked is honest
 *   → resolve fixed price   from the versioned retail policy, never from usage
 *     → reserve             the atomic account-level gate (Core-1, unchanged)
 *       → allocate          which lots fund it, expiring-soonest first
 *         → run             the operation, entirely unaware of billing
 *           → settle        exactly once, at the fixed price, on success
 *           → release       on any failure, per the approved failure policy
 * ```
 *
 * Reservation happens **before** the provider is called, which is the whole
 * point of §43: discovering an empty wallet after paying Anthropic is both a
 * cost leak and an insult. And it is a reservation rather than a charge because
 * an operation that fails must cost the customer nothing (§45) — a charge would
 * have to be refunded, and a refund of a fixed-price failure is a worse record
 * of what happened than a release.
 *
 * ## What this module deliberately does not do
 *
 * It does not decide whether an operation may run — entitlements do that, and
 * they run first. It does not know what an audit is. It does not vary a price
 * by how many tokens a run consumed (§88). Provider usage continues to be
 * measured independently, for Vibe's economics rather than the customer's bill.
 */

/* ---------------------------------------------------------------------------
 * Authorization
 * ------------------------------------------------------------------------ */

export type OperationCreditRefusal =
  | "insufficient_credits"
  | "account_suspended"
  | "account_not_found"
  /**
   * The policy in force sells no such operation.
   *
   * Distinct from every other refusal and from the free path, because it is the
   * only one that is about the *catalogue* rather than about this customer. It
   * exists because `retail-v1` genuinely did not price Deep Scan or the Agent,
   * and a policy that says so must refuse rather than run them for nothing —
   * see `retail.ts`'s `not_priced`.
   */
  | "operation_not_priced";

/**
 * Operations that can hold a Credit reservation.
 *
 * One book, the customer rate card. This used to be a union of two — retail
 * plus an internal CORE-4 dogfood ceiling that carried no production price —
 * and the union was the point while an Agent run had no approved price to
 * charge. `launch-v1` gave it one and [ADR 0092](../../../docs/decisions/0092-the-agent-runs-as-the-product.md) removed the second book,
 * so there is nothing left to distinguish at a call site.
 */
export type BillableOperationKind = RetailOperationKind;

/**
 * What one operation costs, from whichever book governs it.
 *
 * Three outcomes, not two. `free` and `not_priced` were once the same `null`,
 * and the collapse was safe only while the operations that could be unpriced
 * — Deep Scan and the Agent — could not reach this function at all. Under
 * `launch-v1` they can, so the difference has to be carried: `free` runs and
 * charges nothing, `not_priced` refuses. Conflating them would run the most
 * expensive operation Vibe has for nothing, under a policy that never sold it.
 */
function chargeFor(
  operation: BillableOperationKind,
  now: Date,
  pricingClass: ExecutionPricingClass | null,
): RetailChargeResolution {
  return retailChargeFor(operation, now, { pricingClass });
}

export type AuthorizeOperationCreditsResult =
  /** The operation is free. Nothing is reserved and nothing will be charged. */
  | { ok: true; billable: false }
  | {
      ok: true;
      billable: true;
      reservationId: string;
      requiredCredits: CreditUnits;
      policyVersion: string;
      /** True when this exact request already held a reservation (§78). */
      alreadyHeld: boolean;
    }
  | {
      ok: false;
      refusal: OperationCreditRefusal;
      /** What the operation costs, so the UI can say "you need 35" (§43). */
      requiredCredits: CreditUnits;
      /** What the customer actually has right now. */
      availableCredits: CreditUnits;
    };

/**
 * Reserves the fixed price of a new billable operation.
 *
 * ## Idempotency, and the double-click it exists to survive (§78)
 *
 * `idempotencyKey` must identify the *unit of new work* — for Vibe's
 * operations, the operation run id. Two clicks that resolve to the same run
 * produce the same key, and Core-1's unique index turns the second into a
 * lookup of the first rather than a second hold. A user cannot spend 70 Credits
 * by clicking twice.
 *
 * ## Why allocation can refuse after the account gate admitted
 *
 * The account gate counts every posted Credit; the lot allocator counts only
 * Credits that are spendable *now*. A lapsed-but-unswept lot is the gap between
 * them, and the allocator is the authority. When it refuses, the hold is
 * released immediately — leaving it would reserve capacity no lot can fund.
 */
export async function authorizeOperationCredits(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    operation: BillableOperationKind;
    idempotencyKey: string;
    operationRunId?: string | null;
    /**
     * Required exactly when the operation is priced per execution class.
     *
     * Never defaulted — `retailChargeFor` throws rather than pick a tier, and
     * this parameter exists so that the throw happens at a call site that can
     * be read, rather than deep inside a reservation.
     */
    pricingClass?: ExecutionPricingClass | null;
    /**
     * The quote this hold acts on, when one was recorded.
     *
     * Stored on the reservation so "you approved 200" is answerable from the
     * hold itself rather than by joining on a timestamp (ADR 0024 §4).
     */
    quoteId?: string | null;
    now?: Date;
  },
): Promise<AuthorizeOperationCreditsResult> {
  const now = params.now ?? new Date();

  const resolved = chargeFor(params.operation, now, params.pricingClass ?? null);

  // Free operations never touch the billing machinery at all — no reservation,
  // no zero-Credit charge, no entry in the customer's history (§56).
  if (resolved.kind === "free") return { ok: true, billable: false };

  if (resolved.kind === "not_priced") {
    return {
      ok: false,
      refusal: "operation_not_priced",
      requiredCredits: ZERO_CREDITS,
      availableCredits: ZERO_CREDITS,
    };
  }

  const price = resolved;

  const owner = await resolveBillingOwner(supabase, params.projectId);
  if (!owner) {
    return {
      ok: false,
      refusal: "account_not_found",
      requiredCredits: price.creditUnits,
      availableCredits: ZERO_CREDITS,
    };
  }

  const { account } = await ensureCreditAccount(supabase, owner.userId);

  // Before anything is measured, make the balance honest. An unswept lapsed lot
  // would otherwise let a customer reserve Credits that died yesterday.
  await sweepExpiredCredits(supabase, {
    userId: owner.userId,
    creditAccountId: account.id,
    now,
  });

  const claim = await claimReservation(supabase, {
    // Re-read: the sweep may have moved the balance this claim is evaluated
    // against, and a stale `posted_credits` would be checked against the wrong
    // number.
    account: (await ensureCreditAccount(supabase, owner.userId)).account,
    reservedCredits: price.creditUnits,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId,
    operationRunId: params.operationRunId ?? null,
    quoteId: params.quoteId ?? null,
    /*
     * The policy that produced `price`, written onto the hold that carries it.
     *
     * `billing_credit_reservations` has had a `rate_card_version` column since
     * the table did and nothing ever passed one, so every reservation carried
     * null and the settlement had nothing to read — which is how a literal
     * `"retail-v1"` came to be its fallback, and why eleven production charges
     * name a card that cannot explain their amount. The version was already
     * resolved and audit-logged one call below; only the row never got it.
     */
    rateCardVersion: price.policyVersion,
  });

  if (!claim.ok) {
    return {
      ok: false,
      refusal: claim.refusal === "invalid_amount" ? "insufficient_credits" : claim.refusal,
      requiredCredits: price.creditUnits,
      availableCredits: await availableSpendableCredits(supabase, account.id, now),
    };
  }

  // A retry of the same request. The hold exists; whether its allocations do is
  // a separate question, and the answer used to be assumed (§I2).
  //
  // `claimReservation` inserts the reservation before `admitHold`, and the
  // allocation happens after the claim returns, so an active hold with no lots
  // behind it is a state two ordinary windows produce: a crash between the two
  // calls, and a concurrent caller landing on this idempotency key. Settling
  // such a hold charges full price while `settleReservationAllocations` finds
  // nothing held and returns immediately — a charge with no lot provenance.
  //
  // So the branch classifies rather than guesses. Allocating on an empty set is
  // safe only because `allocateReservation` unwinds every non-commit exit,
  // which is what makes zero rows mean zero capacity taken; an unexpected
  // partial state is refused rather than allocated on top of.
  if (claim.alreadyHeld) {
    const held = await listReservationAllocations(supabase, claim.reservation.id);
    const heldUnits = held
      .filter((allocation) => allocation.status === "held")
      .reduce<number>((total, allocation) => total + allocation.creditUnits, 0);

    if (held.length > 0 && heldUnits !== price.creditUnits) {
      // Neither complete nor empty. Nothing in this codebase produces it, so
      // acting would be inventing a recovery for a state nobody has explained.
      return {
        ok: false,
        refusal: "insufficient_credits",
        requiredCredits: price.creditUnits,
        availableCredits: await availableSpendableCredits(supabase, account.id, now),
      };
    }

    if (held.length === 0) {
      const recovered = await allocateReservation(supabase, {
        creditAccountId: account.id,
        reservationId: claim.reservation.id,
        creditUnits: price.creditUnits,
        now,
      });

      if (!recovered.ok) {
        await releaseReservation(supabase, {
          reservationId: claim.reservation.id,
          reason: "cancelled_before_usage",
        });

        return {
          ok: false,
          refusal: "insufficient_credits",
          requiredCredits: price.creditUnits,
          availableCredits: await availableSpendableCredits(supabase, account.id, now),
        };
      }
    }

    return {
      ok: true,
      billable: true,
      reservationId: claim.reservation.id,
      requiredCredits: price.creditUnits,
      policyVersion: price.policyVersion,
      alreadyHeld: true,
    };
  }

  const allocated = await allocateReservation(supabase, {
    creditAccountId: account.id,
    reservationId: claim.reservation.id,
    creditUnits: price.creditUnits,
    now,
  });

  if (!allocated.ok) {
    await releaseReservation(supabase, {
      reservationId: claim.reservation.id,
      reason: "cancelled_before_usage",
    });

    return {
      ok: false,
      refusal: "insufficient_credits",
      requiredCredits: price.creditUnits,
      availableCredits: await availableSpendableCredits(supabase, account.id, now),
    };
  }

  await recordAuditEvent(supabase, {
    userId: owner.userId,
    projectId: params.projectId,
    eventType: "billing.operation_reserved",
    metadata: {
      projectId: params.projectId,
      reservationId: claim.reservation.id,
      operation: params.operation,
      credits: price.creditUnits,
      policyVersion: price.policyVersion,
    },
  });

  return {
    ok: true,
    billable: true,
    reservationId: claim.reservation.id,
    requiredCredits: price.creditUnits,
    policyVersion: price.policyVersion,
    alreadyHeld: false,
  };
}

/** Credits that can actually fund new work at this instant. */
export async function availableSpendableCredits(
  supabase: SupabaseClient,
  creditAccountId: string,
  now: Date = new Date(),
): Promise<CreditUnits> {
  const lots = await listActiveLots(supabase, creditAccountId);
  return spendableCapacity(lots, now);
}

/* ---------------------------------------------------------------------------
 * Settlement
 * ------------------------------------------------------------------------ */

/**
 * Charges a delivered operation exactly once (§39, §79).
 *
 * Settles at the reserved fixed price, because that *is* the price — a Class A
 * operation's cost does not vary with what the provider happened to consume.
 * The allocation rows are then resolved so each lot records what it funded.
 *
 * Idempotent throughout: `settleReservation` finds an existing charge by its
 * idempotency key and posts nothing, and the allocation update is guarded on
 * `status = 'held'`. A retried settlement charges once.
 */
export async function settleOperationCredits(
  supabase: SupabaseClient,
  params: { reservationId: string; policyVersion: string | null },
): Promise<{ ok: true; chargedCredits: CreditUnits; alreadySettled: boolean } | { ok: false; refusal: string }> {
  const reservation = await getReservation(supabase, params.reservationId);
  if (!reservation) return { ok: false, refusal: "reservation_not_found" };

  // Already terminal — a retry. The charge that exists is the answer.
  if (reservation.status === "settled") {
    return {
      ok: true,
      chargedCredits: reservation.settledCredits ?? ZERO_CREDITS,
      alreadySettled: true,
    };
  }

  // Allocations are settled before the reservation is closed, mirroring the
  // order `settleReservation` already uses for the charge: a crash between the
  // two leaves recoverable over-holding rather than a lost charge.
  await settleReservationAllocations(supabase, {
    reservationId: params.reservationId,
    actualCredits: reservation.reservedCredits,
  });

  const settled = await settleReservation(supabase, {
    reservationId: params.reservationId,
    actualCredits: reservation.reservedCredits,
    rateCardVersion: params.policyVersion,
  });

  if (!settled.ok) return { ok: false, refusal: settled.refusal };

  return {
    ok: true,
    chargedCredits: settled.chargedCredits,
    alreadySettled: settled.alreadySettled,
  };
}

/* ---------------------------------------------------------------------------
 * Release
 * ------------------------------------------------------------------------ */

/**
 * Returns a hold when an operation did not deliver (§45, §80).
 *
 * ## The approved V1 failure policy, applied
 *
 * CREDIT_ECONOMICS.md §Failure policy: a Vibe/system failure, a provider
 * failure, and an operation that produced no usable result are all **0 charged,
 * Vibe absorbs**. The reasoning it records is that the amounts are individually
 * small and the trust cost of billing someone for Vibe's own bug is large and
 * asymmetric — and this function is where that becomes true rather than
 * aspirational.
 *
 * Provider usage that really happened stays attributable: the release reason
 * `abandoned_with_usage` records that Vibe paid Anthropic even though the
 * customer did not pay Vibe. Internal cost and customer price are separate
 * facts and Core-1 deliberately refuses to let a release pretend otherwise.
 *
 * Fixed-price operations have no partial charge. The document's partial-charge
 * rule is written for usage-based settlement — "settle at actual usage to the
 * point of cancellation" — and a Class A operation has no per-unit usage to
 * settle at: it either delivered a result or it did not. Cancelling one
 * therefore returns the whole hold. The partial path stays available for the
 * quote-based Agent operations that will need it.
 */
export async function releaseOperationCredits(
  supabase: SupabaseClient,
  params: { reservationId: string; reason: ReleaseReason },
): Promise<{ ok: true; releasedCredits: CreditUnits; alreadyClosed: boolean } | { ok: false; refusal: string }> {
  const reservation = await getReservation(supabase, params.reservationId);
  if (!reservation) return { ok: false, refusal: "reservation_not_found" };

  // Checked before the lots are touched, matching the `settled` pre-check its
  // settle counterpart has always had. Without it, releasing a reservation that
  // was already charged walked its allocations first, handed their capacity
  // back for a hold the customer had paid for, and only then noticed the
  // reservation was not active — reporting success either way.
  if (reservation.status !== "active") {
    return { ok: false, refusal: `reservation_${reservation.status}` };
  }

  await releaseReservationAllocations(supabase, params.reservationId);

  const released = await releaseReservation(supabase, {
    reservationId: params.reservationId,
    reason: params.reason,
  });

  if (!released.ok) return { ok: false, refusal: released.refusal };

  return {
    ok: true,
    releasedCredits: released.releasedCredits,
    alreadyClosed: released.alreadyClosed,
  };
}

/**
 * Finds the live hold for an operation run, if any.
 *
 * Lets a completion path settle without threading a reservation id through the
 * durable workflow's state — the operation run id is already there, and the
 * reservation is discoverable from it.
 */
export async function findOperationReservation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<{
  id: string;
  reservedCredits: CreditUnits;
  status: string;
  /** The policy that priced this hold, so the charge can be stamped with it. */
  rateCardVersion: string | null;
} | null> {
  const { data, error } = await supabase
    .from("billing_credit_reservations")
    .select("id, reserved_credits, status, rate_card_version")
    .eq("operation_run_id", operationRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as {
    id: string;
    reserved_credits: number;
    status: string;
    rate_card_version: string | null;
  };
  return {
    id: row.id,
    reservedCredits: creditUnits(row.reserved_credits),
    status: row.status,
    rateCardVersion: row.rate_card_version,
  };
}
