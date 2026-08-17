import {
  CREDIT_KINDS,
  DEBIT_KINDS,
  type CreditBalance,
  type CreditLedgerKind,
  type ReservationRefusal,
  type SettlementRefusal,
} from "./schema";
import { addCredits, creditUnits, subtractCredits, sumCredits, type CreditUnits, ZERO_CREDITS } from "./units";

/**
 * Balance and settlement rules (BILLING CORE-1 §10, §12, §28, §29).
 *
 * Pure functions over exact integers. No database, no clock, no client — the
 * point of this file is that every financial invariant Vibe claims can be
 * proven without a Postgres instance, and that the database's constraints and
 * this module's arithmetic are two independent statements of the same rule
 * rather than one statement and one hope.
 *
 * The database still enforces these too. That redundancy is deliberate: a
 * check constraint catches the write this module never saw, and this module
 * gives a caller an explanation the constraint cannot.
 */

/** One immutable balance-changing entry, reduced to what a balance depends on. */
export type LedgerDelta = {
  kind: CreditLedgerKind;
  /** Signed. Negative for a charge, positive for a grant, purchase or refund. */
  creditDelta: CreditUnits;
};

/** A hold that reduces available balance without changing posted balance. */
export type ActiveReservation = {
  reservedCredits: CreditUnits;
};

/**
 * The sign a ledger kind must carry (§9, §47).
 *
 * `adjustment` is deliberately unconstrained — it is the correction mechanism,
 * and a correction that could only move one way would not be one. Every other
 * kind has exactly one legitimate direction, and the database asserts the same
 * pairing so an application bug cannot post a positive charge.
 */
export function isValidLedgerDelta(kind: CreditLedgerKind, delta: CreditUnits): boolean {
  if (delta === 0) return false;
  if (DEBIT_KINDS.includes(kind)) return delta < 0;
  if (CREDIT_KINDS.includes(kind)) return delta > 0;
  return true;
}

/** Posted balance: the sum of immutable history, and nothing else (§10). */
export function postedBalance(entries: readonly LedgerDelta[]): CreditUnits {
  return sumCredits(entries.map((entry) => entry.creditDelta));
}

/** Reserved balance: the sum of *active* holds only. */
export function reservedBalance(reservations: readonly ActiveReservation[]): CreditUnits {
  return sumCredits(reservations.map((reservation) => reservation.reservedCredits));
}

/**
 * The full balance, reconstructed from history (§10).
 *
 * This is the definition. A materialized figure on the account row exists for
 * the atomic reservation primitive and for read performance, and it is checked
 * against this function rather than trusted over it — see
 * {@link reconcileBalance}.
 */
export function computeBalance(
  entries: readonly LedgerDelta[],
  reservations: readonly ActiveReservation[],
): CreditBalance {
  const posted = postedBalance(entries);
  const reserved = reservedBalance(reservations);
  return { posted, reserved, available: subtractCredits(posted, reserved) };
}

/**
 * Whether a materialized balance still agrees with the history that defines it.
 *
 * §10 permits a cached balance "only if the ledger remains reconstructable and
 * invariants prove consistency". This is that proof, and it is a real function
 * rather than a comment because a materialized figure nobody checks is just a
 * second source of truth waiting to disagree with the first.
 */
export function reconcileBalance(
  materialized: { posted: CreditUnits; reserved: CreditUnits },
  entries: readonly LedgerDelta[],
  reservations: readonly ActiveReservation[],
): { consistent: boolean; expected: CreditBalance; drift: { posted: CreditUnits; reserved: CreditUnits } } {
  const expected = computeBalance(entries, reservations);
  const drift = {
    posted: subtractCredits(materialized.posted, expected.posted),
    reserved: subtractCredits(materialized.reserved, expected.reserved),
  };
  return { consistent: drift.posted === 0 && drift.reserved === 0, expected, drift };
}

/* ---------------------------------------------------------------------------
 * Reservation
 * ------------------------------------------------------------------------ */

export type ReservationDecision =
  | { ok: true; reserved: CreditUnits; availableAfter: CreditUnits }
  | { ok: false; refusal: ReservationRefusal };

/**
 * Whether a hold may be taken (§12).
 *
 * The invariant is `available >= requested`, evaluated against the balance as
 * it is *now*. This function is the explanation; the guarantee is a single
 * conditional UPDATE in the database that re-evaluates the same predicate while
 * holding the account row (see `store.ts`). An application check alone would
 * leave a race window between reading a balance and writing a reservation, and
 * two concurrent operations would both pass it.
 */
export function decideReservation(
  balance: CreditBalance,
  requested: CreditUnits,
  account: { suspended: boolean },
): ReservationDecision {
  if (requested <= 0) return { ok: false, refusal: "invalid_amount" };
  if (account.suspended) return { ok: false, refusal: "account_suspended" };
  if (balance.available < requested) return { ok: false, refusal: "insufficient_credits" };

  return {
    ok: true,
    reserved: requested,
    availableAfter: subtractCredits(balance.available, requested),
  };
}

