import { creditUnits, subtractCredits, sumCredits, type CreditUnits } from "./units";

/**
 * Credit lots, spend order and allocation (BILLING CORE-2 §11, §13, §15, §16, §17).
 *
 * ## Why lots exist at all
 *
 * Billing Core-1's balance is a single number, and a single number cannot
 * answer the two questions Core-2's commercial policy asks of it:
 *
 * ```
 * "which 100 of these Credits expire on the 30th?"
 * "did that 70-Credit charge eat the Credits the customer paid for,
 *  or the ones Vibe gave away?"
 * ```
 *
 * Neither is answerable without provenance, so a Credit now belongs to a
 * **lot**: an immutable record of where it came from and when it dies. The
 * ledger still defines how many Credits exist — every lot is created by
 * exactly one ledger entry — and lots sit beneath it recording which of them
 * is which.
 *
 * ## Everything here is pure
 *
 * No database, no clock, no client. The allocator is the single most
 * consequential piece of arithmetic in the billing system: it decides whose
 * money gets spent. It is written so every property Vibe claims about it —
 * expiring Credits first, purchased Credits preserved, never over-allocating a
 * lot, never inventing capacity — is provable without a Postgres instance.
 *
 * The database enforces the same invariants independently
 * (`billing_credit_grants_capacity_not_exceeded`), which is deliberate: a
 * check constraint catches the write this module never saw, and this module
 * gives a caller an explanation a constraint cannot.
 */

/* ---------------------------------------------------------------------------
 * Sources
 * ------------------------------------------------------------------------ */

/**
 * Where a Credit came from.
 *
 * The kinds carry different *semantics*, not just different labels, and each
 * one exists because some rule in the commercial policy treats it differently:
 *
 * - `welcome` — the once-per-account onboarding allowance. Expires.
 * - `subscription` — a paid billing period's allowance. Expires with its period.
 * - `purchase` — a top-up bought with real money. No normal expiration, and the
 *   spend order protects it deliberately.
 * - `promotional` — goodwill or marketing Credits.
 * - `compensation` — Credits issued because Vibe owed a customer something.
 *
 * No kind is added without a rule that needs it (§13).
 */
export const CREDIT_SOURCE_KINDS = [
  "welcome",
  "subscription",
  "purchase",
  "promotional",
  "compensation",
] as const;
export type CreditSourceKind = (typeof CREDIT_SOURCE_KINDS)[number];

/**
 * A Credit lot, reduced to what allocation depends on.
 *
 * `initialCreditUnits` is immutable. `allocatedCreditUnits` and
 * `expiredCreditUnits` are materialized figures reconciled against the
 * allocation rows that define them — the same "cache it, then prove it"
 * posture Core-1 already takes for the account balance.
 */
export type CreditLot = {
  id: string;
  sourceKind: CreditSourceKind;
  initialCreditUnits: CreditUnits;
  /** Held by a live reservation, plus already consumed by a charge. */
  allocatedCreditUnits: CreditUnits;
  /** Capacity that lapsed unspent. */
  expiredCreditUnits: CreditUnits;
  grantedAt: string;
  /** Null means no normal expiration — never a far-future date (§10). */
  expiresAt: string | null;
  status: "active" | "expired";
};

/** Capacity a lot can still fund. Never negative. */
export function remainingCapacity(lot: CreditLot): CreditUnits {
  const remaining = lot.initialCreditUnits - lot.allocatedCreditUnits - lot.expiredCreditUnits;
  return creditUnits(remaining > 0 ? remaining : 0);
}

/**
 * Whether a lot may fund new spending at an instant.
 *
 * Expiry is evaluated against `expiresAt` directly rather than trusting
 * `status`, because the status is set by a sweep that runs *after* the moment
 * the Credits actually died. A lot one second past its expiry has not been
 * swept yet and must already be unspendable — otherwise the sweep's timing
 * would decide whether a customer got to spend expired Credits.
 */
export function isSpendable(lot: CreditLot, now: Date): boolean {
  if (lot.status !== "active") return false;
  if (remainingCapacity(lot) <= 0) return false;
  if (lot.expiresAt === null) return true;
  return Date.parse(lot.expiresAt) > now.getTime();
}

/* ---------------------------------------------------------------------------
 * Spend order
 * ------------------------------------------------------------------------ */

/**
 * The approved deterministic spend order (§11).
 *
 * **Credits that expire soonest are spent first.** Non-expiring Credits — the
 * ones a customer paid real money for — sort last and are therefore preserved
 * until every expiring Credit is exhausted.
 *
 * Stated as an ordering over `expiresAt` rather than as a list of source kinds
 * on purpose. A category list ("welcome, then subscription, then purchased")
 * happens to produce the right answer today only because those categories
 * currently have that expiry ordering; it would produce the wrong answer the
 * moment a promotional grant outlived a subscription period. Ordering by the
 * thing that actually matters — the deadline — is correct for every
 * combination of lots, including ones that do not exist yet.
 *
 * Ties break on `grantedAt` (oldest first), then on `id`. The final tiebreak
 * is not cosmetic: without it, two lots granted in the same millisecond with
 * the same expiry would allocate in whatever order the database returned them,
 * and the allocation would not be reproducible from the same inputs.
 */
