import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { grantCreditLot } from "./grants";
import {
  allocateReservation,
  listActiveLots,
  listReservationAllocations,
  releaseReservationAllocations,
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

async function heldAgainstLot(credits: number): Promise<{ accountId: string; reservationId: string }> {
  const { accountId } = await accountWithLot(credits);
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
  return { accountId, reservationId: claim.reservation.id };
}

function allocatedUnits(lotId: string): number {
  const lot = db.current
    .rows("billing_credit_grants")
    .find((row) => (row as { id: string }).id === lotId) as { allocated_credit_units: number };
  return lot.allocated_credit_units;
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
