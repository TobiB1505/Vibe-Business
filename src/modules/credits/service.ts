import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  decideRefund,
  decideRelease,
  decideSettlement,
  reconcileBalance,
  totalRefunded,
  type ReleaseReason,
} from "./balance";
import { rateUsage, type CreditRateCard } from "./rating";
import type {
  BillableUsage,
  CreditBalance,
  ReservationRefusal,
  SettlementRefusal,
} from "./schema";
import {
  claimReservation,
  closeReservation,
  ensureCreditAccount,
  findCreditAccountByUser,
  findLedgerEntryByIdempotencyKey,
  getCreditBalance,
  getReservation,
  listActiveReservations,
  listLedgerEntries,
  postLedgerEntry,
  type CreditReservation,
} from "./store";
import { creditUnits, type CreditUnits, ZERO_CREDITS } from "./units";

/**
 * The billing domain API (BILLING CORE-1 §36).
 *
 * Callers get these operations and nothing lower-level. There is deliberately
 * no `updateBalance`, no `insertLedgerRow` and no `setReservationStatus`
 * exported to the rest of the application: the invariants belong to this
 * module, and an API that let a caller move a balance directly would make
 * every guarantee in `balance.ts` advisory.
 *
 * ## Ownership is derived, never accepted
 *
 * Every function here resolves the economic owner from `projects.user_id` (or
 * from an already-authenticated session), never from a parameter a caller
 * supplied. A caller cannot say "charge this account" — that is §55 and §56,
 * and it is the difference between a billing system and a way to bill somebody
 * else.
 *
 * ## What is wired, and what is still inert
 *
 * This block used to say that nothing here was called in production. That was
 * true for one sprint. Billing Core 2 wired it: `credits/operation-billing.ts`
 * calls `reserveCredits`, `settleReservation` and `releaseReservation`, and
 * `operations/billing.ts` wraps every durable operation start path, so an
 * audit, an opportunity set, an action plan and an agent execution each reserve
 * before provider work and settle or release after it.
 *
 * What is still inert is one level up and is a *pricing* fact, not a wiring
 * one: `CREDIT_RATE_CARDS` in `rating.ts` is `[]`, so `retailChargeFor` returns
 * null for an operation with no active retail price, `authorizeOperationCredits`
 * reports `{ billable: false }`, and the reserve/settle path runs with nothing
 * to hold. The machinery is live; the prices are not, and that emptiness is
 * structural rather than a flag — see `rating.ts` and
 * `docs/business/CREDIT_PRICING_V1.md`.
 */

/* ---------------------------------------------------------------------------
 * Ownership
 * ------------------------------------------------------------------------ */

/**
 * The billing owner of a project (§56).
 *
 * A separate query rather than a trusted argument. `projects` is single-owner
 * and RLS already scopes it, but durable execution uses the service-role
 * client, which does not — so the ownership hop is made explicitly here and
 * the result is what every downstream write is keyed on.
 */
export async function resolveBillingOwner(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ userId: string } | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? { userId: (data as { user_id: string }).user_id } : null;
}

/**
 * The owner's wallet, creating it on first use and auditing that once.
 *
 * Every entry point funnels through here so `credit_account.created` has one
 * caller rather than one per financial operation — and so a race that loses
 * the unique index does not emit a second creation event for an account it
 * did not create.
 */
async function walletFor(supabase: SupabaseClient, userId: string) {
  const { account, created } = await ensureCreditAccount(supabase, userId);

  if (created) {
    await recordAuditEvent(supabase, {
      userId,
      eventType: "credit_account.created",
      metadata: { creditAccountId: account.id },
    });
  }

  return account;
}

/* ---------------------------------------------------------------------------
 * Reading
 * ------------------------------------------------------------------------ */

export type BillingBalanceView = {
  balance: CreditBalance;
  /** Whether the materialized figures still agree with the ledger (§10). */
  consistent: boolean;
};

