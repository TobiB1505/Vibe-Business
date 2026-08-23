import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantCreditLot } from "../grants";
import {
  allocateReservation,
  listActiveLots,
  listReservationAllocations,
  releaseReservationAllocations,
  repairLotAllocation,
} from "../lot-store";
import { claimReservation, ensureCreditAccount } from "../store";
import { creditsToUnits, type CreditUnits } from "../units";
import {
  client,
  clients,
  createFixtureUser,
  forEachIteration,
  isClean,
  isConfigured,
  ITERATIONS,
  readAllocatedAcrossLots,
  resolveTarget,
  teardownFixture,
  type TeardownReport,
} from "./harness";

/**
 * Class R — a lot's capacity converges correctly whether the hot path or a
 * repair scan materializes an allocation's return first (ADR 0042 §P3, Lot
 * Repair Authority Design).
 *
 * Named "R" for repair, deliberately not the next letter after E — "F" is
 * already `docs/ROADMAP.md`'s name for billing-repair *activation*, an
 * unrelated concept, and reusing it here would read as this file testing
 * that instead.
 *
 * ## What no existing file proves
 *
 * Traced directly before writing this: no concurrency test anywhere in this
 * suite calls `repair_lot_allocation`. The one existing scenario that
 * reaches `materialize_allocation_capacity` (`settlement.concurrency.ts`'s
 * "partial ‖ partial") races two hot-path settlements against each other —
 * never a repair scan against a hot-path writer, and never two repair scans
 * against each other. `materialize_allocation_capacity`'s row-lock argument
 * ("whichever caller acquires the lock first wins, the other finds the
 * marker already set and no-ops") is sound reasoning about the SQL as
 * written and is unit-tested against `FakeDatabase` — this is the first
 * time it is exercised against real PostgreSQL, with a real repair caller
 * on one side.
 *
 * ## Two scenarios, not one
 *
 * **Repair ‖ hot path** races `repairLotAllocation` against the ordinary
 * `releaseReservationAllocations` call that is itself about to materialize
 * the same lot's allocations — real HTTP-level interleaving, not a forced
 * window. Whichever side's request happens to reach a given allocation's
 * row lock first materializes it; the loser's own later attempt (the hot
 * path's own `materialize_allocation_capacity` call, or a second repair
 * scan) must find the marker already set and do nothing. The assertion
 * checks the property that must hold regardless of which side won any
 * individual row — not that a specific interleaving occurred.
 *
 * **Repair ‖ repair** is the narrower, deterministic complement: allocations
 * are put into the exact state a genuine crash leaves — status already
 * flipped, `capacity_materialized_at` still unset, the same fixture
 * technique the `FakeDatabase`-level tests use for this, now against real
 * rows — and two repair scans of the same lot race with no hot-path caller
 * involved at all. This is the literal case named as untested above.
 *
 * ## What is asserted, and why from rows rather than return values
 *
 * The lot's `allocated_credit_units`, summed across all its lots via
 * {@link readAllocatedAcrossLots}, and every allocation's own `status`/
 * `capacity_materialized_at`, read back independently after every race —
 * never inferred from whether a call resolved or rejected. A lost update
 * here would show up as the aggregate disagreeing with what the rows say,
 * exactly the class of drift this whole primitive exists to prevent.
 */

const LOT = creditsToUnits(1000);
const EACH_HOLD = creditsToUnits(100);
const RESERVATIONS = 4;

const configured = isConfigured();

type AllocationMarker = { status: string; capacityMaterializedAt: string | null };

/** Every allocation belonging to a set of reservations, read back directly. */
async function readAllocationMarkers(
  admin: ReturnType<typeof client>,
  reservationIds: readonly string[],
): Promise<AllocationMarker[]> {
  const { data, error } = await admin
    .from("billing_credit_allocations")
    .select("status, capacity_materialized_at")
    .in("reservation_id", reservationIds);
  if (error) throw error;

  return ((data ?? []) as { status: string; capacity_materialized_at: string | null }[]).map((row) => ({
    status: row.status,
    capacityMaterializedAt: row.capacity_materialized_at,
  }));
}