export function compareSpendOrder(a: CreditLot, b: CreditLot): number {
  const aExpiry = a.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.expiresAt);
  const bExpiry = b.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.expiresAt);
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;

  const aGranted = Date.parse(a.grantedAt);
  const bGranted = Date.parse(b.grantedAt);
  if (aGranted !== bGranted) return aGranted - bGranted;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The spendable lots for an account, in the order they must be consumed. */
export function spendableLots(lots: readonly CreditLot[], now: Date): CreditLot[] {
  return lots.filter((lot) => isSpendable(lot, now)).sort(compareSpendOrder);
}

/** Total capacity available to fund new spending at an instant. */
export function spendableCapacity(lots: readonly CreditLot[], now: Date): CreditUnits {
  return sumCredits(spendableLots(lots, now).map(remainingCapacity));
}

/* ---------------------------------------------------------------------------
 * Allocation
 * ------------------------------------------------------------------------ */

/** One lot's contribution to a hold. */
export type LotAllocation = {
  lotId: string;
  sourceKind: CreditSourceKind;
  creditUnits: CreditUnits;
};

export type AllocationPlan =
  | { ok: true; allocations: LotAllocation[] }
  | { ok: false; refusal: "insufficient_credits"; available: CreditUnits; shortfall: CreditUnits };

/**
 * Plans which lots fund an amount (§15).
 *
 * Walks the lots in spend order, taking as much as each can give until the
 * requested amount is covered. The result is deterministic for a given set of
 * lots and instant, which is what makes it inspectable: the same inputs always
 * produce the same allocation, so an allocation can be explained after the
 * fact rather than merely reported.
 *
 * Refuses whole rather than partially. A plan that funded 40 of a 70-Credit
 * charge is not a smaller success — it is an overspend waiting for someone to
 * treat the remainder as free, so the refusal carries the exact shortfall and
 * allocates nothing.
 *
 * This plans; it does not commit. Committing is a set of conditional updates in
 * `store.ts`, and a plan that was valid when computed can still lose that race.
 */
export function planAllocation(
  lots: readonly CreditLot[],
  requested: CreditUnits,
  now: Date,
): AllocationPlan {
  const candidates = spendableLots(lots, now);
  const available = sumCredits(candidates.map(remainingCapacity));

  if (requested <= 0) return { ok: true, allocations: [] };

  if (available < requested) {
    return {
      ok: false,
      refusal: "insufficient_credits",
      available,
      shortfall: subtractCredits(requested, available),
    };
  }

  const allocations: LotAllocation[] = [];
  let outstanding: number = requested;

  for (const lot of candidates) {
    if (outstanding <= 0) break;

    const capacity = remainingCapacity(lot);
    const take = Math.min(capacity, outstanding);
    if (take <= 0) continue;

    allocations.push({ lotId: lot.id, sourceKind: lot.sourceKind, creditUnits: creditUnits(take) });
    outstanding -= take;
  }

  return { ok: true, allocations };
}

/* ---------------------------------------------------------------------------
 * Settlement across lots
 * ------------------------------------------------------------------------ */

/** A hold against one lot, as settlement sees it. */
export type HeldAllocation = {
  id: string;
  lotId: string;
  creditUnits: CreditUnits;
};

/** What settlement does to one held allocation. */
export type AllocationSettlement =
  | { allocationId: string; lotId: string; outcome: "consumed"; consumedUnits: CreditUnits; releasedUnits: CreditUnits }
  | { allocationId: string; lotId: string; outcome: "released"; releasedUnits: CreditUnits };

/**
 * Splits an actual charge across the lots a reservation held (§16, §76).
 *
 * The held allocations are consumed **in the order they were taken**, which is
 * the spend order that produced them. That matters for a partial settlement:
 * reserving 200 across a 30-Credit Welcome lot and a 500-Credit purchased lot,
 * then settling 150, must consume the Welcome 30 and 120 of the purchase — not
 * 150 of the purchase while the Welcome Credits go back and then expire. The
 * customer approved a ceiling, not a re-ordering of their own money.
 *
 * Everything not consumed is released back to its lot. A reservation never
 * permanently spends anything by itself; only settlement does, and only up to
 * what actually happened.
 *
 * `actualCredits` is assumed to be within the reservation total —
 * `decideSettlement` in `balance.ts` is what refuses an over-run, and this
 * function is only reached after that check passes. Passing more than was held
 * throws rather than silently under-charging, because a silent under-charge is
 * exactly the class of bug that is invisible until an auditor finds it.
 */