/**
 * The customer balance read model (§35).
 *
 * Returns the balance *and* whether it reconciles, because a figure nobody
 * checks is a second source of truth. A caller that finds `consistent: false`
 * has found a real defect, not a rounding artefact — the ledger is authority
 * and the materialized figure is a cache of it.
 */
export async function getBillingBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<BillingBalanceView | null> {
  const account = await findCreditAccountByUser(supabase, userId);
  if (!account) return null;

  const [entries, reservations] = await Promise.all([
    listLedgerEntries(supabase, account.id),
    listActiveReservations(supabase, account.id),
  ]);

  const reconciliation = reconcileBalance(
    { posted: account.postedCredits, reserved: account.reservedCredits },
    entries.map((entry) => ({ kind: entry.kind, creditDelta: entry.creditDelta })),
    reservations.map((reservation) => ({ reservedCredits: reservation.reservedCredits })),
  );

  if (!reconciliation.consistent) {
    // Observable, never silent (§66). A drifted balance is a financial defect.
    console.error("[billing] materialized balance disagrees with the ledger", {
      creditAccountId: account.id,
      postedDrift: reconciliation.drift.posted,
      reservedDrift: reconciliation.drift.reserved,
    });
  }

  return {
    balance: {
      posted: account.postedCredits,
      reserved: account.reservedCredits,
      available: creditUnits(account.postedCredits - account.reservedCredits),
    },
    consistent: reconciliation.consistent,
  };
}

export { getCreditBalance };

/* ---------------------------------------------------------------------------
 * Granting — privileged only
 * ------------------------------------------------------------------------ */

export type GrantResult = { creditAccountId: string; alreadyGranted: boolean };

/**
 * Issues Credits. **Server-only, and never reachable from a client (§31).**
 *
 * There is no server action, route handler or form that calls this, and the
 * tables it writes have no insert policy — so a browser cannot reach it even
 * if one were added by mistake. Every grant carries a stated reason and an
 * idempotency key, so a retried grant issues once and an unexplained grant
 * cannot be written at all.
 */
export async function grantCredits(
  supabase: SupabaseClient,
  params: {
    userId: string;
    credits: CreditUnits;
    reason: string;
    idempotencyKey: string;
    kind?: "grant" | "purchase";
  },
): Promise<GrantResult> {
  if (params.credits <= 0) throw new Error("A grant must be positive.");
  if (params.reason.trim().length === 0) throw new Error("A grant must state a reason.");

  const account = await walletFor(supabase, params.userId);
  const { entry, alreadyPosted } = await postLedgerEntry(supabase, {
    creditAccountId: account.id,
    kind: params.kind ?? "grant",
    creditDelta: params.credits,
    idempotencyKey: params.idempotencyKey,
    reason: params.reason,
  });

  if (!alreadyPosted) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "credit_grant.posted",
      // `grantReason` rather than `reason` — see the note on the release event.
      metadata: {
        creditAccountId: account.id,
        ledgerEntryId: entry.id,
        credits: params.credits,
        grantReason: params.reason,
      },
    });
  }

  return { creditAccountId: account.id, alreadyGranted: alreadyPosted };
}

/* ---------------------------------------------------------------------------
 * Quoting
 * ------------------------------------------------------------------------ */

export type CreditQuote = {
  id: string;
  estimatedCredits: CreditUnits;
  maximumCredits: CreditUnits;
  rateCardVersion: string | null;
};

/**
 * Records an estimate and a ceiling before variable work runs (§14, §15).
 *
 * A quote authorizes nothing. It exists so a later reservation can be bound to
 * the number a customer was actually shown, which is what makes "you approved
 * up to 700" a checkable claim rather than a recollection.
 */
