import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { CONTENTION_ATTEMPTS } from "./contention";
import { claimReservation, ensureCreditAccount, getCreditBalance, postLedgerEntry } from "./store";
import { creditsToUnits } from "./units";

/**
 * Sprint 0057 E2 — the liveness property `CONTENTION_ATTEMPTS` exists to hold.
 *
 * ## What this pins, and why it needed pinning
 *
 * `contention.ts` records that the constant was found too low at 3 by the
 * PR #46 merge-verification stress test: 20 truly concurrent 100-credit
 * requests against an exact 1000-credit balance should admit exactly 10, and
 * with no backoff between immediate retries only 8 did — twelve callers were
 * told `insufficient_credits` while 200 credits of their own fundable demand
 * sat unclaimed.
 *
 * That stress test was never committed. `docs/ROADMAP.md` said the
 * consequence plainly: the number "exists only in a commit message, so
 * nothing would fail if `CONTENTION_ATTEMPTS` returned to 3".
 *
 * ## Exactly how much of that this file closes, measured
 *
 * The scenario below was run against the constant set to 1, 2, 3 and 10:
 *
 * ```
 *  1 attempt    1 of 10 fundable callers admitted   FAILS
 *  2 attempts   10 admitted                         passes
 *  3 attempts   10 admitted                         passes
 * 10 attempts   10 admitted                         passes, 12 runs
 * ```
 *
 * So the scenario proves the retry loop is load-bearing — remove it and
 * nineteen funded callers are refused — but it does **not** pin the number
 * ten, because `FakeDatabase` converges in fewer rounds than a real network
 * does. Pinning ten by measurement needs the real-database run that Sprint
 * 0057 E2 could not make; its record says why. Until then the value is held
 * by the explicit assertion at the bottom of this file, which is
 * record-keeping rather than measurement, and says so.
 *
 * ## Safety and liveness are separate claims, and only one of them is here
 *
 * **Safety** — never admitting more than the balance covers — is guaranteed by
 * the compare-and-swap itself and, beneath it, by the
 * `billing_credit_accounts_available_non_negative` CHECK constraint. It does
 * not depend on the retry count at all, and it is asserted below only as the
 * thing that must never break while liveness is being tuned.
 *
 * **Liveness** — that a caller who *does* have the credits is told so — is
 * what the constant buys, and it is the only property this file can lose.
 *
 * ## What this is not
 *
 * It is not a real-PostgreSQL proof. `FakeDatabase` runs each statement
 * atomically but does not serialize the sequences around them, so every
 * `await` is an interleaving point and a lost swap is genuinely reproduced —
 * which is why the eleven E1 defects were caught here first. What it cannot
 * reproduce is real MVCC, real row locks, real snapshot timing, or a real
 * network's arrival order, so the *number* of rounds a real database needs
 * may differ from the number this needs. Sprint 0057 E2's record says why the
 * real-database run could not be made, and what it would add.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

/** Exactly ten of these fit the balance. Not nine, not eleven. */
const CALLERS = 20;
const REQUEST = creditsToUnits(100);
const BALANCE = creditsToUnits(1000);
const FUNDABLE = 10;

beforeEach(() => {
  db.current = new FakeDatabase();
});

describe("twenty concurrent holds against a balance that funds exactly ten", () => {
  it("admits every fundable caller, and refuses only the unfundable ones", async () => {
    const { account: fresh } = await ensureCreditAccount(supabase(), USER);
    await postLedgerEntry(supabase(), {
      creditAccountId: fresh.id,
      kind: "grant",
      creditDelta: BALANCE,
      idempotencyKey: "seed:1000",
      reason: "exactly ten holds",
    });
    const account = (await ensureCreditAccount(supabase(), USER)).account;

    const results = await Promise.all(
      Array.from({ length: CALLERS }, (_, caller) =>
        claimReservation(supabase(), {
          account,
          reservedCredits: REQUEST,
          idempotencyKey: `hold:${caller}`,
          projectId: PROJECT,
        }),
      ),
    );

    const admitted = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);

    // Safety. Never in doubt, and asserted so that a change chasing liveness
    // cannot buy it by overspending.
    expect(admitted.length).toBeLessThanOrEqual(FUNDABLE);
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(creditsToUnits(100 * admitted.length));
    expect(balance!.posted - balance!.reserved).toBeGreaterThanOrEqual(0);

    // Liveness. This is what fails when the retry loop is taken away: at one
    // attempt exactly one caller is admitted and nine funded ones are refused.
    expect(admitted).toHaveLength(FUNDABLE);
    expect(refused).toHaveLength(CALLERS - FUNDABLE);
    for (const result of refused) {
      expect(result).toMatchObject({ ok: false, refusal: "insufficient_credits" });
    }

    // Every admission is a real, distinct, active hold — not a return value.
    const active = db.current
      .rows("billing_credit_reservations")
      .filter((row) => (row as { status: string }).status === "active");
    expect(active).toHaveLength(FUNDABLE);
    expect(new Set(active.map((row) => (row as { id: string }).id)).size).toBe(FUNDABLE);
    for (const row of active) {
      expect((row as { reserved_credits: number }).reserved_credits).toBe(REQUEST);
    }
  });

  it("refuses a caller whose hold the balance genuinely cannot cover", async () => {
    // The other direction, so the test above cannot be satisfied by a change
    // that simply stopped refusing.
    const { account: fresh } = await ensureCreditAccount(supabase(), USER);
    await postLedgerEntry(supabase(), {
      creditAccountId: fresh.id,
      kind: "grant",
      creditDelta: BALANCE,
      idempotencyKey: "seed:1000",
      reason: "one caller too large",
    });
    const account = (await ensureCreditAccount(supabase(), USER)).account;

    const claim = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(1001),
      idempotencyKey: "hold:too-large",
      projectId: PROJECT,
    });

    expect(claim).toMatchObject({ ok: false, refusal: "insufficient_credits" });
  });
});

/**
 * The constant itself, asserted so that changing it is a deliberate act with a
 * failing test attached rather than a quiet edit.
 *
 * This is a weaker kind of gate than the scenario above and is deliberately
 * separate from it: the scenario measures a property, this only records a
 * decision. It is here because the property the number was actually chosen
 * for — how many rounds twenty real HTTPS callers need against one contended
 * row — is not reproducible without the real database, and a number with no
 * test at all is how a hard-won constant gets casually reverted.
 */
it("keeps the attempt count the stress test settled on", () => {
  expect(CONTENTION_ATTEMPTS).toBe(10);
});
