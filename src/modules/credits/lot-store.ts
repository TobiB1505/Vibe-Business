import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lotsDueForExpiry,
  planAllocation,
  settleAcrossLots,
  type AllocationPlan,
  type CreditLot,
  type CreditSourceKind,
  type HeldAllocation,
} from "./lots";
import { CONTENTION_ATTEMPTS, retryDelayMs, sleep } from "./contention";
import { creditUnits, type CreditUnits } from "./units";

/**
 * Credit lot and allocation persistence (BILLING CORE-2 §13, §14, §15, §16, §17).
 *
 * ## How this relates to Core-1's atomic gate
 *
 * It sits underneath it and changes nothing about it.
 *
 * ```
 * billing_credit_accounts.posted - reserved     admission       (Core-1, unchanged)
 * billing_credit_grants.allocated_credit_units  provenance      (this file)
 * ```
 *
 * A reservation is still admitted by the single conditional UPDATE in
 * `store.ts` — that primitive was proven under real concurrency and is not
 * touched. Allocation runs *after* admission and answers a different question:
 * not "may this hold exist?" but "whose Credits fund it?".
 *
 * Both layers use the same compare-and-swap shape for the same reason: PostgREST
 * cannot express a column-relative update, and a read-then-write without a guard
 * has a race window two concurrent operations fit through.
 *
 * ## Two gates, and why allocation can still refuse
 *
 * The account gate counts *every* posted Credit, including ones that have
 * lapsed but not yet been swept. The lot allocator counts only Credits that are
 * actually spendable at this instant. So allocation is the stricter, and
 * therefore the authoritative, check — and a reservation whose allocation fails
 * is rolled back rather than left holding capacity no lot can fund.
 */

const POSTGRES_CHECK_VIOLATION = "23514";

/* ---------------------------------------------------------------------------
 * Lots
 * ------------------------------------------------------------------------ */

type LotRow = {
  id: string;
  source_kind: CreditSourceKind;
  initial_credit_units: number;
  allocated_credit_units: number;
  expired_credit_units: number;
  granted_at: string;
  expires_at: string | null;
  status: "active" | "expired";
};

const LOT_COLUMNS =
  "id, source_kind, initial_credit_units, allocated_credit_units, expired_credit_units, granted_at, expires_at, status";

