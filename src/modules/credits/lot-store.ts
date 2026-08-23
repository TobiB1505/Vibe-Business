import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  lotsDueForExpiry,
  planAllocation,
  reconcileLotAllocation,
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
 * A reservation is still admitted by the row-locked `materialize_reservation_hold`
 * primitive `store.ts` calls — proven under real concurrency and not touched
 * here. Allocation runs *after* admission and answers a different question:
 * not "may this hold exist?" but "whose Credits fund it?".
 *
 * `takeFromLot` keeps the compare-and-swap shape PostgREST forces on every
 * writer with no independent durable row to lock instead: read, guard the
 * write on the value read, retry on a lost swap. `materializeAllocationCapacity`
 * (ADR 0042 §P3) does not need that shape, because by the time it is called an
 * allocation row already exists in its terminal status — the row itself is
 * what a Postgres row lock serializes on, so there is no swap to lose. Only
 * `allocateReservation`'s unwind of a plan that never committed an allocation
 * row stays on the old shape, for the same reason `takeFromLot` does: nothing
 * durable exists yet for the primitive to read.
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

async function findLotById(supabase: SupabaseClient, lotId: string): Promise<CreditLot | null> {
  const { data, error } = await supabase
    .from("billing_credit_grants")
    .select(LOT_COLUMNS)
    .eq("id", lotId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapLot(data as LotRow) : null;
}

/**
 * Detects and, when enabled, repairs drift between each of an account's
 * lots' materialized `allocated_credit_units` and the allocation rows that
 * define it (ADR 0042 §P3).
 *
 * Mirrors `reconcileAndRepairBalance` (`credits/service.ts`) in shape: the
 * allocation rows are authority, the materialized figure on the grant is a
 * cache of them, and a lot found inconsistent has found a real defect —
 * proven one-directional by the ADR (only ever overstates `allocated_credit_units`,
 * from an unreturned capacity return, never understates it), so drift here
 * can only *understate* what `spendableCapacity` reports a customer can spend.
 *
 * Every automatic action posts through `recordAuditEvent`, the same three
 * events the account side uses. Never throws: a repair failure for one lot is
 * audited and that lot's un-repaired figure is kept, so one bad lot cannot
 * fail every other lot in the same account or the read this is triggered
 * from.
 *
 * Returns the lots array with any repaired lot's `allocatedCreditUnits`
 * corrected in place, so a caller computing `spendableCapacity` from the
 * result sees the correction within the same request — re-reading only the
 * one lot row repair touched, not re-fetching allocations, since repair
 * changes the grant's cache and each allocation's marker, never the
 * allocation's own `status`/`credit_units`/`consumed_units` this already read.
 */
export async function reconcileAndRepairLotAllocations(
  supabase: SupabaseClient,
  params: {
    lots: readonly CreditLot[];
    allocationsByGrant: ReadonlyMap<string, LotAllocationSummary[]>;
    userId: string;
  },
): Promise<{ lots: CreditLot[]; consistent: boolean }> {
  const corrected: CreditLot[] = [];
  let allConsistent = true;

  for (const lot of params.lots) {
    const allocations = params.allocationsByGrant.get(lot.id) ?? [];
    const reconciliation = reconcileLotAllocation(lot, allocations);

    if (reconciliation.consistent) {
      corrected.push(lot);
      continue;
    }

    // Observable, never silent (§66). A drifted lot is a financial defect.
    console.error("[billing] a lot's materialized allocation disagrees with its allocation rows", {
      grantId: lot.id,
      drift: reconciliation.drift,
    });

    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "credit_drift.detected",
      metadata: { grantId: lot.id, drift: reconciliation.drift },
    });

    if (process.env.BILLING_REPAIR_ENABLED !== "true") {
      allConsistent = false;
      corrected.push(lot);
      continue;
    }

    try {
      await repairLotAllocation(supabase, lot.id);
    } catch (error) {
      allConsistent = false;
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "credit_drift.repair_failed",
        metadata: {
          grantId: lot.id,
          code: (error as { code?: string })?.code ?? null,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      corrected.push(lot);
      continue;
    }

    const refreshed = await findLotById(supabase, lot.id);
    if (!refreshed) {
      allConsistent = false;
      corrected.push(lot);
      continue;
    }

    const reCheck = reconcileLotAllocation(refreshed, allocations);
    if (!reCheck.consistent) {
      allConsistent = false;
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "credit_drift.repair_failed",
        metadata: {
          grantId: lot.id,
          reason: "still_inconsistent_after_repair",
          drift: reCheck.drift,
        },
      });
      corrected.push(refreshed);
      continue;
    }

    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "credit_drift.repaired",
      metadata: {
        grantId: lot.id,
        allocatedBefore: lot.allocatedCreditUnits,
        allocatedAfter: refreshed.allocatedCreditUnits,
      },
    });

    corrected.push(refreshed);
  }

  return { lots: corrected, consistent: allConsistent };
}

