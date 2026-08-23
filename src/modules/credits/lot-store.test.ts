import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { grantCreditLot } from "./grants";
import {
  allocateReservation,
  listActiveLots,
  listAllocationsForGrants,
  listReservationAllocations,
  reconcileAndRepairLotAllocations,
  releaseReservationAllocations,
  repairLotAllocation,
  settleReservationAllocations,
} from "./lot-store";
import { claimReservation, ensureCreditAccount, postLedgerEntry } from "./store";
import { creditsToUnits, type CreditUnits } from "./units";

/**
 * Sprint 0057 — lot capacity is returned exactly once, or not at all.
 *
 * Both allocation writers carried `.eq("status", "held")` as a compare-and-swap
 * and then never looked at whether the swap won: Supabase's `.update()` without
 * `.select()` returns no row count, so a lost swap is indistinguishable from a
 * won one — and `returnToLot` ran unconditionally on the next line. Two
 * concurrent settlements of the same reservation therefore both handed capacity
 * back, inflating the lot beyond what it ever held.
 *
 * `takeFromLot`, `returnToLot`, `closeReservation` and `markLotExpired` all
 * append `.select("id")` and check the count. These two were the exceptions.
 *
 * The second defect is the mirror image: `allocateReservation` unwinds its
 * taken capacity only in the insert-error branch, so a *throw* from
 * `takeFromLot` — any non-CHECK Postgres error, a dropped connection — escaped
 * with capacity taken and nothing given back. Its docblock calls that state
 * impossible.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db.current = new FakeDatabase();
});

/** One purchased lot of `credits`, and an account funded to match. */
async function accountWithLot(credits: number): Promise<{ accountId: string; lotId: string }> {
  const { account } = await ensureCreditAccount(supabase(), USER);
  await grantCreditLot(supabase(), {
    userId: USER,
    sourceKind: "purchase",
    credits: creditsToUnits(credits),
    reason: "test lot",
    idempotencyKey: `lot:${credits}`,
    expiresAt: null,
  });
  const lots = await listActiveLots(supabase(), account.id);
  return { accountId: account.id, lotId: lots[0].id };
}

async function heldAgainstLot(
  credits: number,
): Promise<{ accountId: string; lotId: string; reservationId: string }> {
  const { accountId, lotId } = await accountWithLot(credits);
  const account = (await ensureCreditAccount(supabase(), USER)).account;
  const claim = await claimReservation(supabase(), {
    account,
    reservedCredits: creditsToUnits(credits),
    idempotencyKey: `hold:${credits}`,
    projectId: PROJECT,
  });
  if (!claim.ok) throw new Error("fixture could not take a hold");
  const allocated = await allocateReservation(supabase(), {
    creditAccountId: accountId,
    reservationId: claim.reservation.id,
    creditUnits: creditsToUnits(credits),
  });
  if (!allocated.ok) throw new Error("fixture could not allocate");
  return { accountId, lotId, reservationId: claim.reservation.id };
}

function allocatedUnits(lotId: string): number {
  const lot = db.current
    .rows("billing_credit_grants")
    .find((row) => (row as { id: string }).id === lotId) as { allocated_credit_units: number };
  return lot.allocated_credit_units;
}

/** Every `.rpc()` call fails with an error no repair/materialization path recognizes. */
function rpcAlwaysErrors(): ReturnType<typeof supabase> {
  const real = supabase();
  return {
    ...real,
    rpc: () => ({
      then: (onfulfilled: (value: { data: null; error: unknown }) => unknown) =>
        Promise.resolve({ data: null, error: { code: "53300", message: "too many connections" } }).then(
          onfulfilled,
        ),
    }),
  } as unknown as ReturnType<typeof supabase>;
}

describe("capacity is returned exactly once", () => {
  it("does not return a lot's capacity twice when two settlements race", async () => {
    const { reservationId } = await heldAgainstLot(300);
    const lots = await listActiveLots(supabase(), (await ensureCreditAccount(supabase(), USER)).account.id);
    const lotId = lots[0].id;
    expect(allocatedUnits(lotId)).toBe(creditsToUnits(300));

    // Both settle the same reservation, both see the allocation as held.
    await Promise.all([
      settleReservationAllocations(supabase(), {
        reservationId,
        actualCredits: creditsToUnits(100),
      }),
      settleReservationAllocations(supabase(), {
        reservationId,
        actualCredits: creditsToUnits(100),
      }),
    ]);

    // 100 consumed of 300 held, so 200 comes back and 100 stays allocated.
    // Returning twice leaves 0 — a lot reporting more free capacity than it has.
    expect(allocatedUnits(lotId)).toBe(creditsToUnits(100));
  });

  it("does not return a lot's capacity twice when a settle and a release race", async () => {
    const { reservationId } = await heldAgainstLot(300);
    const lots = await listActiveLots(supabase(), (await ensureCreditAccount(supabase(), USER)).account.id);
    const lotId = lots[0].id;

    await Promise.all([
      settleReservationAllocations(supabase(), {
        reservationId,
        actualCredits: creditsToUnits(300),
      }),
      releaseReservationAllocations(supabase(), reservationId),
    ]);

    // The settlement consumed the whole hold, so nothing is returned. A release
    // that acts on an allocation it did not win drops the lot to 0.
    expect(allocatedUnits(lotId)).toBe(creditsToUnits(300));
  });
});

