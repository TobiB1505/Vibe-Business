import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantCreditLot } from "../grants";
import { claimReservation, ensureCreditAccount, type CreditAccount } from "../store";
import { creditsToUnits } from "../units";
import {
  client,
  clients,
  createFixtureUser,
  forEachIteration,
  isClean,
  isConfigured,
  ITERATIONS,
  readInvariants,
  resolveTarget,
  teardownFixture,
  type TeardownReport,
} from "./harness";

/**
 * Race class A — hold safety and hold liveness, under real PostgreSQL.
 *
 * Twenty callers ask for 100 Credits each against a balance of exactly 1000.
 * Ten of them can be funded and ten cannot, and the two things that can go
 * wrong are opposites:
 *
 *   safety     more than ten admitted, or `available` below zero — the account
 *              promised Credits it does not have.
 *   liveness   fewer than ten admitted — a caller who *did* have the Credits
 *              was told they did not, because somebody else was quick.
 *
 * They are reported separately because they are bought by different mechanisms.
 * Safety comes from the compare-and-swap itself and, beneath it, from
 * `billing_credit_accounts_available_non_negative`; a caller that retried zero
 * times or a thousand could never overspend. Liveness is the only thing
 * `CONTENTION_ATTEMPTS` affects.
 *
 * This is the scenario `contention.ts` cites from the PR #46 stress test — 20
 * concurrent requests against an exact 1000-credit balance admitting 8 of a
 * correct 10 at three attempts — run for the first time against a real
 * database rather than a re-implementation of one.
 */

const CALLERS = 20;
const REQUEST = creditsToUnits(100);
const BALANCE = creditsToUnits(1000);
const FUNDABLE = 10;

const configured = isConfigured();

describe.skipIf(!configured)("A — twenty holds against a balance that funds exactly ten", () => {
  // Before the first write of the run, not after it.
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

  it(`admits every fundable caller and no more, ${ITERATIONS} times`, async () => {
    const admin = client();
    const durations: number[] = [];

    await forEachIteration(async (iteration) => {
      const { userId } = await createFixtureUser(admin, `holds-${iteration}`);

      try {
        await grantCreditLot(admin, {
          userId,
          sourceKind: "purchase",
          credits: BALANCE,
          reason: "concurrency fixture",
          idempotencyKey: `e2b:holds:${iteration}:${userId}`,
          expiresAt: null,
        });

        const { account } = await ensureCreditAccount(admin, userId);
        expect(account.postedCredits).toBe(BALANCE);

        // One client per caller, and one account read per caller, both done
        // *before* the race starts. Independent clients mean independent HTTP
        // requests rather than calls queued inside one; pre-reading means all
        // twenty enter the compare-and-swap holding the same snapshot, which is
        // the worst case rather than a staggered one.
        const callers = clients(CALLERS);
        const snapshots: CreditAccount[] = await Promise.all(
          callers.map(async (caller) => (await ensureCreditAccount(caller, userId)).account),
        );

        const started = Date.now();
        const results = await Promise.all(
          callers.map((caller, index) =>
            claimReservation(caller, {
              account: snapshots[index],
              reservedCredits: REQUEST,
              idempotencyKey: `e2b:hold:${iteration}:${index}`,
              projectId: null,
            }),
          ),
        );
        durations.push(Date.now() - started);

        const admitted = results.filter((result) => result.ok);
        const refused = results.filter((result) => !result.ok);
        const state = await readInvariants(admin, account.id);

        /* ---------------- safety ---------------- */
        // Asserted first and asserted against rows, so that a change chasing
        // liveness cannot buy it by overspending.
        expect(state.reservedCredits).toBeLessThanOrEqual(BALANCE);
        expect(state.available).toBeGreaterThanOrEqual(0);
        expect(state.postedCredits).toBe(BALANCE);
        // The materialised cache and the rows it summarises must agree. A lost
        // update is exactly this disagreement.
        expect(state.reservedCredits).toBe(state.activeReservedSum);
        expect(state.ledgerSum).toBe(state.postedCredits);
        expect(state.reservedCredits).toBe(creditsToUnits(100 * state.activeReservations));

        /* ---------------- liveness ---------------- */
        // The balance funds exactly ten, so "no fundable caller was lost purely
        // to contention" and "exactly ten were admitted" are the same statement.
        // Nine would mean 100 Credits of genuine, fundable demand went unclaimed.
        expect(admitted).toHaveLength(FUNDABLE);
        expect(refused).toHaveLength(CALLERS - FUNDABLE);
        for (const result of refused) {
          expect(result).toMatchObject({ ok: false, refusal: "insufficient_credits" });
        }

        /* ---------------- what persisted ---------------- */
        // Ten live holds, and ten rows that claimed a hold and gave it back.
        // `claimReservation` inserts the reservation before `admitHold`, so a
        // refusal must leave a voided row rather than an active one.
        expect(state.activeReservations).toBe(FUNDABLE);
        expect(state.reservationStatuses).toEqual({
          active: FUNDABLE,
          released: CALLERS - FUNDABLE,
        });

        // Distinct rows, not one row counted ten times.
        const ids = new Set(
          admitted.map((result) => (result as { reservation: { id: string } }).reservation.id),
        );
        expect(ids.size).toBe(FUNDABLE);
      } finally {
        reports.push(await teardownFixture(admin, userId));
      }
    });

    // Reported, not asserted. How many compare-and-swap rounds a caller needed
    // is not observable from outside `admitHold`, and instrumenting the
    // function under test would change it. Wall-clock is the closest honest
    // proxy: the backoff sleeps, so a race that needed many rounds took longer.
    const total = durations.reduce((sum, value) => sum + value, 0);
    console.log(
      `\nA — ${ITERATIONS} iterations of ${CALLERS} concurrent holds\n` +
        `  admitted per iteration: ${FUNDABLE}/${CALLERS}, every iteration\n` +
        `  race wall-clock: min ${Math.min(...durations)}ms, ` +
        `max ${Math.max(...durations)}ms, mean ${Math.round(total / durations.length)}ms`,
    );
  });

  /**
   * The other direction, so the scenario above cannot be satisfied by a change
   * that simply stopped refusing.
   */
  it("refuses a hold the balance genuinely cannot cover", async () => {
    const admin = client();
    const { userId } = await createFixtureUser(admin, "holds-oversized");

    try {
      await grantCreditLot(admin, {
        userId,
        sourceKind: "purchase",
        credits: BALANCE,
        reason: "concurrency fixture",
        idempotencyKey: `e2b:holds:oversized:${userId}`,
        expiresAt: null,
      });
      const { account } = await ensureCreditAccount(admin, userId);

      const claim = await claimReservation(admin, {
        account,
        reservedCredits: creditsToUnits(1001),
        idempotencyKey: `e2b:hold:oversized:${userId}`,
        projectId: null,
      });

      expect(claim).toMatchObject({ ok: false, refusal: "insufficient_credits" });
      const state = await readInvariants(admin, account.id);
      expect(state.reservedCredits).toBe(0);
      expect(state.activeReservations).toBe(0);
    } finally {
      reports.push(await teardownFixture(admin, userId));
    }
  });
});