export async function quoteCredits(
  supabase: SupabaseClient,
  params: {
    userId: string;
    projectId: string | null;
    operationType: string;
    estimatedCredits: CreditUnits;
    maximumCredits: CreditUnits;
    rateCardVersion?: string | null;
    assumptions?: Record<string, unknown>;
    expiresAt?: string | null;
  },
): Promise<CreditQuote> {
  if (params.maximumCredits < params.estimatedCredits) {
    throw new Error("A quote's maximum must cover its estimate.");
  }

  const account = await walletFor(supabase, params.userId);
  const { data, error } = await supabase
    .from("billing_credit_quotes")
    .insert({
      credit_account_id: account.id,
      project_id: params.projectId,
      operation_type: params.operationType,
      estimated_credits: params.estimatedCredits,
      maximum_credits: params.maximumCredits,
      rate_card_version: params.rateCardVersion ?? null,
      assumptions: params.assumptions ?? {},
      status: "open",
      expires_at: params.expiresAt ?? null,
    })
    .select("id, estimated_credits, maximum_credits, rate_card_version")
    .single();

  if (error) throw error;

  const row = data as {
    id: string;
    estimated_credits: number;
    maximum_credits: number;
    rate_card_version: string | null;
  };

  return {
    id: row.id,
    estimatedCredits: creditUnits(row.estimated_credits),
    maximumCredits: creditUnits(row.maximum_credits),
    rateCardVersion: row.rate_card_version,
  };
}

/* ---------------------------------------------------------------------------
 * Reserving
 * ------------------------------------------------------------------------ */

export type ReserveResult =
  | { ok: true; reservation: CreditReservation; alreadyHeld: boolean }
  | { ok: false; refusal: ReservationRefusal };

/**
 * Holds up to a maximum before an operation starts (§11, §12).
 *
 * The owner is derived from the project, so a caller cannot reserve against
 * somebody else's balance by passing a different id.
 */
export async function reserveCredits(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    reservedCredits: CreditUnits;
    idempotencyKey: string;
    operationRunId?: string | null;
    quoteId?: string | null;
    expiresAt?: string | null;
  },
): Promise<ReserveResult> {
  const owner = await resolveBillingOwner(supabase, params.projectId);
  if (!owner) return { ok: false, refusal: "account_not_found" };

  const account = await walletFor(supabase, owner.userId);
  const result = await claimReservation(supabase, {
    account,
    reservedCredits: params.reservedCredits,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId,
    operationRunId: params.operationRunId ?? null,
    quoteId: params.quoteId ?? null,
    expiresAt: params.expiresAt ?? null,
  });

  if (result.ok && !result.alreadyHeld) {
    await recordAuditEvent(supabase, {
      userId: owner.userId,
      projectId: params.projectId,
      eventType: "credit_reservation.created",
      metadata: {
        projectId: params.projectId,
        reservationId: result.reservation.id,
        reservedCredits: params.reservedCredits,
      },
    });
  }

  return result;
}

/* ---------------------------------------------------------------------------
 * Settling
 * ------------------------------------------------------------------------ */

export type SettleResult =
  | { ok: true; chargedCredits: CreditUnits; releasedCredits: CreditUnits; alreadySettled: boolean }
  | { ok: false; refusal: SettlementRefusal; shortfall?: CreditUnits };

/**
 * Turns a finished operation into exactly one charge (§28).
 *
 * ## Order, and why it is this way round
 *
 * The charge is posted *before* the reservation is closed. Both steps are
 * idempotent, so a crash between them is recoverable in the safe direction: a
 * posted charge with a still-active hold overstates what is reserved (the
 * customer temporarily has less available than they should, and a retry
 * fixes it), whereas closing first and crashing would release the hold and
 * lose the charge — the customer would have consumed real provider spend for
 * nothing.
 *
 * A retried settlement finds the existing ledger entry by its idempotency key
 * and posts nothing. It never asks "did that HTTP call succeed?" — it reads
 * what is durably true and lets the observation decide (§27).
 */
