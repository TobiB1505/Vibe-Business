import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantCreditLot } from "../grants";
import { allocateReservation, listActiveLots, settleReservationAllocations } from "../lot-store";
import { releaseOperationCredits, settleOperationCredits } from "../operation-billing";
import { claimReservation, ensureCreditAccount, getReservation } from "../store";
import { creditsToUnits } from "../units";
import {
  client,
  clients,
  createFixtureUser,
  forEachIteration,
  isClean,
  isConfigured,
  ITERATIONS,
  readAllocatedAcrossLots,
  readAllocationPairs,
  readInvariants,
  resolveTarget,
  teardownFixture,
  type TeardownReport,
} from "./harness";

/**
 * Race class D — a hold ends once, and its capacity moves once.
 *
 * ## Which functions, and why not the ones this first reached for
 *
 * The first version of this file drove `settleReservation` and
 * `releaseReservation` from `service.ts` and asserted what happened to lot
 * capacity. Run #1 of the CI gate reported `expected 300000 to be 100000`, and
 * the code says why: those two functions own the *account* — the ledger entry
 * and the reservation row — and never touch `billing_credit_allocations`.
 * Lots belong to `operation-billing.ts`, one layer up, which settles the
 * allocations and then calls into `service.ts`.
 *
 * That was a defect in the test rather than in the product, and it is recorded
 * here rather than quietly corrected, because the fix changes what the file
 * proves: it now drives the entry points production actually calls.
 *
 * ## Three collisions, and what each can show
 *
 *   settle ‖ release   `settleOperationCredits` against
 *                      `releaseOperationCredits`. One terminal state, one
 *                      charge at most, capacity in one of two legal places.
 *   settle ‖ settle    the same settlement arriving twice. One charge.
 *   partial ‖ partial  two `settleReservationAllocations` for one reservation
 *                      at a partial amount. This is where the E1 double-return
 *                      defect lives, and it is unreachable through
 *                      `settleOperationCredits`, which settles at the full
 *                      reserved amount — a fixed-price operation has nothing
 *                      to hand back, so nothing can be handed back twice.
 *
 * ## What is asserted, and what is only counted
 *
 * The three defects E1 established: two charges for one hold; capacity handed
 * back twice, which inflated a lot beyond what it ever held; and a hold left
 * active by a settlement that stopped between its charge and its close.
 *
 * It does **not** assert a terminal-state truth table. A settlement that posts
 * its charge while a release wins the close leaves a charge whose hold was
 * given back, and E1's answer to that was to make `settleReservation` *report*
 * it as `charge_without_hold` rather than to prevent it. Asserting a rule the
 * domain does not hold would be writing new business logic inside a
 * concurrency test, so that combination is counted and printed instead.
 */

const LOT = creditsToUnits(1000);
const HOLD = creditsToUnits(300);
const PARTIAL = creditsToUnits(100);
const POLICY = "e2b-concurrency";

const configured = isConfigured();

/** One funded account holding one allocated reservation. */
async function heldAndAllocated(
  admin: ReturnType<typeof client>,
  label: string,
): Promise<{ userId: string; accountId: string; reservationId: string; lotId: string }> {
  const { userId } = await createFixtureUser(admin, label);

  await grantCreditLot(admin, {
    userId,
    sourceKind: "purchase",
    credits: LOT,
    reason: "concurrency fixture",
    idempotencyKey: `e2b:settle:${label}:${userId}`,
    expiresAt: null,
  });

  const { account } = await ensureCreditAccount(admin, userId);
  const lots = await listActiveLots(admin, account.id);

  const claim = await claimReservation(admin, {
    account,
    reservedCredits: HOLD,
    idempotencyKey: `e2b:settle:hold:${label}:${userId}`,
    projectId: null,
  });
  if (!claim.ok) throw new Error("fixture could not take a hold");

  const allocated = await allocateReservation(admin, {
    creditAccountId: account.id,
    reservationId: claim.reservation.id,
    creditUnits: HOLD,
  });
  if (!allocated.ok) throw new Error("fixture could not allocate");

  return {
    userId,
    accountId: account.id,
    reservationId: claim.reservation.id,
    lotId: lots[0].id,
  };
}