/* ---------------------------------------------------------------------------
 * Allocation
 * ------------------------------------------------------------------------ */

/**
 * Test-only observability hook into `takeFromLot`/`returnToLot`'s
 * compare-and-swap retry loop, threaded optionally through
 * {@link allocateReservation}. Production never passes one, so this changes
 * no behavior — it exists because the round count a real call needed was
 * otherwise unobservable from outside these two functions (Sprint 0057 E2b),
 * which made `CONTENTION_ATTEMPTS`'s minimality unmeasurable rather than
 * merely unmeasured. See `src/modules/credits/concurrency/allocation.concurrency.ts`.
 */
type ContentionObserver = (fn: "takeFromLot" | "returnToLot", attempt: number) => void;

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
  onContentionRound?: ContentionObserver,
): Promise<boolean> {
  for (let attempt = 0; attempt < CONTENTION_ATTEMPTS; attempt += 1) {
    onContentionRound?.("takeFromLot", attempt);
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

/**
 * Hands capacity back to a lot directly, with no allocation row behind it.
 *
 * The one remaining caller is `allocateReservation`'s failure-unwind path,
 * which undoes a `takeFromLot` for a plan that never committed — no
 * `billing_credit_allocations` row was ever inserted for it, because that
 * insert only happens after every take in the plan succeeds. That is the
 * same structural reason `takeFromLot` itself keeps this CAS-retry shape
 * rather than moving to `materialize_allocation_capacity` (ADR 0042 §P3):
 * that primitive locks and reads an *allocation row's own* status and
 * consumed amount, and there is no row here for it to read. Every caller
 * that does have one — `settleReservationAllocations`,
 * `releaseReservationAllocations` — uses {@link materializeAllocationCapacity}
 * instead.
 */
async function returnToLot(
  supabase: SupabaseClient,
  lotId: string,
  amount: CreditUnits,
  onContentionRound?: ContentionObserver,
): Promise<void> {
  if (amount <= 0) return;

  for (let attempt = 0; attempt < CONTENTION_ATTEMPTS; attempt += 1) {
    onContentionRound?.("returnToLot", attempt);
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

/**
 * Returns one allocation's unconsumed capacity to its lot, atomically
 * (ADR 0042 §P3).
 *
 * A thin `.rpc()` call onto `materialize_allocation_capacity`. The function
 * locks the allocation row and its lot, reads the amount to return from the
 * allocation row's own `credit_units`/`consumed_units` and its
 * `capacity_materialized_at` marker, and applies it exactly once — so callers
 * pass only the allocation id, never a pre-computed amount, and it is safe to
 * call twice for the same allocation from any two callers (a hot-path settle
 * or release, and a future repair scan) in any order.
 *
 * Both callers here flip the allocation row to its terminal status
 * immediately before calling this, so the row this reads back is exactly the
 * one they just wrote.
 */
async function materializeAllocationCapacity(supabase: SupabaseClient, allocationId: string): Promise<void> {
  const { error } = await supabase.rpc("materialize_allocation_capacity", {
    p_allocation_id: allocationId,
  });
  if (error) throw error;
}

/**
 * Repairs one lot's materialized `allocated_credit_units` from its allocation
 * rows (ADR 0042 §P3).
 *
 * A thin `.rpc()` call onto `repair_lot_allocation`, mirroring
 * `repairAccountBalance` (`credits/store.ts`) exactly: it scans for
 * allocations whose `capacity_materialized_at` marker is still unset and
 * delegates each to `materialize_allocation_capacity`, so it shares that
 * primitive's exact locking and idempotency rather than recomputing a total.
 * Only ever called from behind `BILLING_REPAIR_ENABLED` — see
 * `reconcileAndRepairLotAllocations` (`credits/lots.ts`).
 */
export async function repairLotAllocation(supabase: SupabaseClient, grantId: string): Promise<void> {
  const { error } = await supabase.rpc("repair_lot_allocation", { p_grant_id: grantId });
  if (error) throw error;
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
    /** Test-only; see {@link ContentionObserver}. Never set by production callers. */
    onContentionRound?: ContentionObserver;
  },
): Promise<AllocateResult> {
  const now = params.now ?? new Date();
  const lots = await listActiveLots(supabase, params.creditAccountId);

  const plan: AllocationPlan = planAllocation(lots, params.creditUnits, now);
  if (!plan.ok) return { ok: false, refusal: "insufficient_credits" };

  const taken: { lotId: string; creditUnits: CreditUnits }[] = [];
  // One flag, one unwind. A bare `finally` would hand capacity back on success
  // too; two unwind paths would hand it back twice for one failure.
  let committed = false;

  try {
    for (const allocation of plan.allocations) {
      const ok = await takeFromLot(
        supabase,
        allocation.lotId,
        allocation.creditUnits,
        params.onContentionRound,
      );
      if (!ok) return { ok: false, refusal: "insufficient_credits" };
      taken.push({ lotId: allocation.lotId, creditUnits: allocation.creditUnits });
    }

    if (taken.length > 0) {
      // One batch insert, so the rows are all-or-nothing. That is what makes
      // "zero allocation rows" a state a recovery can reason about rather than
      // guess at — see `operation-billing.ts` and §I2.
      const { error } = await supabase.from("billing_credit_allocations").insert(
        taken.map((allocation) => ({
          grant_id: allocation.lotId,
          credit_account_id: params.creditAccountId,
          reservation_id: params.reservationId,
          credit_units: allocation.creditUnits,
          status: "held",
        })),
      );

      if (error) throw error;
    }

    committed = true;
    return { ok: true, allocations: taken };
  } finally {
    // Covers every way out that is not a commit: a refused take, a thrown
    // insert, and — the one the previous shape missed entirely — a throw from
    // `takeFromLot` itself, which escaped with capacity taken and nothing given
    // back. That was the partial allocation this function's docblock calls
    // impossible.
    if (!committed) {
      for (const undo of taken) {
        await returnToLot(supabase, undo.lotId, undo.creditUnits, params.onContentionRound);
      }
    }
  }
}

type AllocationRow = {
  id: string;
  grant_id: string;
  credit_units: number;
  status: "held" | "consumed" | "released";
  consumed_units: number | null;
};

const ALLOCATION_COLUMNS = "id, grant_id, credit_units, status, consumed_units";

export type LotAllocationSummary = {
  status: AllocationRow["status"];
  creditUnits: CreditUnits;
  consumedUnits: CreditUnits | null;
};

/**
 * Every allocation row for a set of lots, grouped by the lot (`grant_id`)
 * each belongs to — one batched query rather than one per lot (ADR 0042 §P3).
 *
 * Shaped for {@link reconcileLotAllocation} directly. A lot with no
 * allocations at all is not a special case here: it is simply absent from
 * the returned map, and `reconcileLotAllocation` already treats a missing/
 * empty allocation list as `expected: 0`.
 */
export async function listAllocationsForGrants(
  supabase: SupabaseClient,
  grantIds: readonly string[],
): Promise<Map<string, LotAllocationSummary[]>> {
  const byGrant = new Map<string, LotAllocationSummary[]>();
  if (grantIds.length === 0) return byGrant;

  const { data, error } = await supabase
    .from("billing_credit_allocations")
    .select(ALLOCATION_COLUMNS)
    .in("grant_id", grantIds);

  if (error) throw error;

  for (const row of (data ?? []) as AllocationRow[]) {
    const summary: LotAllocationSummary = {
      status: row.status,
      creditUnits: creditUnits(row.credit_units),
      consumedUnits: row.consumed_units == null ? null : creditUnits(row.consumed_units),
    };
    const existing = byGrant.get(row.grant_id);
    if (existing) existing.push(summary);
    else byGrant.set(row.grant_id, [summary]);
  }

  return byGrant;
}

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
    const patch =
      settlement.outcome === "consumed"
        ? { status: "consumed", consumed_units: settlement.consumedUnits, settled_at: settledAt }
        : { status: "released", released_at: settledAt };

    const { data, error } = await supabase
      .from("billing_credit_allocations")
      .update(patch)
      .eq("id", settlement.allocationId)
      // The swap. `.select("id")` is what makes its outcome observable — without
      // it a lost swap and a won one are the same empty response.
      .eq("status", "held")
      .select("id");

    if (error) throw error;
    // Lost the swap: somebody else moved this allocation out of `held` and has
    // already returned its capacity. Returning it again would inflate the lot
    // past what it ever held.
    if (!data || data.length === 0) continue;

    await materializeAllocationCapacity(supabase, settlement.allocationId);
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

    const { data, error } = await supabase
      .from("billing_credit_allocations")
      .update({ status: "released", released_at: releasedAt })
      .eq("id", allocation.id)
      .eq("status", "held")
      .select("id");

    if (error) throw error;
    // Lost to a concurrent settlement, which has already accounted for this
    // allocation. Its capacity is not ours to return.
    if (!data || data.length === 0) continue;

    await materializeAllocationCapacity(supabase, allocation.id);
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
