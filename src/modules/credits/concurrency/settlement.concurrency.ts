import { beforeAll, describe, expect, it } from "vitest";
import { grantCreditLot } from "../grants";
import { allocateReservation, listActiveLots } from "../lot-store";
import { releaseReservation, settleReservation } from "../service";
import { claimReservation, ensureCreditAccount, getReservation } from "../store";
import { creditsToUnits } from "../units";
import {
  client,
  clients,
  createFixtureUser,
  deleteFixtureUser,
  forEachIteration,
  isConfigured,
  ITERATIONS,
  readAllocatedAcrossLots,
  readInvariants,
  resolveTarget,
} from "./harness";

/**
 * Race class D — a hold ends once, and its capacity comes back once.
 *
 * Two collisions from the existing domain, no invented rules:
 *
 *   settle ‖ release   two callers finish the same operation differently.
 *   settle ‖ settle    the same settlement arriving twice at once.
 *
 * ## What is asserted, and what is only counted
 *
 * E1 established three defects here, and those are what this asserts: two
 * charges for one hold; capacity handed back twice, which inflated a lot beyond
 * what it ever held (`300000` becoming `0`); and a hold left active by a
 * settlement that crashed between the charge and the close.
 *
 * It does **not** assert a terminal-state truth table. A settlement that posts
 * its charge while a release wins the close leaves a charge whose hold was
 * given back — and E1's answer to that was to make `settleReservation` *report*
 * it as `charge_without_hold` rather than to prevent it. Inventing a rule here
 * that the domain does not hold would be writing new business logic inside a
 * concurrency test. So that combination is counted and printed, as evidence
 * about how often real interleaving produces it, and the outcome distribution
 * goes in the sprint record.
 */

const LOT = creditsToUnits(1000);
const HOLD = creditsToUnits(300);
const CONSUMED = creditsToUnits(100);

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

  it(`leaves one terminal state when a settle and a release race, ${ITERATIONS} times`, async () => {
    const admin = client();
    const outcomes: Record<string, number> = {};

    await forEachIteration(async (iteration) => {
      const fixture = await heldAndAllocated(admin, `race-${iteration}`);

      try {
        const [settler, releaser] = clients(2);
        await Promise.all([
          settleReservation(settler, {
            reservationId: fixture.reservationId,
            actualCredits: CONSUMED,
            rateCardVersion: null,
          }).catch(() => undefined),
          releaseReservation(releaser, {
            reservationId: fixture.reservationId,
            reason: "cancelled_before_usage",
          }).catch(() => undefined),
        ]);

        const state = await readInvariants(admin, fixture.accountId);
        const reservation = await getReservation(admin, fixture.reservationId);
        const allocated = await readAllocatedAcrossLots(admin, fixture.accountId);

        // The money question is answered at most once, whoever answered it.
        expect(state.chargeEntries).toBeLessThanOrEqual(1);

        // The hold is over. A settlement that crashed between its charge and
        // its close used to leave this `active` forever — the state E1's
        // retry path exists to finish.
        expect(reservation?.status).not.toBe("active");
        expect(["settled", "released", "expired"]).toContain(reservation?.status);

        // No phantom hold and no erased one: the cache equals the rows.
        expect(state.reservedCredits).toBe(state.activeReservedSum);
        expect(state.reservedCredits).toBe(0);
        expect(state.activeReservations).toBe(0);
        expect(state.available).toBeGreaterThanOrEqual(0);

        // Capacity came back exactly once. The settle keeps 100 of the 300 and
        // returns 200; the release returns all 300. Anything else — and in
        // particular anything below zero, or a value implying two returns —
        // is the E1 double-return defect.
        expect([0, CONSUMED as number]).toContain(allocated);

        // Settling means the charge exists: `settleReservation` posts it before
        // it closes, so a `settled` row with no charge would mean the close
        // happened without the money question being answered.
        if (reservation?.status === "settled") expect(state.chargeEntries).toBe(1);

        // Counted, not asserted. A charge whose hold was released is the state
        // E1 named `charge_without_hold` and chose to surface rather than
        // forbid; how often real interleaving reaches it is evidence.
        const key = `${reservation?.status ?? "missing"}/charges=${state.chargeEntries}/allocated=${allocated}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      } finally {
        await deleteFixtureUser(admin, fixture.userId);
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

  it(`charges once and returns capacity once when two settlements race, ${ITERATIONS} times`, async () => {
    const admin = client();

    await forEachIteration(async (iteration) => {
      const fixture = await heldAndAllocated(admin, `double-${iteration}`);

      try {
        const settlers = clients(2);
        await Promise.all(
          settlers.map((settler) =>
            settleReservation(settler, {
              reservationId: fixture.reservationId,
              actualCredits: CONSUMED,
              rateCardVersion: null,
            }).catch(() => undefined),
          ),
        );

        const state = await readInvariants(admin, fixture.accountId);
        const reservation = await getReservation(admin, fixture.reservationId);

        // One charge. The ledger's unique index answers the financial question
        // once, and a second settlement must inherit that answer rather than
        // post beside it.
        expect(state.chargeEntries).toBe(1);
        expect(state.ledgerSum).toBe(creditsToUnits(1000 - 100));
        expect(state.postedCredits).toBe(state.ledgerSum);

        expect(reservation?.status).toBe("settled");
        expect(state.reservedCredits).toBe(0);
        expect(state.activeReservations).toBe(0);

        // The E1 defect exactly: 100 consumed of 300 held means 200 comes back
        // and 100 stays taken. Returning twice leaves 0 — a lot reporting more
        // free capacity than it has.
        expect(await readAllocatedAcrossLots(admin, fixture.accountId)).toBe(CONSUMED);
      } finally {
        await deleteFixtureUser(admin, fixture.userId);
      }
    });
  });
});