describe.skipIf(!configured)("D — a hold ends once", () => {
  beforeAll(() => {
    resolveTarget();
  });

  // Every iteration's teardown lands here and is checked once, after the tests.
  // Checked rather than assumed: leftovers would turn the next iteration's
  // exact counts into someone else's rows, and the assertion that failed would
  // be scenarios away from the cause. Checked *after* rather than inside the
  // loop so a genuine race failure keeps precedence over a cleanup problem.
  const reports: TeardownReport[] = [];
  afterAll(() => {
    expect(reports.filter((report) => !isClean(report))).toEqual([]);
  });

  it(`leaves one terminal state when a settle and a release race, ${ITERATIONS} times`, async () => {
    const admin = client();
    const outcomes: Record<string, number> = {};

    await forEachIteration(async (iteration) => {
      const fixture = await heldAndAllocated(admin, `race-${iteration}`);

      try {
        const [settler, releaser] = clients(2);
        await Promise.all([
          settleOperationCredits(settler, {
            reservationId: fixture.reservationId,
            policyVersion: POLICY,
          }).catch(() => undefined),
          releaseOperationCredits(releaser, {
            reservationId: fixture.reservationId,
            reason: "cancelled_before_usage",
          }).catch(() => undefined),
        ]);

        const state = await readInvariants(admin, fixture.accountId);
        const reservation = await getReservation(admin, fixture.reservationId);
        const allocated = await readAllocatedAcrossLots(admin, fixture.accountId);

        // The money question is answered at most once, whoever answered it.
        expect(state.chargeEntries).toBeLessThanOrEqual(1);

        // The hold is over. A settlement that stopped between its charge and
        // its close used to leave this `active` forever — the state E1's retry
        // path exists to finish.
        expect(reservation?.status).not.toBe("active");
        expect(["settled", "released", "expired"]).toContain(reservation?.status);

        // No phantom hold and no erased one: the cache equals the rows.
        expect(state.reservedCredits).toBe(state.activeReservedSum);
        expect(state.reservedCredits).toBe(0);
        expect(state.activeReservations).toBe(0);
        expect(state.available).toBeGreaterThanOrEqual(0);

        // Two legal places for the capacity and no third. A fixed-price
        // settlement consumes the whole hold, so the lot keeps all 300; a
        // release hands all 300 back, so it keeps none. Any other value means
        // capacity moved a number of times that is not one.
        expect([0, HOLD as number]).toContain(allocated);

        // Settling means the charge exists: the charge is posted before the
        // close, so a `settled` row with no charge would mean the hold ended
        // without the money question being answered.
        if (reservation?.status === "settled") {
          expect(state.chargeEntries).toBe(1);
        }

        // The money must agree with itself whatever the reservation says.
        // Stated separately from the status on purpose: this race reaches a
        // state where the charge stands and the hold reads `released`, and
        // that disagreement is about the *status*, never about the balance.
        // If a charge exists, the ledger and the lot must both show the same
        // 300 — anything else is a customer charged for capacity nobody
        // consumed, or capacity consumed with nothing charged.
        if (state.chargeEntries === 1) {
          expect(state.ledgerSum).toBe(creditsToUnits(1000 - 300));
          expect(state.postedCredits).toBe(state.ledgerSum);
          expect(allocated).toBe(HOLD);
        } else {
          expect(state.ledgerSum).toBe(creditsToUnits(1000));
          expect(allocated).toBe(0);
        }

        // Counted, not asserted. A charge whose hold was released is the state
        // E1 named `charge_without_hold` and chose to surface rather than
        // forbid; how often real interleaving reaches it is evidence.
        const key =
          `${reservation?.status ?? "missing"}` +
          `/charges=${state.chargeEntries}/allocated=${allocated}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      } finally {
        reports.push(await teardownFixture(admin, fixture.userId));
      }
    });

    console.log(
      `\nD — ${ITERATIONS} iterations of settle ‖ release\n` +
        Object.entries(outcomes)
          .sort()
          .map(([key, count]) => `  ${key}: ${count}`)
          .join("\n"),
    );
  });

  it(`charges once when two settlements race, ${ITERATIONS} times`, async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const fixture = await heldAndAllocated(admin, `double-${iteration}`);

      try {
        const settlers = clients(2);
        await Promise.all(
          settlers.map((settler) =>
            settleOperationCredits(settler, {
              reservationId: fixture.reservationId,
              policyVersion: POLICY,
            }).catch(() => undefined),
          ),
        );

        const state = await readInvariants(admin, fixture.accountId);
        const reservation = await getReservation(admin, fixture.reservationId);

        // One charge. The ledger's unique index answers the financial question
        // once, and a second settlement must inherit that answer rather than
        // post beside it.
        expect(state.chargeEntries).toBe(1);
        expect(state.ledgerSum).toBe(creditsToUnits(1000 - 300));
        expect(state.postedCredits).toBe(state.ledgerSum);

        expect(reservation?.status).toBe("settled");
        expect(state.reservedCredits).toBe(0);
        expect(state.activeReservations).toBe(0);

        // The whole hold was consumed, so all of it stays taken. Zero here
        // would mean a settlement handed back capacity the customer paid for.
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(HOLD);

        // Every allocation resolved, none left held.
        const rows = await readAllocationPairs(admin, fixture.reservationId);
        expect(rows).toHaveLength(1);
      } finally {
        reports.push(await teardownFixture(admin, fixture.userId));
      }
    });
  });

  /**
   * The E1 double-return defect, at the layer that owns it.
   *
   * `settleReservationAllocations` is the only place a hold is settled for
   * *less* than it reserved, and therefore the only place capacity comes back
   * during a settlement. Both writers carried `.eq("status", "held")` as a
   * compare-and-swap and then never looked at whether the swap won, while
   * `returnToLot` ran unconditionally on the next line — so two concurrent
   * settlements both handed capacity back and the lot ended below what it
   * genuinely still held.
   *
   * Unreachable through `settleOperationCredits`, which settles at the full
   * reserved amount: a fixed-price operation has nothing to hand back, so
   * nothing can be handed back twice.
   */
  it(`returns partial capacity once when two settlements race, ${ITERATIONS} times`, async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const fixture = await heldAndAllocated(admin, `partial-${iteration}`);

      try {
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(HOLD);

        const settlers = clients(2);
        await Promise.all(
          settlers.map((settler) =>
            settleReservationAllocations(settler, {
              reservationId: fixture.reservationId,
              actualCredits: PARTIAL,
            }).catch(() => undefined),
          ),
        );

        // 100 consumed of 300 held: 200 comes back and 100 stays taken.
        // Returning twice leaves 0 — a lot reporting more free capacity than
        // it has, which is how an account overspends without any constraint
        // noticing. This is the `300000` becoming `0` from E1.
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(PARTIAL);

        const rows = await readAllocationPairs(admin, fixture.reservationId);
        expect(rows).toHaveLength(1);
      } finally {
        reports.push(await teardownFixture(admin, fixture.userId));
      }
    });
  });
});