describe("a failed allocation leaves no capacity taken", () => {
  it("unwinds when the allocation insert fails", async () => {
    const { accountId, lotId } = await accountWithLot(500);
    const account = (await ensureCreditAccount(supabase(), USER)).account;
    const claim = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(200),
      idempotencyKey: "hold:insert-fails",
      projectId: PROJECT,
    });
    if (!claim.ok) throw new Error("fixture could not take a hold");

    db.current.failNextWriteWith = {
      table: "billing_credit_allocations",
      message: "connection lost",
    };

    await expect(
      allocateReservation(supabase(), {
        creditAccountId: accountId,
        reservationId: claim.reservation.id,
        creditUnits: creditsToUnits(200),
      }),
    ).rejects.toThrow();

    // Nothing was recorded, so nothing may be held against the lot.
    expect(await listReservationAllocations(supabase(), claim.reservation.id)).toHaveLength(0);
    expect(allocatedUnits(lotId)).toBe(0);
  });

  it("unwinds when a lot take throws part-way through", async () => {
    // Two lots, so the second take is reached with the first already taken.
    const { account } = await ensureCreditAccount(supabase(), USER);
    for (const label of ["first", "second"]) {
      await grantCreditLot(supabase(), {
        userId: USER,
        sourceKind: "purchase",
        credits: creditsToUnits(100),
        reason: "test lot",
        idempotencyKey: `lot:${label}`,
        expiresAt: null,
      });
    }
    await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "adjustment",
      creditDelta: creditsToUnits(1),
      idempotencyKey: "nudge",
      reason: "test",
    });

    const lots = await listActiveLots(supabase(), account.id);
    expect(lots.length).toBeGreaterThan(1);

    const claim = await claimReservation(supabase(), {
      account: (await ensureCreditAccount(supabase(), USER)).account,
      reservedCredits: creditsToUnits(150),
      idempotencyKey: "hold:take-throws",
      projectId: PROJECT,
    });
    if (!claim.ok) throw new Error("fixture could not take a hold");

    // The take loop reads the lot before writing it, so failing the *write*
    // to grants mid-loop is the throw this test is about.
    let writes = 0;
    const throwsOnSecondTake = {
      from(table: string) {
        const target = (
          supabase() as unknown as { from: (t: string) => Record<string, unknown> }
        ).from(table);
        if (table !== "billing_credit_grants") return target;
        return {
          ...target,
          update: (payload: Record<string, unknown>) => {
            writes += 1;
            if (writes === 2) throw new Error("connection lost mid-take");
            return (target.update as (p: Record<string, unknown>) => unknown)(payload);
          },
        };
      },
    } as unknown as ReturnType<typeof supabase>;

    await expect(
      allocateReservation(throwsOnSecondTake, {
        creditAccountId: account.id,
        reservationId: claim.reservation.id,
        creditUnits: creditsToUnits(150),
      }),
    ).rejects.toThrow();

    // The first lot's capacity must have gone back. Partial allocation is what
    // `allocateReservation`'s own docblock calls impossible.
    const after = await listActiveLots(supabase(), account.id);
    const stillTaken = after.reduce<number>((total, lot) => total + lot.allocatedCreditUnits, 0);
    expect(stillTaken).toBe(0);
    expect(await listReservationAllocations(supabase(), claim.reservation.id)).toHaveLength(0);
  });
});

/** Nothing above should have changed what a clean allocation does. */
describe("an ordinary allocation still works", () => {
  it("takes capacity and records one row per lot", async () => {
    const { reservationId } = await heldAgainstLot(300);
    const rows = await listReservationAllocations(supabase(), reservationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].creditUnits as CreditUnits).toBe(creditsToUnits(300));
  });
});

/**
 * ADR 0042 §P3 — capacity return is now one `.rpc()` call, not a retry loop.
 *
 * `settleReservationAllocations`/`releaseReservationAllocations` flip the
 * allocation row's status and then call `materialize_allocation_capacity`
 * with the allocation's id. There is no longer a compare-and-swap around that
 * call to exhaust, so an error the function raises — anything other than the
 * status flip's own guard already having refused a lost race — must reach the
 * caller rather than being swallowed silently, exactly as `store.ts`'s
 * equivalent calls do.
 */