/* ---------------------------------------------------------------------------
 * Settlement
 * ------------------------------------------------------------------------ */

export type SettlementDecision =
  | {
      ok: true;
      /** Always negative — this becomes the CHARGE ledger delta. */
      chargeDelta: CreditUnits;
      /** Held credits that were never used and are handed straight back. */
      releasedCredits: CreditUnits;
    }
  | { ok: false; refusal: SettlementRefusal; shortfall?: CreditUnits };

/**
 * Turning a finished operation into exactly one charge (§28).
 *
 * The rule that matters is the third one: **actual may never silently exceed
 * the reserved maximum.** A customer approved a ceiling, and quietly charging
 * above it is the single worst thing a billing system can do — it is the
 * surprise invoice, and no amount of correctness elsewhere compensates for it.
 * So an over-run refuses with the shortfall stated, and a future UX asks for
 * more approval rather than taking it.
 *
 * A zero-usage settlement is legitimate and is not an error: an operation that
 * did no billable work settles for nothing and returns the whole hold. That is
 * different from a *failed* operation with real usage, which
 * {@link decideRelease} deliberately refuses to treat as free.
 */
export function decideSettlement(
  reservation: { status: string; reservedCredits: CreditUnits },
  actualCredits: CreditUnits,
): SettlementDecision {
  if (reservation.status !== "active") {
    return { ok: false, refusal: "reservation_not_active" };
  }
  if (actualCredits < 0) {
    return { ok: false, refusal: "invalid_amount" };
  }
  if (actualCredits > reservation.reservedCredits) {
    return {
      ok: false,
      refusal: "additional_credits_required",
      shortfall: subtractCredits(actualCredits, reservation.reservedCredits),
    };
  }

  return {
    ok: true,
    chargeDelta: creditUnits(-actualCredits),
    releasedCredits: subtractCredits(reservation.reservedCredits, actualCredits),
  };
}

/* ---------------------------------------------------------------------------
 * Release
 * ------------------------------------------------------------------------ */

/**
 * Why a hold is being given back (§29).
 *
 * `abandoned_with_usage` is the honest one, and the reason this is an enum
 * rather than a boolean. An operation can fail *after* spending real provider
 * money, and releasing the whole hold as though nothing happened would record
 * a falsehood — Vibe paid Anthropic either way. Core 1 does not decide whether
 * the customer is ultimately charged for it (that is commercial policy, not
 * architecture); it only refuses to let the release *pretend the usage was
 * zero*, and keeps the usage attached so the decision can be made later.
 */
export const RELEASE_REASONS = [
  "cancelled_before_usage",
  "failed_without_usage",
  "abandoned_with_usage",
  "expired",
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export type ReleaseDecision =
  | { ok: true; releasedCredits: CreditUnits; usageOutstanding: boolean }
  | { ok: false; refusal: SettlementRefusal };

export function decideRelease(
  reservation: { status: string; reservedCredits: CreditUnits },
  reason: ReleaseReason,
): ReleaseDecision {
  if (reservation.status !== "active") {
    return { ok: false, refusal: "reservation_not_active" };
  }

  return {
    ok: true,
    releasedCredits: reservation.reservedCredits,
    // Flagged, never silently dropped: real provider spend happened and the
    // commercial question of who bears it is still open.
    usageOutstanding: reason === "abandoned_with_usage",
  };
}

/* ---------------------------------------------------------------------------
 * Refund
 * ------------------------------------------------------------------------ */

export type RefundDecision =
  | { ok: true; refundDelta: CreditUnits }
  | { ok: false; refusal: "invalid_amount" | "exceeds_original_charge" };

/**
 * A compensating entry against an earlier charge (§30).
 *
 * Never a deletion and never an edit. The original charge is a historical fact
 * that stays true; a refund is a second fact that happened afterwards. Together
 * they reconstruct to the right balance, and separately they tell an auditor
 * what actually occurred — which a mutated row never can.
 */
export function decideRefund(
  originalCharge: { creditDelta: CreditUnits },
  alreadyRefunded: CreditUnits,
  requested: CreditUnits,
): RefundDecision {
  if (requested <= 0) return { ok: false, refusal: "invalid_amount" };

  // The charge is stored negative; its refundable magnitude is positive.
  const chargedMagnitude = creditUnits(-originalCharge.creditDelta);
  const remaining = subtractCredits(chargedMagnitude, alreadyRefunded);

  if (requested > remaining) return { ok: false, refusal: "exceeds_original_charge" };

  return { ok: true, refundDelta: requested };
}

/** Total refunded so far against one charge, for the cap above. */
export function totalRefunded(refunds: readonly LedgerDelta[]): CreditUnits {
  return refunds.reduce<CreditUnits>(
    (total, entry) => (entry.kind === "refund" ? addCredits(total, entry.creditDelta) : total),
    ZERO_CREDITS,
  );
}
