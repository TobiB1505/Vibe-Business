import "server-only";
import { alertOperator } from "@/lib/observability/alert";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  decideRefund,
  decideRelease,
  decideSettlement,
  reconcileBalance,
  totalRefunded,
  type ActiveReservation,
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
  sumLedgerDeltas,
  postLedgerEntry,
  repairAccountBalance,
  type CreditAccount,
  type CreditReservation,
} from "./store";
import { createServiceClient } from "@/lib/supabase/service";
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
 * Detects and, when enabled, repairs drift between an account's materialized
 * `posted_credits`/`reserved_credits` and the ledger/reservation rows that
 * define them (ADR 0042 §P3).
 *
 * Extracted so `getBillingOverview` — the read a customer actually makes —
 * can trigger the same check `getBillingBalance` always has, without either
 * caller re-fetching what the other already loaded. Every automatic action
 * here posts through `recordAuditEvent`: `credit_drift.detected` on any
 * disagreement, `credit_drift.repaired` only once a post-repair re-check
 * confirms `consistent: true`, `credit_drift.repair_failed` when the repair
 * RPC itself errors or — the more surprising case — completes without error
 * but the account is still inconsistent afterward (a repair that ran and did
 * not close the gap it exists to close is exactly as reportable as one that
 * threw).
 *
 * ## The repair call is gated, and unreachable while unset (ADR 0042 §P3, Rollout)
 *
 * `BILLING_REPAIR_ENABLED` is a server-only environment variable, read only
 * here and at the lot-level equivalent, defaulting unset. While unset this
 * behaves exactly as it always has: drift is logged and audited and nothing
 * acts on it — `repairAccountBalance` is not called-and-skipped, it is simply
 * never reached, so this deploy carries no behavioural change until an
 * operator has independently verified the drain conditions the ADR names and
 * sets the flag.
 *
 * ## Never throws
 *
 * A repair failure degrades to `consistent: false` with the caller's
 * already-loaded, unrepaired account returned — never propagated. The read
 * this is triggered from (a customer's own balance page) must survive a
 * repair defect exactly as it already survives ordinary drift.
 */
export async function reconcileAndRepairBalance(
  supabase: SupabaseClient,
  params: {
    account: CreditAccount;
    /**
     * The posted balance the **whole** ledger implies, summed in the database
     * (VB-025).
     *
     * This used to be every ledger row, transferred and reduced here. The
     * number is the same; what changed is that it no longer grows with the
     * account. It has to stay a sum over everything: a sum over a capped read
     * would report drift on any account with more history than the cap, and a
     * false drift is not cosmetic — with `BILLING_REPAIR_ENABLED` it triggers
     * a repair.
     */
    postedFromLedger: CreditUnits;
    reservations: readonly ActiveReservation[];
    userId: string;
  },
): Promise<{ account: CreditAccount; consistent: boolean }> {
  let account = params.account;

  const reconcile = () =>
    reconcileBalance(
      { posted: account.postedCredits, reserved: account.reservedCredits },
      params.postedFromLedger,
      params.reservations,
    );

  let reconciliation = reconcile();
  if (reconciliation.consistent) return { account, consistent: true };

  // Observable, never silent (§66), and now reaching somebody rather than a
  // log stream (VB-012). A drifted balance is a financial defect.
  await alertOperator("[billing] materialized balance disagrees with the ledger", {
    creditAccountId: account.id,
    postedDrift: reconciliation.drift.posted,
    reservedDrift: reconciliation.drift.reserved,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "credit_drift.detected",
    metadata: {
      creditAccountId: account.id,
      postedDrift: reconciliation.drift.posted,
      reservedDrift: reconciliation.drift.reserved,
    },
  });

  if (process.env.BILLING_REPAIR_ENABLED !== "true") {
    return { account, consistent: false };
  }

  try {
    /*
     * The repair runs under a service-role client, and the read that found the
     * drift does not (PERF-011).
     *
     * `repair_account_balance` is granted to `service_role` alone, because the
     * writes it delegates to are on tables that carry a select policy and
     * deliberately no write policy — the same shape as every other billing
     * write in the product. Called with the caller's cookie-scoped client it
     * could only ever answer `42501`, so with `BILLING_REPAIR_ENABLED` set the
     * repair path could not succeed once: every drifted account rendered its
     * billing page, failed, and wrote a `credit_drift.repair_failed` row.
     *
     * Ownership is not taken from an argument. `account` was read a moment ago
     * through `supabase`, under RLS, from the session's own user id — this
     * repairs that row and no other.
     */
    await repairAccountBalance(createServiceClient(), account.id);
  } catch (error) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "credit_drift.repair_failed",
      metadata: {
        creditAccountId: account.id,
        code: (error as { code?: string })?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return { account, consistent: false };
  }

  const repaired = await findCreditAccountByUser(supabase, params.userId);
  if (!repaired) return { account, consistent: false };

  const before = account;
  account = repaired;
  reconciliation = reconcile();

  if (!reconciliation.consistent) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "credit_drift.repair_failed",
      metadata: {
        creditAccountId: account.id,
        reason: "still_inconsistent_after_repair",
        postedDrift: reconciliation.drift.posted,
        reservedDrift: reconciliation.drift.reserved,
      },
    });
    return { account, consistent: false };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "credit_drift.repaired",
    metadata: {
      creditAccountId: account.id,
      postedBefore: before.postedCredits,
      reservedBefore: before.reservedCredits,
      postedAfter: account.postedCredits,
      reservedAfter: account.reservedCredits,
    },
  });

  return { account, consistent: true };
}

