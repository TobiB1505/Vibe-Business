import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantCreditLot } from "../grants";
import { releaseReservation } from "../service";
import { claimReservation, ensureCreditAccount, postLedgerEntry } from "../store";
import { creditsToUnits } from "../units";
import {
  client,
  clients,
  createFixtureUser,
  forEachIteration,
  isClean,
  isConfigured,
  readInvariants,
  resolveTarget,
  teardownFixture,
  type TeardownReport,
} from "./harness";

/**
 * Race class B — no lost update on either materialised money column.
 *
 * `billing_credit_accounts` carries two cached totals, `posted_credits` and
 * `reserved_credits`, and PostgREST cannot express a column-relative update.
 * So every writer reads the value, computes the new one, and guards the write
 * with `eq(<column>, <what it read>)`. If that guard is missing or its result
 * is ignored, two concurrent writers both compute from the same old value and
 * one delta disappears.
 *
 * E1 reproduced both directions against `FakeDatabase`:
 *
 *   posted     two grants of 100 and 200 against 1000 left 1200 where 1300 was
 *              owed — a customer silently short 100 Credits.
 *   reserved   an unguarded write in `releaseHeldCredits` erased a hold
 *              `admitHold` had already granted, leaving the account *under*
 *              reserved. `available_non_negative` is `posted - reserved >= 0`,
 *              so it only catches `reserved` growing too large and is
 *              structurally blind to this direction.
 *
 * This runs both against real MVCC. The assertion in each case is the same
 * shape and it is deliberately not the return value: the cached column must
 * equal the sum of the rows it claims to summarise.
 */

const POSTERS = 10;
const POST_AMOUNT = creditsToUnits(100);
const HOLD = creditsToUnits(100);
const FUNDING = creditsToUnits(1000);
const HELD_BEFORE = 5;
const CLAIMED_DURING = 5;

const configured = isConfigured();

describe.skipIf(!configured)("B — concurrent writes to a materialised balance", () => {
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

  it(`loses no posted delta across ${POSTERS} concurrent ledger entries`, async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const { userId } = await createFixtureUser(admin, `posted-${iteration}`);

      try {
        const { account } = await ensureCreditAccount(admin, userId);

        // Ten independent clients posting to the same account at once. Each
        // carries its own idempotency key, so all ten are genuinely distinct
        // entries and none is deduplicated into another.
        const posters = clients(POSTERS);
        await Promise.all(
          posters.map((poster, index) =>
            postLedgerEntry(poster, {
              creditAccountId: account.id,
              kind: "grant",
              creditDelta: POST_AMOUNT,
              idempotencyKey: `e2b:post:${iteration}:${index}`,
              reason: "concurrency fixture",
            }),
          ),
        );

        const state = await readInvariants(admin, account.id);
        const owed = creditsToUnits(100 * POSTERS);

        // The ledger is append-only and is the authority; the column is a
        // cache. A lost update is exactly the gap between them.
        expect(state.ledgerEntries).toBe(POSTERS);
        expect(state.ledgerSum).toBe(owed);
        expect(state.postedCredits).toBe(owed);
        expect(state.postedCredits).toBe(state.ledgerSum);
        expect(state.available).toBe(owed);
      } finally {
        reports.push(await teardownFixture(admin, userId));
      }
    });
  });

  it("loses no reserved delta when holds are taken and given back at once", async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const { userId } = await createFixtureUser(admin, `reserved-${iteration}`);

      try {
        await grantCreditLot(admin, {
          userId,
          sourceKind: "purchase",
          credits: FUNDING,
          reason: "concurrency fixture",
          idempotencyKey: `e2b:reserved:${iteration}:${userId}`,
          expiresAt: null,
        });
        const { account } = await ensureCreditAccount(admin, userId);

        // Five live holds, taken one at a time so the starting point is exact.
        const existing: string[] = [];
        for (let index = 0; index < HELD_BEFORE; index += 1) {
          const claim = await claimReservation(admin, {
            account: (await ensureCreditAccount(admin, userId)).account,
            reservedCredits: HOLD,
            idempotencyKey: `e2b:reserved:${iteration}:before:${index}`,
            projectId: null,
          });
          if (!claim.ok) throw new Error("fixture could not take a hold");
          existing.push(claim.reservation.id);
        }

        const before = await readInvariants(admin, account.id);
        expect(before.reservedCredits).toBe(creditsToUnits(100 * HELD_BEFORE));

        // Now both directions collide on one column: five releases giving
        // capacity back while five fresh admissions take it.
        const releasers = clients(HELD_BEFORE);
        const claimers = clients(CLAIMED_DURING);
        const snapshots = await Promise.all(
          claimers.map(async (caller) => (await ensureCreditAccount(caller, userId)).account),
        );

        const outcomes = await Promise.all([
          ...releasers.map((caller, index) =>
            releaseReservation(caller, {
              reservationId: existing[index],
              reason: "cancelled_before_usage",
            }),
          ),
          ...claimers.map((caller, index) =>
            claimReservation(caller, {
              account: snapshots[index],
              reservedCredits: HOLD,
              idempotencyKey: `e2b:reserved:${iteration}:during:${index}`,
              projectId: null,
            }),
          ),
        ]);

        const state = await readInvariants(admin, account.id);

        // Whatever the interleaving decided, the cache must describe it. This
        // is the assertion the E1 defect fails: an erased hold leaves
        // `reserved_credits` below the sum of the holds that really exist,
        // which no CHECK constraint can see.
        expect(state.reservedCredits).toBe(state.activeReservedSum);
        expect(state.reservedCredits).toBe(creditsToUnits(100 * state.activeReservations));
        expect(state.available).toBeGreaterThanOrEqual(0);
        expect(state.postedCredits).toBe(FUNDING);
        expect(state.ledgerSum).toBe(FUNDING);

        // Every release was on an active hold and every admission was fundable
        // — the account holds 1000 and at most ten holds of 100 can exist — so
        // nothing here may fail. A refusal would mean contention decided a
        // question that was never in doubt.
        for (const outcome of outcomes) {
          expect(outcome.ok).toBe(true);
        }
        expect(state.activeReservations).toBe(CLAIMED_DURING);
      } finally {
        reports.push(await teardownFixture(admin, userId));
      }
    });
  });
});
