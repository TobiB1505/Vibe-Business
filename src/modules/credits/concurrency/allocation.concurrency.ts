import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTENTION_ATTEMPTS } from "../contention";
import { grantCreditLot } from "../grants";
import { allocateReservation, listActiveLots, type AllocateResult } from "../lot-store";
import { claimReservation, ensureCreditAccount } from "../store";
import { creditsToUnits } from "../units";
import {
  classifyError,
  client,
  clients,
  createFixtureUser,
  forEachIteration,
  isClean,
  isConfigured,
  ITERATIONS,
  readAllocatedAcrossLots,
  readAllocationPairs,
  resolveTarget,
  teardownFixture,
  type ClassifiedError,
  type TeardownReport,
} from "./harness";

/**
 * Race class C — the unique index E1 added, enforced by PostgreSQL itself.
 *
 * E1 added `UNIQUE (reservation_id, grant_id)` to `billing_credit_allocations`
 * and could only assert it as a string in a migration file. E2a read its
 * structure back from `pg_index` on the deployed database, which proves the
 * deployed database has it and not that the migrations produce it. This proves
 * the stronger and more useful thing: that an index built from this
 * repository's own migrations refuses a real concurrent duplicate.
 *
 * ## Why the lot is deliberately larger than the hold
 *
 * `allocateReservation` takes lot capacity before inserting, under its own
 * compare-and-swap. Against a lot that funds exactly one allocation, the loser
 * is refused for capacity and the unique index is never reached — the test
 * would pass without ever exercising the thing it is named after. A lot of
 * 1000 against a hold of 300 lets *both* callers take capacity, so the
 * collision happens where it is supposed to: on the insert.
 *
 * The loser's unwind is then also under test. It must hand its 300 back, so
 * the lot ends at 300 taken and not 600 — capacity taken exactly once for a
 * hold that exists exactly once.
 */

const LOT = creditsToUnits(1000);
const HOLD = creditsToUnits(300);
const RACERS = 2;

const configured = isConfigured();

type Outcome = { ok: true; result: AllocateResult } | { ok: false; error: ClassifiedError };