/**
 * The customer balance read model (§35).
 *
 * Returns the balance *and* whether it reconciles, because a figure nobody
 * checks is a second source of truth. A caller that finds `consistent: false`
 * has found a real defect, not a rounding artefact — the ledger is authority
 * and the materialized figure is a cache of it.
 *
 * A thin wrapper: fetches what `reconcileAndRepairBalance` needs and shapes
 * its result. See that function for the detect/audit/repair behaviour.
 */
export async function getBillingBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<BillingBalanceView | null> {
  const initialAccount = await findCreditAccountByUser(supabase, userId);
  if (!initialAccount) return null;

  const [postedFromLedger, reservations] = await Promise.all([
    sumLedgerDeltas(supabase, initialAccount.id),
    listActiveReservations(supabase, initialAccount.id),
  ]);

  const { account, consistent } = await reconcileAndRepairBalance(supabase, {
    account: initialAccount,
    postedFromLedger,
    reservations: reservations.map((reservation) => ({ reservedCredits: reservation.reservedCredits })),
    userId,
  });

  return {
    balance: {
      posted: account.postedCredits,
      reserved: account.reservedCredits,
      available: creditUnits(account.postedCredits - account.reservedCredits),
    },
    consistent,
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

/** One settlement, announced once. Called only where a close actually happened. */
async function announceSettlement(
  supabase: SupabaseClient,
  reservation: { creditAccountId: string; projectId: string | null; id: string },
  chargedCredits: CreditUnits,
): Promise<void> {
  await recordAuditEvent(supabase, {
    userId: await accountOwner(supabase, reservation.creditAccountId),
    projectId: reservation.projectId,
    eventType: "credit_charge.settled",
    metadata: {
      projectId: reservation.projectId,
      reservationId: reservation.id,
      chargedCredits,
    },
  });
}

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
 * customer temporarily has less available than they should), whereas closing
 * first and crashing would release the hold and lose the charge — the customer
 * would have consumed real provider spend for nothing.
 *
 * ## The retry has two questions, not one (§I1)
 *
 * That ordering argument used to end with "and a retry fixes it", and the
 * retry did not: the early return on an existing charge sat *before*
 * `closeReservation`, so the recovery path this comment described was the one
 * path the code could not take. A charge could be booked against a hold that
 * stayed active forever.
 *
 * The fix is to stop answering two questions with one branch:
 *
 *   does a charge exist?        the *financial* question. Answered once, by the
 *                               ledger's unique index, and never re-decided
 *                               here. This is what `alreadySettled` reports.
 *   is the reservation closed?  the *cleanup* question. Answered by the
 *                               reservation row, and a retry's job is to
 *                               finish it.
 *
 * Four states follow, and only one of them is new. A charge with an active
 * hold: close it, and report the settlement. A charge with an already-settled
 * hold, whether closed by the first attempt or by a concurrent one: nothing to
 * do, report the settlement. And a charge whose hold was *released* — the
 * customer charged, and the capacity that charge should have consumed handed
 * back — which is `charge_without_hold`, a refusal rather than a success,
 * because it is the inconsistency this split exists to surface.
 *
 * It never asks "did that HTTP call succeed?" — it reads what is durably true
 * and lets the observation decide (§27).
 *
 * ## Why `settled` is checked before the ledger, not after (ADR 0042 §P4)
 *
 * A charge existing in the ledger used to be the only idempotency key this
 * function trusted — correct for every settlement that charges something, and
 * silently wrong for the one that legitimately charges nothing: `credit_delta
 * <> 0` forbids a zero-delta ledger row, so a zero-credit settlement posts no
 * charge at all, and a retry that only looks for one finds nothing, falls
 * through to `decideSettlement`, and is refused `reservation_not_active`
 * against a reservation it already, correctly, settled. The reservation row
 * itself is guaranteed to reach a terminal status for every legitimate
 * settlement, charged or not — and it already carries the exact amount
 * (`settledCredits`, set by `closeReservation`) — so it is the idempotency key
 * for the case the ledger cannot represent, checked first rather than
 * inferred from an absence.
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

  // Already durably settled — including the zero-credit outcome, which posts
  // no ledger row at all, so this is checked before any ledger lookup rather
  // than inferred from one finding nothing (see the docblock above).
  if (reservation.status === "settled") {
    const charged = reservation.settledCredits ?? ZERO_CREDITS;
    return {
      ok: true,
      chargedCredits: charged,
      releasedCredits: creditUnits(reservation.reservedCredits - charged),
      alreadySettled: true,
    };
  }

  // Already durably charged? Then this is a retry, and the answer is the
  // charge that already exists — not a second one. Reservation status here is
  // never 'settled' (handled above), so finding a charge against it is the
  // anomaly the next check surfaces, not the ordinary replay case.
  const existingCharge = await findLedgerEntryByIdempotencyKey(supabase, {
    creditAccountId: reservation.creditAccountId,
    idempotencyKey,
  });
  if (existingCharge) {
    const charged = creditUnits(-existingCharge.creditDelta);
    const settled: SettleResult = {
      ok: true,
      chargedCredits: charged,
      releasedCredits: creditUnits(reservation.reservedCredits + existingCharge.creditDelta),
      alreadySettled: true,
    };

    // The hold was given back and the charge stands. Both halves happened and
    // they disagree, so this is reported rather than smoothed over.
    if (reservation.status !== "active") {
      return { ok: false, refusal: "charge_without_hold" };
    }

    // The crash window: charge durable, hold still open. Finish the cleanup the
    // first attempt did not. `closeReservation` is guarded on `status='active'`,
    // so losing this race to a concurrent settlement is a successful no-op.
    const { closed } = await closeReservation(supabase, {
      reservationId: reservation.id,
      creditAccountId: reservation.creditAccountId,
      heldCredits: reservation.reservedCredits,
      status: "settled",
      settledCredits: charged,
      rateCardVersion: params.rateCardVersion,
    });

    if (closed) await announceSettlement(supabase, reservation, charged);
    return settled;
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

  const { closed } = await closeReservation(supabase, {
    reservationId: reservation.id,
    creditAccountId: reservation.creditAccountId,
    heldCredits: reservation.reservedCredits,
    status: "settled",
    settledCredits: params.actualCredits,
    rateCardVersion: params.rateCardVersion,
  });

  // Gated on the close, exactly as `releaseReservation` gates its own. Losing
  // the race means somebody else settled this and announced it; announcing it
  // again would make the activity feed count attempts rather than facts.
  if (closed) await announceSettlement(supabase, reservation, params.actualCredits);

  return {
    ok: true,
    chargedCredits: params.actualCredits,
    releasedCredits: decision.releasedCredits,
    alreadySettled: false,
  };
}

/**
 * The account's owner, or null.
 *
 * Null now carries two distinguishable-in-principle meanings that this
 * function deliberately flattens: the account could not be read, and the
 * account is tombstoned because the identity was erased (ADR 0056 §6). Both
 * produce an audit event with a null `user_id`, which is the honest record in
 * either case — better than the `?? ""` this replaced, which wrote a value
 * that is not a UUID, failed the insert, and lost the event silently.
 */
async function accountOwner(supabase: SupabaseClient, creditAccountId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("billing_credit_accounts")
    .select("user_id")
    .eq("id", creditAccountId)
    .maybeSingle();

  if (error) return null;
  return data ? (data as { user_id: string | null }).user_id : null;
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
      userId: await accountOwner(supabase, reservation.creditAccountId),
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
      userId: await accountOwner(supabase, charge.credit_account_id),
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