describe("an unrecognized capacity-return failure is never swallowed", () => {
  it("propagates a failure to return capacity on settlement", async () => {
    const { reservationId } = await heldAgainstLot(300);

    await expect(
      settleReservationAllocations(rpcAlwaysErrors(), {
        reservationId,
        actualCredits: creditsToUnits(100),
      }),
    ).rejects.toMatchObject({ code: "53300" });
  });

  it("propagates a failure to return capacity on release", async () => {
    const { reservationId } = await heldAgainstLot(300);

    await expect(releaseReservationAllocations(rpcAlwaysErrors(), reservationId)).rejects.toMatchObject({
      code: "53300",
    });
  });
});

describe("listAllocationsForGrants (ADR 0042 §P3)", () => {
  it("groups allocation rows by the lot they belong to", async () => {
    const { accountId, lotId: lotId1 } = await heldAgainstLot(300);
    // `accountWithLot`'s own `lotId` is unreliable once an account already
    // holds a lot — it reads back `listActiveLots()[0]`, which is not
    // guaranteed to be the lot just granted. Found by exclusion instead.
    await accountWithLot(200);
    const lotId2 = (await listActiveLots(supabase(), accountId)).map((lot) => lot.id).find(
      (id) => id !== lotId1,
    )!;

    // Lot one is now fully allocated (300/300), so this reservation's plan
    // must land on lot two — the grouping under test does not care how an
    // allocation came to exist, only that two lots produce two groups.
    const account = (await ensureCreditAccount(supabase(), USER)).account;
    const claim = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(50),
      idempotencyKey: "hold:second-lot",
      projectId: PROJECT,
    });
    if (!claim.ok) throw new Error("fixture could not take a second hold");
    const allocated = await allocateReservation(supabase(), {
      creditAccountId: accountId,
      reservationId: claim.reservation.id,
      creditUnits: creditsToUnits(50),
    });
    if (!allocated.ok) throw new Error("fixture could not allocate against the second lot");

    const byGrant = await listAllocationsForGrants(supabase(), [lotId1, lotId2]);

    expect(byGrant.get(lotId1)).toHaveLength(1);
    expect(byGrant.get(lotId1)?.[0]).toMatchObject({ status: "held", creditUnits: creditsToUnits(300) });
    expect(byGrant.get(lotId2)).toHaveLength(1);
    expect(byGrant.get(lotId2)?.[0]).toMatchObject({ status: "held", creditUnits: creditsToUnits(50) });
  });

  it("omits a lot with no allocations rather than returning an empty array for it", async () => {
    const { lotId } = await accountWithLot(100);

    const byGrant = await listAllocationsForGrants(supabase(), [lotId]);

    expect(byGrant.has(lotId)).toBe(false);
  });

  it("is a no-op for an empty grant list", async () => {
    const byGrant = await listAllocationsForGrants(supabase(), []);
    expect(byGrant.size).toBe(0);
  });
});

describe("repairLotAllocation (ADR 0042 §P3)", () => {
  it("calls repair_lot_allocation for the lot", async () => {
    const { lotId } = await accountWithLot(100);

    // No unmaterialized allocation exists yet — a clean call proves only that
    // the RPC reaches the right function and function name without erroring.
    await expect(repairLotAllocation(supabase(), lotId)).resolves.toBeUndefined();
  });

  it("propagates an unrecognized repair failure", async () => {
    const { lotId } = await accountWithLot(100);

    await expect(repairLotAllocation(rpcAlwaysErrors(), lotId)).rejects.toMatchObject({ code: "53300" });
  });
});

/**
 * `reconcileAndRepairLotAllocations` (ADR 0042 §P3) — the lot-side repair
 * trigger wired into `getBillingOverview`. Mirrors `reconcileAndRepairBalance`
 * (`credits/service.test.ts`) in shape and in what each test proves.
 */
