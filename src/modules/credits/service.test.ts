import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { releaseReservation, settleReservation } from "./service";
import {
  claimReservation,
  closeReservation,
  ensureCreditAccount,
  getCreditBalance,
  getReservation,
  postLedgerEntry,
  type CreditAccount,
} from "./store";
import { creditsToUnits, ZERO_CREDITS } from "./units";

/**
 * Sprint 0057 — settlement retries finish the cleanup, and never re-decide the money.
 *
 * The two questions a retry has to answer are different questions, and the code
 * used to answer them with one branch (§I1):
 *
 *   does a charge exist?          → the financial question. Answered once,
 *                                   by the ledger's unique index.
 *   is the reservation closed?    → the cleanup question. Answered by the
 *                                   reservation row, and possibly still open.
 *
 * `settleReservation` posts the charge and *then* closes the hold, and its
 * docblock argues a crash between them is safe "because a retry fixes it". The
 * retry took an early return on the existing charge, before `closeReservation`,
 * so the recovery path the comment described did not exist. A charge could be
 * booked against a hold that stayed active forever.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db.current = new FakeDatabase();
});

async function fundedAccount(credits: number): Promise<CreditAccount> {
  const { account } = await ensureCreditAccount(supabase(), USER);
  await postLedgerEntry(supabase(), {
    creditAccountId: account.id,
    kind: "grant",
    creditDelta: creditsToUnits(credits),
    idempotencyKey: `seed:${credits}`,
    reason: "test seed",
  });
  return (await ensureCreditAccount(supabase(), USER)).account;
}

/** A funded account holding one active reservation. */
async function heldReservation(held: number): Promise<{ account: CreditAccount; id: string }> {
  const account = await fundedAccount(1000);
  const claim = await claimReservation(supabase(), {
    account,
    reservedCredits: creditsToUnits(held),
    idempotencyKey: `hold:${held}`,
    projectId: PROJECT,
  });
  if (!claim.ok) throw new Error("fixture could not take a hold");
  return { account, id: claim.reservation.id };
}

describe("a retried settlement closes the hold its charge was taken against", () => {
  it("closes a hold left active by a crash between the charge and the close", async () => {
    const { account, id } = await heldReservation(300);

    // Exactly what a crash between postLedgerEntry and closeReservation leaves:
    // the charge is durable, the reservation is still active.
    await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "charge",
      creditDelta: creditsToUnits(-200),
      idempotencyKey: `settle:${id}`,
      projectId: PROJECT,
      reservationId: id,
    });
    expect((await getReservation(supabase(), id))?.status).toBe("active");

    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({ ok: true, alreadySettled: true });
    // The cleanup the first attempt never finished.
    expect((await getReservation(supabase(), id))?.status).toBe("settled");
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(ZERO_CREDITS);
  });

  it("posts no second charge when it finishes the cleanup", async () => {
    const { account, id } = await heldReservation(300);

    await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });
    const after = await getCreditBalance(supabase(), USER);

    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({ ok: true, alreadySettled: true });
    // The financial question was already answered, and stays answered.
    const charges = db.current
      .rows("billing_credit_ledger")
      .filter((row) => (row as { kind: string }).kind === "charge");
    expect(charges).toHaveLength(1);
    expect(await getCreditBalance(supabase(), USER)).toEqual(after);
    expect(account.id).toBeTruthy();
  });

  it("reports a charge whose hold was released as an inconsistency, not a success", async () => {
    const { account, id } = await heldReservation(300);

    // The state I1 exists to make visible: the money question says settled, the
    // cleanup question says the hold was handed back. Neither answer is wrong on
    // its own, and together they are a defect — so this must not read as "fine".
    await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "charge",
      creditDelta: creditsToUnits(-200),
      idempotencyKey: `settle:${id}`,
      projectId: PROJECT,
      reservationId: id,
    });
    await releaseReservation(supabase(), { reservationId: id, reason: "cancelled_before_usage" });

    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({ ok: false, refusal: "charge_without_hold" });
  });

  it("still reports an ordinary already-settled reservation as settled", async () => {
    const { id } = await heldReservation(300);

    await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({ ok: true, alreadySettled: true });
    expect((await getReservation(supabase(), id))?.status).toBe("settled");
  });

  it("does not emit a second audit event when a concurrent settlement won the close", async () => {
    const { account, id } = await heldReservation(300);

    await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "charge",
      creditDelta: creditsToUnits(-200),
      idempotencyKey: `settle:${id}`,
      projectId: PROJECT,
      reservationId: id,
    });
    // Somebody else closes it first — the race this retry can lose.
    await closeReservation(supabase(), {
      reservationId: id,
      creditAccountId: account.id,
      heldCredits: creditsToUnits(300),
      status: "settled",
      settledCredits: creditsToUnits(200),
    });

    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({ ok: true, alreadySettled: true });
    // This retry did not perform the close, so it has nothing to announce. An
    // event per attempt would make the activity feed count tries rather than
    // facts — which is why the event is gated on the close actually happening
    // here, exactly as `releaseReservation` already gates its own.
    const settled = db.current
      .rows("audit_log_events")
      .filter((row) => (row as { event_type: string }).event_type === "credit_charge.settled");
    expect(settled).toHaveLength(0);
  });
});