export function settleAcrossLots(
  held: readonly HeldAllocation[],
  actualCredits: CreditUnits,
): AllocationSettlement[] {
  const totalHeld = sumCredits(held.map((allocation) => allocation.creditUnits));
  if (actualCredits > totalHeld) {
    throw new Error(
      `A settlement of ${actualCredits} credit units cannot exceed the ${totalHeld} held across lots.`,
    );
  }

  const settlements: AllocationSettlement[] = [];
  let outstanding: number = actualCredits;

  for (const allocation of held) {
    if (outstanding <= 0) {
      settlements.push({
        allocationId: allocation.id,
        lotId: allocation.lotId,
        outcome: "released",
        releasedUnits: allocation.creditUnits,
      });
      continue;
    }

    const consumed = Math.min(allocation.creditUnits, outstanding);
    outstanding -= consumed;

    settlements.push({
      allocationId: allocation.id,
      lotId: allocation.lotId,
      outcome: "consumed",
      consumedUnits: creditUnits(consumed),
      releasedUnits: subtractCredits(allocation.creditUnits, creditUnits(consumed)),
    });
  }

  return settlements;
}

/* ---------------------------------------------------------------------------
 * Expiration
 * ------------------------------------------------------------------------ */

/** A lot due to be swept, and how much of it lapses. */
export type ExpiringLot = {
  lotId: string;
  sourceKind: CreditSourceKind;
  expiringUnits: CreditUnits;
};

/**
 * Which lots have lapsed, and by how much (§17, §59, §73).
 *
 * ## Why a lot with a live hold is deliberately skipped
 *
 * Credits that were valid when a customer approved an operation must not
 * vanish mid-run and fail work they already authorized (§17). So a lot with a
 * held allocation is **not** swept: its held capacity stays pinned until the
 * operation settles or releases, and whatever is left lapses on a later sweep.
 *
 * Skipping the whole lot rather than only its held portion is what keeps
 * expiry a single, exact event per lot. Expiring the unheld remainder now and
 * the rest later would need two compensating entries, a per-lot sweep counter
 * to keep them idempotent, and a second way for "expired" to be partially
 * true. Deferring instead costs one operation's lifetime of delay on a figure
 * nobody can spend anyway — {@link isSpendable} already refuses a lapsed lot,
 * so the deferred remainder is unspendable the whole time it waits.
 *
 * ## Why this is a sweep and not a job
 *
 * Nothing here needs a scheduler. Expiry is derived from `expiresAt` at every
 * read and every reservation, so an unswept lot is already unspendable; the
 * sweep exists only to move the *posted* balance so it stops overstating what
 * a customer has. Running it whenever an account is touched is enough, and a
 * cron that fires hourly against every account in the system to change a
 * number nobody is looking at would be strictly worse.
 */
export function lotsDueForExpiry(
  lots: readonly { lot: CreditLot; hasLiveHold: boolean }[],
  now: Date,
): ExpiringLot[] {
  const due: ExpiringLot[] = [];

  for (const { lot, hasLiveHold } of lots) {
    if (lot.status !== "active") continue;
    if (lot.expiresAt === null) continue;
    if (Date.parse(lot.expiresAt) > now.getTime()) continue;
    if (hasLiveHold) continue;

    const remaining = remainingCapacity(lot);
    if (remaining <= 0) continue;

    due.push({ lotId: lot.id, sourceKind: lot.sourceKind, expiringUnits: remaining });
  }

  return due;
}

/* ---------------------------------------------------------------------------
 * Reconciliation
 * ------------------------------------------------------------------------ */

/**
 * Whether a lot's materialized `allocatedCreditUnits` still agrees with the
 * allocation rows that define it (§14).
 *
 * The same proof `reconcileBalance` provides for the account balance, one
 * level down. A materialized figure nobody checks is a second source of truth
 * waiting to disagree with the first, and this is the check that makes the
 * cache provable rather than merely convenient.
 */
export function reconcileLotAllocation(
  lot: CreditLot,
  occupied: CreditUnits,
): { consistent: boolean; expected: CreditUnits; drift: CreditUnits } {
  // `occupied` arrives already summed, by `sum_lot_allocation_capacity`. The
  // occupancy rule — a live hold occupies its full held amount, a consumed
  // allocation only what it charged, a released one nothing — used to be three
  // lines here over an array of every allocation row the account has ever had.
  //
  // That read sat behind `max_rows = 1000` and would have truncated silently,
  // making `expected` too low and this function report a drift that does not
  // exist (PERF-018). The rule now lives in the migration and this takes the
  // number, so there is no second copy of it to disagree.
  const drift = subtractCredits(lot.allocatedCreditUnits, occupied);
  return { consistent: drift === 0, expected: occupied, drift };
}