function mapLot(row: LotRow): CreditLot {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    initialCreditUnits: creditUnits(row.initial_credit_units),
    allocatedCreditUnits: creditUnits(row.allocated_credit_units),
    expiredCreditUnits: creditUnits(row.expired_credit_units),
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

export type InsertGrantLotParams = {
  creditAccountId: string;
  ledgerEntryId: string;
  sourceKind: CreditSourceKind;
  creditUnits: CreditUnits;
  expiresAt?: string | null;
  externalReference?: string | null;
  subscriptionId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

/**
 * Records the lot a ledger entry created.
 *
 * Exactly-once by construction rather than by a second idempotency mechanism:
 * `billing_credit_grants_ledger_entry_idx` is unique, and the ledger entry that
 * would be its parent was itself already collapsed to one row by the ledger's
 * own idempotency index. A replayed Stripe webhook therefore cannot reach a
 * second insert here — and if it somehow did, the index refuses it.
 */
export async function insertGrantLot(
  supabase: SupabaseClient,
  params: InsertGrantLotParams,
): Promise<{ lot: CreditLot; alreadyExisted: boolean }> {
  const existing = await findLotByLedgerEntry(supabase, params.ledgerEntryId);
  if (existing) return { lot: existing, alreadyExisted: true };

  const { data, error } = await supabase
    .from("billing_credit_grants")
    .insert({
      credit_account_id: params.creditAccountId,
      ledger_entry_id: params.ledgerEntryId,
      source_kind: params.sourceKind,
      initial_credit_units: params.creditUnits,
      allocated_credit_units: 0,
      expired_credit_units: 0,
      expires_at: params.expiresAt ?? null,
      external_reference: params.externalReference ?? null,
      subscription_id: params.subscriptionId ?? null,
      period_start: params.periodStart ?? null,
      period_end: params.periodEnd ?? null,
      status: "active",
    })
    .select(LOT_COLUMNS)
    .single();

  if (error) {
    // Lost a race for the same ledger entry — the winner's lot is the answer.
    const raced = await findLotByLedgerEntry(supabase, params.ledgerEntryId);
    if (raced) return { lot: raced, alreadyExisted: true };
    throw error;
  }

  return { lot: mapLot(data as LotRow), alreadyExisted: false };
}

export async function findLotByLedgerEntry(
  supabase: SupabaseClient,
  ledgerEntryId: string,
): Promise<CreditLot | null> {
  const { data, error } = await supabase
    .from("billing_credit_grants")
    .select(LOT_COLUMNS)
    .eq("ledger_entry_id", ledgerEntryId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapLot(data as LotRow) : null;
}

/** Every lot that can still fund spending, in the database's spend order. */
export async function listActiveLots(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<CreditLot[]> {
  const { data, error } = await supabase
    .from("billing_credit_grants")
    .select(LOT_COLUMNS)
    .eq("credit_account_id", creditAccountId)
    .eq("status", "active")
    .order("expires_at", { ascending: true, nullsFirst: false })
    .order("granted_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as LotRow[]).map(mapLot);
}

/** Every lot, including expired ones — history, for the customer's activity view. */
export async function listAllLots(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<CreditLot[]> {
  const { data, error } = await supabase
    .from("billing_credit_grants")
    .select(LOT_COLUMNS)
    .eq("credit_account_id", creditAccountId)
    .order("granted_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as LotRow[]).map(mapLot);
}

/* ---------------------------------------------------------------------------
 * Allocation
 * ------------------------------------------------------------------------ */

/**
 * Takes capacity from one lot, atomically.
 *
 * The same compare-and-swap `admitHold` uses on the account row, applied to a
 * lot: read `allocated_credit_units`, write `read + amount` guarded by
 * `eq(allocated_credit_units, read)`. A concurrent allocation moves the column,
 * the swap matches zero rows, and this attempt is retried against the fresh
 * value after a jittered delay.
 *
 * `billing_credit_grants_capacity_not_exceeded` is the backstop that makes
 * over-allocating a lot impossible even if this predicate were written wrong.
 */
async function takeFromLot(
  supabase: SupabaseClient,
  lotId: string,
  amount: CreditUnits,
): Promise<boolean> {
  for (let attempt = 0; attempt < CONTENTION_ATTEMPTS; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from("billing_credit_grants")
      .select("initial_credit_units, allocated_credit_units, expired_credit_units, status, expires_at")
      .eq("id", lotId)
      .single();

    if (readError) throw readError;

    const row = current as {
      initial_credit_units: number;
      allocated_credit_units: number;
      expired_credit_units: number;
      status: string;
      expires_at: string | null;
    };

    // Re-checked against the committed row rather than trusting the plan: the
    // lot may have expired or been drained since it was read.
    if (row.status !== "active") return false;
    if (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()) return false;

    const remaining = row.initial_credit_units - row.allocated_credit_units - row.expired_credit_units;
    if (remaining < amount) return false;

    const { data: updated, error: updateError } = await supabase
      .from("billing_credit_grants")
      .update({ allocated_credit_units: row.allocated_credit_units + amount })
      .eq("id", lotId)
      .eq("allocated_credit_units", row.allocated_credit_units)
      .select("id");

    if (updateError) {
      if (updateError.code === POSTGRES_CHECK_VIOLATION) return false;
      throw updateError;
    }

    if (updated && updated.length > 0) return true;
    await sleep(retryDelayMs(attempt));
  }

  return false;
}

/** Hands capacity back to a lot after a release or a partial settlement. */
async function returnToLot(
  supabase: SupabaseClient,
  lotId: string,
  amount: CreditUnits,
): Promise<void> {
  if (amount <= 0) return;

  for (let attempt = 0; attempt < CONTENTION_ATTEMPTS; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from("billing_credit_grants")
      .select("allocated_credit_units")
      .eq("id", lotId)
      .single();

    if (readError) throw readError;

    const allocated = (current as { allocated_credit_units: number }).allocated_credit_units;
    const next = Math.max(0, allocated - amount);

    const { data: updated, error: updateError } = await supabase
      .from("billing_credit_grants")
      .update({ allocated_credit_units: next })
      .eq("id", lotId)
      .eq("allocated_credit_units", allocated)
      .select("id");

    if (updateError) throw updateError;
    if (updated && updated.length > 0) return;

    await sleep(retryDelayMs(attempt));
  }

  // Returning capacity is the customer-favourable direction and the ledger
  // remains authoritative, so sustained contention here is logged rather than
  // thrown — failing the settlement that is giving Credits back would be worse
  // than a reconcilable drift on a cache.
  console.error("[billing] could not return capacity to a credit lot", { lotId, amount });
}

export type AllocateResult =
  | { ok: true; allocations: { lotId: string; creditUnits: CreditUnits }[] }
  | { ok: false; refusal: "insufficient_credits" };

/**
 * Binds a reservation to the lots that fund it (§16).
 *
 * Plans against the lots as they are now, then commits each take atomically.
 * A take that loses its race unwinds everything already taken and refuses —
 * partial allocation is never left behind, because a hold funded by half its
 * lots is an overspend waiting to be settled.
 */
export async function allocateReservation(
  supabase: SupabaseClient,
  params: {
    creditAccountId: string;
    reservationId: string;
    creditUnits: CreditUnits;
    now?: Date;
  },
): Promise<AllocateResult> {
  const now = params.now ?? new Date();
  const lots = await listActiveLots(supabase, params.creditAccountId);

  const plan: AllocationPlan = planAllocation(lots, params.creditUnits, now);
  if (!plan.ok) return { ok: false, refusal: "insufficient_credits" };

  const taken: { lotId: string; creditUnits: CreditUnits }[] = [];

  for (const allocation of plan.allocations) {
    const ok = await takeFromLot(supabase, allocation.lotId, allocation.creditUnits);
    if (!ok) {
      for (const undo of taken) await returnToLot(supabase, undo.lotId, undo.creditUnits);
      return { ok: false, refusal: "insufficient_credits" };
    }
    taken.push({ lotId: allocation.lotId, creditUnits: allocation.creditUnits });
  }

  if (taken.length > 0) {
    const { error } = await supabase.from("billing_credit_allocations").insert(
      taken.map((allocation) => ({
        grant_id: allocation.lotId,
        credit_account_id: params.creditAccountId,
        reservation_id: params.reservationId,
        credit_units: allocation.creditUnits,
        status: "held",
      })),
    );

    if (error) {
      for (const undo of taken) await returnToLot(supabase, undo.lotId, undo.creditUnits);
      throw error;
    }
  }

  return { ok: true, allocations: taken };
}

type AllocationRow = {
  id: string;
  grant_id: string;
  credit_units: number;
  status: "held" | "consumed" | "released";
  consumed_units: number | null;
};

const ALLOCATION_COLUMNS = "id, grant_id, credit_units, status, consumed_units";

export async function listReservationAllocations(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<{ id: string; grantId: string; creditUnits: CreditUnits; status: AllocationRow["status"]; consumedUnits: CreditUnits | null }[]> {
  const { data, error } = await supabase
    .from("billing_credit_allocations")
    .select(ALLOCATION_COLUMNS)
    .eq("reservation_id", reservationId)
    // Ascending creation order is the spend order that produced them, and
    // settlement must consume them in that order (§16).
    .order("created_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as AllocationRow[]).map((row) => ({
    id: row.id,
    grantId: row.grant_id,
    creditUnits: creditUnits(row.credit_units),
    status: row.status,
    consumedUnits: row.consumed_units == null ? null : creditUnits(row.consumed_units),
  }));
}

/**
 * Applies a settlement across the lots a reservation held (§16, §76).
 *
 * Idempotent: allocations already in a terminal state are skipped, so a retried
 * settlement neither double-consumes a lot nor returns capacity twice.
 */
export async function settleReservationAllocations(
  supabase: SupabaseClient,
  params: { reservationId: string; actualCredits: CreditUnits },
): Promise<void> {
  const allocations = await listReservationAllocations(supabase, params.reservationId);
  const held: HeldAllocation[] = allocations
    .filter((allocation) => allocation.status === "held")
    .map((allocation) => ({
      id: allocation.id,
      lotId: allocation.grantId,
      creditUnits: allocation.creditUnits,
    }));

  if (held.length === 0) return;

  const settlements = settleAcrossLots(held, params.actualCredits);
  const settledAt = new Date().toISOString();

  for (const settlement of settlements) {
    if (settlement.outcome === "consumed") {
      const { error } = await supabase
        .from("billing_credit_allocations")
        .update({ status: "consumed", consumed_units: settlement.consumedUnits, settled_at: settledAt })
        .eq("id", settlement.allocationId)
        .eq("status", "held");

      if (error) throw error;
      await returnToLot(supabase, settlement.lotId, settlement.releasedUnits);
      continue;
    }

    const { error } = await supabase
      .from("billing_credit_allocations")
      .update({ status: "released", released_at: settledAt })
      .eq("id", settlement.allocationId)
      .eq("status", "held");

    if (error) throw error;
    await returnToLot(supabase, settlement.lotId, settlement.releasedUnits);
  }
}

/** Hands every held allocation back to its lot (§75). */
export async function releaseReservationAllocations(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<void> {
  const allocations = await listReservationAllocations(supabase, reservationId);
  const releasedAt = new Date().toISOString();

  for (const allocation of allocations) {
    if (allocation.status !== "held") continue;

    const { error } = await supabase
      .from("billing_credit_allocations")
      .update({ status: "released", released_at: releasedAt })
      .eq("id", allocation.id)
      .eq("status", "held");

    if (error) throw error;
    await returnToLot(supabase, allocation.grantId, allocation.creditUnits);
  }
}

/* ---------------------------------------------------------------------------
 * Expiry
 * ------------------------------------------------------------------------ */

/** Which lots currently have a live hold — the sweep's deferral condition. */
async function lotsWithLiveHolds(
  supabase: SupabaseClient,
  creditAccountId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("billing_credit_allocations")
    .select("grant_id")
    .eq("credit_account_id", creditAccountId)
    .eq("status", "held");

  if (error) throw error;
  return new Set(((data ?? []) as { grant_id: string }[]).map((row) => row.grant_id));
}

export type ExpirySweepEntry = {
  lotId: string;
  sourceKind: CreditSourceKind;
  expiringUnits: CreditUnits;
};

/**
 * Finds the lots that have lapsed and are safe to sweep (§17, §59).
 *
 * Read-only. The caller posts the compensating ledger entries and marks the
 * lots, because that has to happen in the same place the balance moves.
 */
export async function findLotsToExpire(
  supabase: SupabaseClient,
  creditAccountId: string,
  now: Date = new Date(),
): Promise<ExpirySweepEntry[]> {
  const [lots, heldLotIds] = await Promise.all([
    listActiveLots(supabase, creditAccountId),
    lotsWithLiveHolds(supabase, creditAccountId),
  ]);

  return lotsDueForExpiry(
    lots.map((lot) => ({ lot, hasLiveHold: heldLotIds.has(lot.id) })),
    now,
  );
}

/**
 * Marks a lot expired for the exact amount that lapsed.
 *
 * Guarded on `status = 'active'` so two concurrent sweeps cannot both claim the
 * same lot — the loser updates zero rows and posts nothing. The lot row itself
 * is never deleted and its `initial_credit_units` is never rewritten: "100
 * Welcome Credits, expired Aug 30" stays answerable forever (§60).
 */
export async function markLotExpired(
  supabase: SupabaseClient,
  params: { lotId: string; expiringUnits: CreditUnits; allocatedAtSweep: CreditUnits },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("billing_credit_grants")
    .update({
      status: "expired",
      expired_at: new Date().toISOString(),
      expired_credit_units: params.expiringUnits,
    })
    .eq("id", params.lotId)
    .eq("status", "active")
    .eq("allocated_credit_units", params.allocatedAtSweep)
    .select("id");

  if (error) throw error;
  return Boolean(data && data.length > 0);
}

/** A lot's current allocated figure, for the sweep's compare-and-swap guard. */
export async function readLotAllocated(
  supabase: SupabaseClient,
  lotId: string,
): Promise<CreditUnits | null> {
  const { data, error } = await supabase
    .from("billing_credit_grants")
    .select("allocated_credit_units")
    .eq("id", lotId)
    .maybeSingle();

  if (error) throw error;
  return data ? creditUnits((data as { allocated_credit_units: number }).allocated_credit_units) : null;
}