/**
 * ADR 0041 §P4 — a zero-credit settlement is idempotent.
 *
 * `credit_delta <> 0` forbids a zero-delta ledger row, so a zero-credit
 * settlement posts no charge at all — the whole hold is simply released. A
 * retry that only looks for an existing charge in the ledger finds nothing,
 * falls through to `decideSettlement`, and is refused `reservation_not_active`
 * against a reservation it already, correctly, settled. `reservation.status
 * === "settled"` is checked before any ledger lookup so this case has an
 * idempotency key at all.
 */
describe("a zero-credit settlement is idempotent", () => {
  it("reports a retried zero-credit settlement as already settled, not refused", async () => {
    const { id } = await heldReservation(300);

    const first = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: ZERO_CREDITS,
      rateCardVersion: null,
    });
    expect(first).toMatchObject({ ok: true, chargedCredits: ZERO_CREDITS, alreadySettled: false });

    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: ZERO_CREDITS,
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({
      ok: true,
      chargedCredits: ZERO_CREDITS,
      releasedCredits: creditsToUnits(300),
      alreadySettled: true,
    });
    expect((await getReservation(supabase(), id))?.status).toBe("settled");
  });

  it("posts no ledger row for a zero-credit settlement, retried or not", async () => {
    const { id } = await heldReservation(300);

    await settleReservation(supabase(), { reservationId: id, actualCredits: ZERO_CREDITS, rateCardVersion: null });
    await settleReservation(supabase(), { reservationId: id, actualCredits: ZERO_CREDITS, rateCardVersion: null });

    const charges = db.current
      .rows("billing_credit_ledger")
      .filter((row) => (row as { kind: string }).kind === "charge");
    expect(charges).toHaveLength(0);
  });

  it("gives back the whole hold on a zero-credit settlement", async () => {
    const { id } = await heldReservation(300);

    await settleReservation(supabase(), { reservationId: id, actualCredits: ZERO_CREDITS, rateCardVersion: null });

    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(ZERO_CREDITS);
  });

  it("still reports a nonzero settlement's replay from the settled reservation row, not the ledger", async () => {
    const { id } = await heldReservation(300);

    await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });
    const retry = await settleReservation(supabase(), {
      reservationId: id,
      actualCredits: creditsToUnits(200),
      rateCardVersion: null,
    });

    expect(retry).toMatchObject({
      ok: true,
      chargedCredits: creditsToUnits(200),
      releasedCredits: creditsToUnits(100),
      alreadySettled: true,
    });
  });
});