describe("reconcileAndRepairLotAllocations (ADR 0042 §P3)", () => {
  const previousFlag = process.env.BILLING_REPAIR_ENABLED;

  beforeEach(() => {
    delete process.env.BILLING_REPAIR_ENABLED;
  });

  afterEach(() => {
    if (previousFlag === undefined) delete process.env.BILLING_REPAIR_ENABLED;
    else process.env.BILLING_REPAIR_ENABLED = previousFlag;
  });

  /**
   * Simulates a crash between an allocation's status flip and its
   * `materialize_allocation_capacity` call: the allocation is terminal, but
   * `capacity_materialized_at` was never set, so the grant's
   * `allocated_credit_units` still reflects the (no longer true) held state —
   * exactly the drift `reconcileLotAllocation` exists to catch.
   */
  function driftLot(allocationId: string): void {
    const allocation = db.current
      .rows("billing_credit_allocations")
      .find((row) => (row as { id: string }).id === allocationId) as {
      status: string;
      released_at: string | null;
    };
    allocation.status = "released";
    allocation.released_at = new Date().toISOString();
  }

  /** Only what this sprint writes — `grantCreditLot` posts its own unrelated event. */
  function driftEvents() {
    return db.current
      .rows("audit_events")
      .filter((row) => String(row.event_type).startsWith("credit_drift."));
  }

  async function driftedFixture(credits: number) {
    const { accountId, lotId, reservationId } = await heldAgainstLot(credits);
    const [allocation] = await listReservationAllocations(supabase(), reservationId);
    driftLot(allocation.id);

    const lots = await listActiveLots(supabase(), accountId);
    const allocationsByGrant = await listAllocationsForGrants(supabase(), [lotId]);
    return { lotId, lots, allocationsByGrant };
  }

  it("is a no-op when every lot's allocated figure already agrees with its rows", async () => {
    const { accountId, lotId } = await heldAgainstLot(100);
    const lots = await listActiveLots(supabase(), accountId);
    const allocationsByGrant = await listAllocationsForGrants(supabase(), [lotId]);

    const result = await reconcileAndRepairLotAllocations(supabase(), {
      lots,
      allocationsByGrant,
      userId: USER,
    });

    expect(result).toEqual({ lots, consistent: true });
    expect(driftEvents()).toHaveLength(0);
  });

  it("detects and audits drift without repairing while the flag is unset", async () => {
    const { lotId, lots, allocationsByGrant } = await driftedFixture(100);

    const result = await reconcileAndRepairLotAllocations(supabase(), {
      lots,
      allocationsByGrant,
      userId: USER,
    });

    expect(result.consistent).toBe(false);
    expect(result.lots[0].allocatedCreditUnits).toBe(creditsToUnits(100));
    expect(allocatedUnits(lotId)).toBe(creditsToUnits(100));

    const events = driftEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: USER,
      event_type: "credit_drift.detected",
      metadata: { grantId: lotId, drift: creditsToUnits(100) },
    });
  });

  it("repairs and audits when the flag is set", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    const { lotId, lots, allocationsByGrant } = await driftedFixture(100);

    const result = await reconcileAndRepairLotAllocations(supabase(), {
      lots,
      allocationsByGrant,
      userId: USER,
    });

    expect(result.consistent).toBe(true);
    expect(result.lots[0].allocatedCreditUnits).toBe(0);
    expect(allocatedUnits(lotId)).toBe(0);

    const events = driftEvents();
    expect(events.map((event) => event.event_type)).toEqual([
      "credit_drift.detected",
      "credit_drift.repaired",
    ]);
    expect(events[1]).toMatchObject({
      metadata: { grantId: lotId, allocatedBefore: creditsToUnits(100), allocatedAfter: 0 },
    });
  });

  it("audits repair_failed and keeps the unrepaired figure when the repair RPC throws", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    const { lotId, lots, allocationsByGrant } = await driftedFixture(100);

    const result = await reconcileAndRepairLotAllocations(rpcAlwaysErrors(), {
      lots,
      allocationsByGrant,
      userId: USER,
    });

    expect(result.consistent).toBe(false);
    expect(result.lots[0].allocatedCreditUnits).toBe(creditsToUnits(100));
    expect(allocatedUnits(lotId)).toBe(creditsToUnits(100));

    const events = driftEvents();
    expect(events.map((event) => event.event_type)).toEqual([
      "credit_drift.detected",
      "credit_drift.repair_failed",
    ]);
    expect(events[1]).toMatchObject({ metadata: { grantId: lotId, code: "53300" } });
  });

  it("repairs only the drifted lot when an account holds several", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    const { accountId, lotId: driftedLotId, reservationId } = await heldAgainstLot(100);
    const [allocation] = await listReservationAllocations(supabase(), reservationId);
    driftLot(allocation.id);
    // Same exclusion technique as `listAllocationsForGrants`'s grouping
    // test — `accountWithLot`'s own returned `lotId` is unreliable once the
    // account already holds a lot.
    await accountWithLot(50);
    const cleanLotId = (await listActiveLots(supabase(), accountId))
      .map((lot) => lot.id)
      .find((id) => id !== driftedLotId)!;

    const lots = await listActiveLots(supabase(), accountId);
    const allocationsByGrant = await listAllocationsForGrants(supabase(), [driftedLotId, cleanLotId]);

    const result = await reconcileAndRepairLotAllocations(supabase(), {
      lots,
      allocationsByGrant,
      userId: USER,
    });

    expect(result.consistent).toBe(true);
    const repaired = result.lots.find((lot) => lot.id === driftedLotId);
    const clean = result.lots.find((lot) => lot.id === cleanLotId);
    expect(repaired?.allocatedCreditUnits).toBe(0);
    expect(clean?.allocatedCreditUnits).toBe(0);
  });
});