describe.skipIf(!configured)("C — two allocations of one reservation, at once", () => {
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

  it(`persists exactly one allocation per lot, ${ITERATIONS} times`, async () => {
    const admin = client();
    const codes: (string | null)[] = [];
    // Rounds a real caller needed against `takeFromLot`'s CAS retry loop —
    // unobservable before this class threaded an optional test-only callback
    // through `allocateReservation` (Sprint 0057 E2b named this gap: "how
    // many compare-and-swap rounds a caller needed is not observable from
    // outside `admitHold`" — that referred to `admitHold`, since converted
    // to a single RPC call and no longer CAS-bounded at all; the same
    // question for the two loops that remain, `takeFromLot`/`returnToLot`,
    // is answered here instead). Reported per iteration's peak round count
    // across both racers, not asserted against a specific value — this
    // shows what `CONTENTION_ATTEMPTS = 10` actually has headroom for under
    // this class's two-way collision, not that 10 is proven minimal for
    // every contention level this constant is meant to survive.
    const roundsPerIteration: number[] = [];

    await forEachIteration(async (iteration) => {
      const { userId } = await createFixtureUser(admin, `alloc-${iteration}`);

      try {
        await grantCreditLot(admin, {
          userId,
          sourceKind: "purchase",
          credits: LOT,
          reason: "concurrency fixture",
          idempotencyKey: `e2b:alloc:${iteration}:${userId}`,
          expiresAt: null,
        });

        const { account } = await ensureCreditAccount(admin, userId);
        const lots = await listActiveLots(admin, account.id);
        expect(lots).toHaveLength(1);
        const lotId = lots[0].id;

        const claim = await claimReservation(admin, {
          account,
          reservedCredits: HOLD,
          idempotencyKey: `e2b:alloc:hold:${iteration}`,
          projectId: null,
        });
        if (!claim.ok) throw new Error("fixture could not take a hold");

        // Two independent clients allocating the same reservation.
        let maxRound = 0;
        const racers = clients(RACERS);
        const outcomes: Outcome[] = await Promise.all(
          racers.map((racer) =>
            allocateReservation(racer, {
              creditAccountId: account.id,
              reservationId: claim.reservation.id,
              creditUnits: HOLD,
              onContentionRound: (_fn, attempt) => {
                if (attempt + 1 > maxRound) maxRound = attempt + 1;
              },
            })
              .then((result): Outcome => ({ ok: true, result }))
              .catch((error: unknown): Outcome => ({ ok: false, error: classifyError(error) })),
          ),
        );
        roundsPerIteration.push(maxRound);

        const succeeded = outcomes.filter((outcome) => outcome.ok);
        const threw = outcomes.filter((outcome) => !outcome.ok);

        /* ------------- what the database actually holds ------------- */
        // The point of the index. Not "the second caller was told no" — one
        // row, whatever either caller was told.
        const rows = await readAllocationPairs(admin, claim.reservation.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ grantId: lotId, creditUnits: HOLD });

        // Capacity taken exactly once. The loser threw part-way through and its
        // `finally` had to hand 300 back; 600 here would mean a hold of 300
        // consuming 600 of a customer's lot.
        expect(await readAllocatedAcrossLots(admin, account.id)).toBe(HOLD);

        /* ------------- what the callers were told ------------- */
        expect(succeeded).toHaveLength(1);
        expect(threw).toHaveLength(RACERS - 1);

        // The error code PostgreSQL raised, recorded rather than assumed. If
        // this is not 23505 the assertion fails and prints what it was, which
        // is the finding — a duplicate refused by something other than the
        // index would mean the index is not what stopped it.
        const failure = threw[0] as { ok: false; error: ClassifiedError };
        codes.push(failure.error.pgCode);
        expect(failure.error).toEqual({ pgCode: "23505", kind: "unique_violation" });
      } finally {
        reports.push(await teardownFixture(admin, userId));
      }
    });

    const distinct = [...new Set(codes)];
    const maxRoundsSeen = Math.max(...roundsPerIteration);
    console.log(
      `\nC — ${ITERATIONS} iterations of ${RACERS} concurrent allocations\n` +
        `  SQLSTATE reaching the client path: ${distinct.join(", ")}\n` +
        `  allocation rows persisted per iteration: 1\n` +
        `  takeFromLot/returnToLot CAS rounds per iteration: min ${Math.min(...roundsPerIteration)}, ` +
        `max ${maxRoundsSeen}, mean ${(roundsPerIteration.reduce((sum, value) => sum + value, 0) / roundsPerIteration.length).toFixed(2)} ` +
        `(CONTENTION_ATTEMPTS = ${CONTENTION_ATTEMPTS}; ${CONTENTION_ATTEMPTS - maxRoundsSeen} rounds of headroom observed under this class's two-way collision)`,
    );
  });

  /**
   * The ordinary path, so the scenario above cannot be satisfied by a change
   * that simply stopped allocating.
   */
  it("still records one allocation for an uncontended reservation", async () => {
    const admin = client();
    const { userId } = await createFixtureUser(admin, "alloc-solo");

    try {
      await grantCreditLot(admin, {
        userId,
        sourceKind: "purchase",
        credits: LOT,
        reason: "concurrency fixture",
        idempotencyKey: `e2b:alloc:solo:${userId}`,
        expiresAt: null,
      });
      const { account } = await ensureCreditAccount(admin, userId);
      const claim = await claimReservation(admin, {
        account,
        reservedCredits: HOLD,
        idempotencyKey: `e2b:alloc:solo:hold:${userId}`,
        projectId: null,
      });
      if (!claim.ok) throw new Error("fixture could not take a hold");

      const allocated = await allocateReservation(admin, {
        creditAccountId: account.id,
        reservationId: claim.reservation.id,
        creditUnits: HOLD,
      });

      expect(allocated.ok).toBe(true);
      expect(await readAllocationPairs(admin, claim.reservation.id)).toHaveLength(1);
      expect(await readAllocatedAcrossLots(admin, account.id)).toBe(HOLD);
    } finally {
      reports.push(await teardownFixture(admin, userId));
    }
  });
});