/** One lot, funded once, held by several independent reservations. */
async function lotWithSeveralHolds(
  admin: ReturnType<typeof client>,
  label: string,
  count: number,
  eachCredits: CreditUnits,
): Promise<{ userId: string; accountId: string; lotId: string; reservationIds: string[] }> {
  const { userId } = await createFixtureUser(admin, label);

  await grantCreditLot(admin, {
    userId,
    sourceKind: "purchase",
    credits: LOT,
    reason: "concurrency fixture",
    idempotencyKey: `e2b:lot-repair:${label}:${userId}`,
    expiresAt: null,
  });

  const { account } = await ensureCreditAccount(admin, userId);
  const lots = await listActiveLots(admin, account.id);
  const lotId = lots[0].id;

  const reservationIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const claim = await claimReservation(admin, {
      account,
      reservedCredits: eachCredits,
      idempotencyKey: `e2b:lot-repair:hold:${label}:${i}:${userId}`,
      projectId: null,
    });
    if (!claim.ok) throw new Error("fixture could not take a hold");

    const allocated = await allocateReservation(admin, {
      creditAccountId: account.id,
      reservationId: claim.reservation.id,
      creditUnits: eachCredits,
    });
    if (!allocated.ok) throw new Error("fixture could not allocate");

    reservationIds.push(claim.reservation.id);
  }

  return { userId, accountId: account.id, lotId, reservationIds };
}

/**
 * The same fixture, with every allocation already released directly against
 * the row — the exact state a crash between `releaseReservationAllocations`'s
 * status flip and its `materialize_allocation_capacity` call leaves behind.
 * Bypasses the RPC on purpose: this is the scenario, not a call production
 * code would make.
 */
async function lotWithPreDriftedAllocations(
  admin: ReturnType<typeof client>,
  label: string,
  count: number,
  eachCredits: CreditUnits,
): Promise<{ userId: string; accountId: string; lotId: string; reservationIds: string[] }> {
  const fixture = await lotWithSeveralHolds(admin, label, count, eachCredits);

  for (const reservationId of fixture.reservationIds) {
    const [allocation] = await listReservationAllocations(admin, reservationId);
    const { error } = await admin
      .from("billing_credit_allocations")
      .update({ status: "released", released_at: new Date().toISOString() })
      .eq("id", allocation.id);
    if (error) throw error;
  }

  return fixture;
}

describe.skipIf(!configured)("R — repair authority for lot allocation capacity", () => {
  beforeAll(() => {
    resolveTarget();
  });

  const reports: TeardownReport[] = [];
  afterAll(() => {
    expect(reports.filter((report) => !isClean(report))).toEqual([]);
  });

  it(`converges to the correct capacity when repair races the hot path releasing it, ${ITERATIONS} times`, async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const fixture = await lotWithSeveralHolds(admin, `race-${iteration}`, RESERVATIONS, EACH_HOLD);

      try {
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(EACH_HOLD * RESERVATIONS);

        const [releaserA, releaserB, repairerA, repairerB] = clients(4);
        await Promise.all([
          ...fixture.reservationIds.map((reservationId, index) =>
            releaseReservationAllocations(index % 2 === 0 ? releaserA : releaserB, reservationId).catch(
              () => undefined,
            ),
          ),
          repairLotAllocation(repairerA, fixture.lotId).catch(() => undefined),
          repairLotAllocation(repairerB, fixture.lotId).catch(() => undefined),
        ]);

        // Every hold was released. Whichever side — the release call's own
        // materialize step, or a repair scan that happened to reach a row
        // first — did it, the lot must end up holding nothing.
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(0);

        // Not inferred from the aggregate alone: every allocation actually
        // reached its terminal status and its marker.
        const markers = await readAllocationMarkers(admin, fixture.reservationIds);
        expect(markers).toHaveLength(RESERVATIONS);
        expect(markers.every((marker) => marker.status === "released")).toBe(true);
        expect(markers.every((marker) => marker.capacityMaterializedAt !== null)).toBe(true);
      } finally {
        reports.push(await teardownFixture(admin, fixture.userId));
      }
    });
  });

  it(`materializes a lot's already-drifted allocations exactly once when two repair scans race, ${ITERATIONS} times`, async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const fixture = await lotWithPreDriftedAllocations(
        admin,
        `repair-${iteration}`,
        RESERVATIONS,
        EACH_HOLD,
      );

      try {
        // The drift itself: every allocation is already released, but the
        // grant's cache has not caught up yet.
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(EACH_HOLD * RESERVATIONS);

        const repairers = clients(2);
        await Promise.all(
          repairers.map((repairer) => repairLotAllocation(repairer, fixture.lotId).catch(() => undefined)),
        );

        // Two independent scans of the same lot, each finding some or all of
        // the same unmaterialized rows — the aggregate must still land on
        // the one correct value, not twice-applied or half-applied.
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(0);

        const markers = await readAllocationMarkers(admin, fixture.reservationIds);
        expect(markers).toHaveLength(RESERVATIONS);
        expect(markers.every((marker) => marker.capacityMaterializedAt !== null)).toBe(true);
      } finally {
        reports.push(await teardownFixture(admin, fixture.userId));
      }
    });
  });
});