export async function settleReservation(
  supabase: SupabaseClient,
  params: {
    reservationId: string;
    actualCredits: CreditUnits;
    rateCardVersion: string | null;
  },
): Promise<SettleResult> {
  const reservation = await getReservation(supabase, params.reservationId);
  if (!reservation) return { ok: false, refusal: "reservation_not_found" };

  const idempotencyKey = `settle:${reservation.id}`;

  // Already durably settled? Then this is a retry, and the answer is the
  // charge that already exists — not a second one.
  const existingCharge = await findLedgerEntryByIdempotencyKey(supabase, {
    creditAccountId: reservation.creditAccountId,
    idempotencyKey,
  });
  if (existingCharge) {
    return {
      ok: true,
      chargedCredits: creditUnits(-existingCharge.creditDelta),
      releasedCredits: creditUnits(reservation.reservedCredits + existingCharge.creditDelta),
      alreadySettled: true,
    };
  }

  const decision = decideSettlement(reservation, params.actualCredits);
  if (!decision.ok) return { ok: false, refusal: decision.refusal, shortfall: decision.shortfall };

  // A zero charge is a legitimate settlement, but a zero-delta ledger entry is
  // forbidden — so nothing is posted and the whole hold is simply released.
  if (params.actualCredits > 0) {
    await postLedgerEntry(supabase, {
      creditAccountId: reservation.creditAccountId,
      kind: "charge",
      creditDelta: decision.chargeDelta,
      idempotencyKey,
      projectId: reservation.projectId,
      operationRunId: reservation.operationRunId,
      reservationId: reservation.id,
      rateCardVersion: params.rateCardVersion,
    });
  }

  await closeReservation(supabase, {
    reservationId: reservation.id,
    creditAccountId: reservation.creditAccountId,
    heldCredits: reservation.reservedCredits,
    status: "settled",
    settledCredits: params.actualCredits,
    rateCardVersion: params.rateCardVersion,
  });

  await recordAuditEvent(supabase, {
    userId: (await accountOwner(supabase, reservation.creditAccountId)) ?? "",
    projectId: reservation.projectId,
    eventType: "credit_charge.settled",
    metadata: {
      projectId: reservation.projectId,
      reservationId: reservation.id,
      chargedCredits: params.actualCredits,
    },
  });

  return {
    ok: true,
    chargedCredits: params.actualCredits,
    releasedCredits: decision.releasedCredits,
    alreadySettled: false,
  };
}

async function accountOwner(supabase: SupabaseClient, creditAccountId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("billing_credit_accounts")
    .select("user_id")
    .eq("id", creditAccountId)
    .maybeSingle();

  if (error) return null;
  return data ? (data as { user_id: string }).user_id : null;
}

/* ---------------------------------------------------------------------------
 * Releasing
 * ------------------------------------------------------------------------ */

export type ReleaseResult =
  | { ok: true; releasedCredits: CreditUnits; usageOutstanding: boolean; alreadyClosed: boolean }
  | { ok: false; refusal: SettlementRefusal };

/**
 * Gives back an unused hold (§29).
 *
 * `abandoned_with_usage` is persisted rather than flattened into "released",
 * because an operation that failed after spending real provider money is not
 * the same event as one that was cancelled before it started — and Core 1
 * deliberately does not decide which of them a customer ultimately pays for.
 */
export async function releaseReservation(
  supabase: SupabaseClient,
  params: { reservationId: string; reason: ReleaseReason },
): Promise<ReleaseResult> {
  const reservation = await getReservation(supabase, params.reservationId);
  if (!reservation) return { ok: false, refusal: "reservation_not_found" };

  const decision = decideRelease(reservation, params.reason);
  if (!decision.ok) {
    // Already closed by someone else — a retry, not a failure.
    if (reservation.status !== "active") {
      return { ok: true, releasedCredits: ZERO_CREDITS, usageOutstanding: false, alreadyClosed: true };
    }
    return { ok: false, refusal: decision.refusal };
  }

  const { closed } = await closeReservation(supabase, {
    reservationId: reservation.id,
    creditAccountId: reservation.creditAccountId,
    heldCredits: reservation.reservedCredits,
    status: params.reason === "expired" ? "expired" : "released",
    releaseReason: params.reason,
  });

  if (closed) {
    await recordAuditEvent(supabase, {
      userId: (await accountOwner(supabase, reservation.creditAccountId)) ?? "",
      projectId: reservation.projectId,
      eventType: "credit_reservation.released",
      // `releaseReason`, not `reason`: the activity feed allowlists `reason`
      // and would render this raw enum ("abandoned_with_usage") into
      // customer-facing UI. Billing metadata stays off that allowlist
      // entirely until there is a billing surface designed to show it (§58).
      metadata: {
        projectId: reservation.projectId,
        reservationId: reservation.id,
        releaseReason: params.reason,
        usageOutstanding: decision.usageOutstanding,
      },
    });
  }

  return {
    ok: true,
    releasedCredits: decision.releasedCredits,
    usageOutstanding: decision.usageOutstanding,
    alreadyClosed: !closed,
  };
}

/* ---------------------------------------------------------------------------
 * Refunding
 * ------------------------------------------------------------------------ */

export type RefundResult =
  | { ok: true; refundedCredits: CreditUnits; alreadyRefunded: boolean }
  | { ok: false; refusal: "invalid_amount" | "exceeds_original_charge" | "charge_not_found" };

/**
 * Posts a compensating entry against an earlier charge (§30).
 *
 * Never deletes or edits the charge. Both entries stay in history, and the
 * balance is restored by addition — which is the only form of correction an
 * auditor can verify after the fact.
 */
export async function refundCharge(
  supabase: SupabaseClient,
  params: {
    chargeLedgerEntryId: string;
    credits: CreditUnits;
    reason: string;
    idempotencyKey: string;
  },
): Promise<RefundResult> {
  const { data, error } = await supabase
    .from("billing_credit_ledger")
    .select("id, credit_account_id, kind, credit_delta, project_id")
    .eq("id", params.chargeLedgerEntryId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, refusal: "charge_not_found" };

  const charge = data as {
    id: string;
    credit_account_id: string;
    kind: string;
    credit_delta: number;
    project_id: string | null;
  };
  if (charge.kind !== "charge") return { ok: false, refusal: "charge_not_found" };

  const { data: priorRefunds, error: refundsError } = await supabase
    .from("billing_credit_ledger")
    .select("kind, credit_delta")
    .eq("refunds_ledger_entry_id", charge.id);

  if (refundsError) throw refundsError;

  const already = totalRefunded(
    ((priorRefunds ?? []) as { kind: string; credit_delta: number }[]).map((row) => ({
      kind: row.kind as "refund",
      creditDelta: creditUnits(row.credit_delta),
    })),
  );

  const decision = decideRefund(
    { creditDelta: creditUnits(charge.credit_delta) },
    already,
    params.credits,
  );
  if (!decision.ok) return { ok: false, refusal: decision.refusal };

  const { entry, alreadyPosted } = await postLedgerEntry(supabase, {
    creditAccountId: charge.credit_account_id,
    kind: "refund",
    creditDelta: decision.refundDelta,
    idempotencyKey: params.idempotencyKey,
    projectId: charge.project_id,
    refundsLedgerEntryId: charge.id,
    reason: params.reason,
  });

  if (!alreadyPosted) {
    await recordAuditEvent(supabase, {
      userId: (await accountOwner(supabase, charge.credit_account_id)) ?? "",
      projectId: charge.project_id,
      eventType: "credit_refund.posted",
      metadata: { ledgerEntryId: entry.id, refundsLedgerEntryId: charge.id, credits: params.credits },
    });
  }

  return { ok: true, refundedCredits: decision.refundDelta, alreadyRefunded: alreadyPosted };
}

/* ---------------------------------------------------------------------------
 * Rating
 * ------------------------------------------------------------------------ */

/**
 * Rates a set of usage under the policy in force (§21).
 *
 * A thin pass-through to the pure rater, exported so callers reach rating
 * through the domain API rather than importing the policy module directly.
 */
export function rateBillableUsage(
  usage: readonly BillableUsage[],
  options: { at?: Date; card?: CreditRateCard } = {},
) {
  return rateUsage(usage, options);
}
