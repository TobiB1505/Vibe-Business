import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import {
  claimReservation,
  closeReservation,
  ensureCreditAccount,
  getCreditBalance,
  listActiveReservations,
  postLedgerEntry,
  projectUsageEvents,
  type CreditAccount,
} from "./store";
import type { BillableUsage } from "./schema";
import { creditsToUnits, creditUnits, type CreditUnits, ZERO_CREDITS } from "./units";

/**
 * Billing persistence, against the constraints the database actually has
 * (BILLING CORE-1 §48, §49).
 *
 * `FakeDatabase` models the billing unique indexes and CHECKs by hand — see
 * its `checkConstraints`. That is what makes these tests prove the database's
 * guarantee rather than the application's pre-check, which matters more here
 * than anywhere else in the codebase: an overspend prevented by an `if` is
 * prevented right up until two requests arrive at the same moment.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db.current = new FakeDatabase();
});

/** Seeds a funded wallet without going through the grant path. */
async function fundedAccount(credits: number): Promise<CreditAccount> {
  const { account } = await ensureCreditAccount(supabase(), USER);
  await postLedgerEntry(supabase(), {
    creditAccountId: account.id,
    kind: "grant",
    creditDelta: creditsToUnits(credits),
    idempotencyKey: `seed:${credits}`,
    reason: "test seed",
  });
  // Re-read so the caller holds the post-grant balance.
  return (await ensureCreditAccount(supabase(), USER)).account;
}

describe("accounts", () => {
  it("creates exactly one wallet per owner", async () => {
    const first = await ensureCreditAccount(supabase(), USER);
    const second = await ensureCreditAccount(supabase(), USER);
    expect(second.account.id).toBe(first.account.id);
    // Only the first call reports creation, so only one audit event is ever
    // emitted for a wallet.
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(db.current.rows("billing_credit_accounts")).toHaveLength(1);
  });

  it("starts empty", async () => {
    await ensureCreditAccount(supabase(), USER);
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance).toEqual({ posted: 0, reserved: 0, available: 0 });
  });
});

/** §49 — every financial write is idempotent, enforced by an index. */
describe("idempotency", () => {
  it("posts one ledger entry for a repeated idempotency key", async () => {
    const { account } = await ensureCreditAccount(supabase(), USER);

    const first = await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "grant",
      creditDelta: creditsToUnits(1000),
      idempotencyKey: "grant:welcome",
      reason: "welcome",
    });
    const second = await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "grant",
      creditDelta: creditsToUnits(1000),
      idempotencyKey: "grant:welcome",
      reason: "welcome",
    });

    expect(first.alreadyPosted).toBe(false);
    expect(second.alreadyPosted).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(db.current.rows("billing_credit_ledger")).toHaveLength(1);

    // And the balance moved once, not twice.
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.posted).toBe(creditsToUnits(1000));
  });

  it("takes one hold for a repeated reservation request", async () => {
    const account = await fundedAccount(1000);

    const first = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(700),
      idempotencyKey: "reserve:op-1",
      projectId: PROJECT,
    });
    const { account: refreshed } = await ensureCreditAccount(supabase(), USER);
    const second = await claimReservation(supabase(), {
      account: refreshed,
      reservedCredits: creditsToUnits(700),
      idempotencyKey: "reserve:op-1",
      projectId: PROJECT,
    });

    expect(first.ok && !first.alreadyHeld).toBe(true);
    expect(second.ok && second.alreadyHeld).toBe(true);
    expect(db.current.rows("billing_credit_reservations")).toHaveLength(1);

    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(creditsToUnits(700));
    expect(balance?.available).toBe(creditsToUnits(300));
  });

  it("projects one usage event per source row and SKU, however often it runs", async () => {
    const event: BillableUsage & {
      ratingStatus: string;
      ratedCredits: CreditUnits | null;
      rateCardVersion: string | null;
    } = {
      sourceKind: "ai_usage_event",
      sourceId: "33333333-3333-3333-3333-333333333333",
      operationRunId: null,
      projectId: PROJECT,
      userId: USER,
      provider: "anthropic",
      sku: "anthropic_input_tokens",
      quantity: 20_000,
      occurredAt: "2026-08-14T18:00:00.000Z",
      rawCostNanoUsd: 80_000_000,
      costStatus: "costed",
      providerPricingVersion: "claude-sonnet-5-introductory-2026",
      ratingStatus: "rate_card_not_configured",
      ratedCredits: null,
      rateCardVersion: null,
    };

    const first = await projectUsageEvents(supabase(), [event]);
    const second = await projectUsageEvents(supabase(), [event]);

    expect(first).toEqual({ inserted: 1, alreadyPresent: 0 });
    // The §43 guarantee: a second reconciliation pass writes nothing.
    expect(second).toEqual({ inserted: 0, alreadyPresent: 1 });
    expect(db.current.rows("billing_usage_events")).toHaveLength(1);
  });
});

/**
 * §48 — the concurrency proof.
 *
 * These do not merely call the function twice in sequence. They interleave the
 * two callers the way a real race does: both read the account row *before*
 * either writes, so both hold the same stale balance. That is precisely the
 * situation an application-level `if` cannot survive, and the conditional
 * UPDATE must.
 */
describe("concurrent reservations cannot overspend", () => {
  it("admits only one of two simultaneous 700-credit holds against 1000", async () => {
    const account = await fundedAccount(1000);

    // Both callers snapshot the same account state — the race window.
    const snapshotA = { ...account };
    const snapshotB = { ...account };

    const [a, b] = await Promise.all([
      claimReservation(supabase(), {
        account: snapshotA,
        reservedCredits: creditsToUnits(700),
        idempotencyKey: "reserve:a",
        projectId: PROJECT,
      }),
      claimReservation(supabase(), {
        account: snapshotB,
        reservedCredits: creditsToUnits(700),
        idempotencyKey: "reserve:b",
        projectId: PROJECT,
      }),
    ]);

    const succeeded = [a, b].filter((result) => result.ok);
    const refused = [a, b].filter((result) => !result.ok);

    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ refusal: "insufficient_credits" });

    // The invariant, stated as the number it must never be.
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(creditsToUnits(700));
    expect(balance?.available).toBe(creditsToUnits(300));
    expect(balance?.available).toBeGreaterThanOrEqual(0);

    // The loser holds nothing: its row exists but is not active.
    const active = await listActiveReservations(supabase(), account.id);
    expect(active).toHaveLength(1);
  });

  it("admits both when the balance genuinely covers them", async () => {
    const account = await fundedAccount(1500);
    const snapshot = { ...account };

    const [a, b] = await Promise.all([
      claimReservation(supabase(), {
        account: { ...snapshot },
        reservedCredits: creditsToUnits(700),
        idempotencyKey: "reserve:a",
        projectId: PROJECT,
      }),
      claimReservation(supabase(), {
        account: { ...snapshot },
        reservedCredits: creditsToUnits(700),
        idempotencyKey: "reserve:b",
        projectId: PROJECT,
      }),
    ]);

    expect([a.ok, b.ok]).toEqual([true, true]);
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(creditsToUnits(1400));
    expect(balance?.available).toBe(creditsToUnits(100));
  });

  it("refuses a hold larger than the whole balance", async () => {
    const account = await fundedAccount(100);
    const result = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(700),
      idempotencyKey: "reserve:too-big",
      projectId: PROJECT,
    });

    expect(result).toMatchObject({ ok: false, refusal: "insufficient_credits" });
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(ZERO_CREDITS);
  });

  it("refuses to reserve against a suspended account", async () => {
    const account = await fundedAccount(1000);
    const result = await claimReservation(supabase(), {
      account: { ...account, status: "suspended" },
      reservedCredits: creditsToUnits(100),
      idempotencyKey: "reserve:suspended",
    });
    expect(result).toMatchObject({ ok: false, refusal: "account_suspended" });
  });
});

describe("closing a reservation", () => {
  it("returns held credits exactly once even if closed twice", async () => {
    const account = await fundedAccount(1000);
    const claim = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(600),
      idempotencyKey: "reserve:close",
      projectId: PROJECT,
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    const first = await closeReservation(supabase(), {
      reservationId: claim.reservation.id,
      creditAccountId: account.id,
      heldCredits: creditsToUnits(600),
      status: "released",
      releaseReason: "cancelled_before_usage",
    });
    const second = await closeReservation(supabase(), {
      reservationId: claim.reservation.id,
      creditAccountId: account.id,
      heldCredits: creditsToUnits(600),
      status: "released",
      releaseReason: "cancelled_before_usage",
    });

    expect(first.closed).toBe(true);
    // Guarded on status='active', so the second call is a no-op rather than a
    // second decrement that would free credits nobody held.
    expect(second.closed).toBe(false);

    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(ZERO_CREDITS);
    expect(balance?.available).toBe(creditsToUnits(1000));
  });
});

/** §47 — the database refuses financially incoherent rows. */
describe("database-level financial invariants", () => {
  it("rejects a positive charge", async () => {
    const { account } = await ensureCreditAccount(supabase(), USER);
    await expect(
      postLedgerEntry(supabase(), {
        creditAccountId: account.id,
        kind: "charge",
        creditDelta: creditUnits(500),
        idempotencyKey: "bad:charge",
      }),
    ).rejects.toMatchObject({ message: "billing_credit_ledger_sign_matches_kind" });
  });

  it("rejects a negative grant", async () => {
    const { account } = await ensureCreditAccount(supabase(), USER);
    await expect(
      postLedgerEntry(supabase(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditUnits(-500),
        idempotencyKey: "bad:grant",
      }),
    ).rejects.toMatchObject({ message: "billing_credit_ledger_sign_matches_kind" });
  });

  it("rejects a zero-delta entry", async () => {
    const { account } = await ensureCreditAccount(supabase(), USER);
    await expect(
      postLedgerEntry(supabase(), {
        creditAccountId: account.id,
        kind: "adjustment",
        creditDelta: ZERO_CREDITS,
        idempotencyKey: "bad:zero",
        reason: "nothing",
      }),
    ).rejects.toMatchObject({ message: "credit_delta <> 0" });
  });
});

/**
 * ADR 0042 §P3 — the shared materialization primitives cannot lose a write.
 *
 * `applyPostedDelta` and `releaseHeldCredits` used to be two independent
 * compare-and-swap loops in this file, each its own read-then-guarded-update
 * round trip with a window between them. Sprint C replaced both with a single
 * `.rpc()` call onto `materialize_ledger_entry`/`materialize_reservation_hold`
 * — one Postgres statement that locks the row it touches with
 * `SELECT ... FOR UPDATE` before reading or writing anything, so there is no
 * round trip for a second caller to land inside of.
 *
 * `fakeSupabase`'s `.rpc()` mirrors that: each handler call runs to
 * completion — read, constraint check, write — before any other queued
 * microtask runs, so two concurrent calls against the same account row can
 * never interleave their reads. That is not a looser stand-in for the real
 * guarantee; it is the same guarantee, because the real guarantee is also
 * "the whole thing happens as one unit against one locked row."
 */
describe("the materialized balance cannot be silently overwritten", () => {
  it("does not lose a posted delta when two entries interleave", async () => {
    const account = await fundedAccount(1000);

    // Two grants, posted concurrently. Both read `posted_credits` at 1000.
    await Promise.all([
      postLedgerEntry(supabase(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditsToUnits(100),
        idempotencyKey: "concurrent:a",
        reason: "test",
      }),
      postLedgerEntry(supabase(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditsToUnits(200),
        idempotencyKey: "concurrent:b",
        reason: "test",
      }),
    ]);

    // The ledger is authority and holds all three entries; the cache must
    // agree with it. A lost update shows up here as 1100 or 1200.
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.posted).toBe(creditsToUnits(1300));
  });

  it("does not lose a hold when two reservations are closed at once", async () => {
    const account = await fundedAccount(1000);

    const first = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(300),
      idempotencyKey: "hold:first",
      projectId: PROJECT,
    });
    const afterFirst = (await ensureCreditAccount(supabase(), USER)).account;
    const second = await claimReservation(supabase(), {
      account: afterFirst,
      reservedCredits: creditsToUnits(400),
      idempotencyKey: "hold:second",
      projectId: PROJECT,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // 700 held across two reservations. Two operations finish at the same
    // moment and both close: each reads `reserved_credits` at 700, one writes
    // 400 and the other 300, and the later write erases the earlier one.
    await Promise.all([
      closeReservation(supabase(), {
        reservationId: first.reservation.id,
        creditAccountId: account.id,
        heldCredits: creditsToUnits(300),
        status: "released",
        releaseReason: "cancelled_before_usage",
      }),
      closeReservation(supabase(), {
        reservationId: second.reservation.id,
        creditAccountId: account.id,
        heldCredits: creditsToUnits(400),
        status: "released",
        releaseReason: "cancelled_before_usage",
      }),
    ]);

    // Both holds are closed, so nothing is reserved. A lost update leaves 300
    // or 400 behind — capacity the customer paid for and can no longer spend.
    const active = await listActiveReservations(supabase(), account.id);
    expect(active).toHaveLength(0);
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.reserved).toBe(ZERO_CREDITS);
  });
});

/**
 * ADR 0042 §P3 — an idempotent replay heals a crash it finds, instead of
 * reporting drift for someone else to fix.
 *
 * `postLedgerEntry` inserts the ledger row and *then* materializes it. A crash
 * between those two steps leaves a durable entry with `materialized_at IS
 * NULL` — the exact case Sprint B0's certification named and Sprint B1's
 * primitives exist to repair. The replay that follows hits the unique index,
 * takes the `alreadyPosted` branch, and re-invokes the materializer on that
 * same entry: `materialize_ledger_entry` checks the row's own marker, finds it
 * unset, and finishes what the first attempt started — no scan, no comparison
 * against the ledger total, just this one row's own pending effect applied
 * once.
 */
describe("an idempotent replay heals an unmaterialized entry", () => {
  it("finishes materializing a ledger entry a crash left pending", async () => {
    const account = await fundedAccount(1000);

    // What a crash between "insert the ledger row" and "materialize it"
    // leaves behind: the entry exists, but never moved the cache. Written
    // directly, because `postLedgerEntry` itself never leaves this state on
    // its own — that is the scenario, not a call it would make.
    const { data: pending } = await supabase()
      .from("billing_credit_ledger")
      .insert({
        credit_account_id: account.id,
        kind: "grant",
        credit_delta: creditsToUnits(500),
        idempotency_key: "crashed-before-materialize",
      })
      .select("id")
      .single();

    // The replay. It must not answer "already posted" without finishing the
    // materialization the first attempt never completed.
    const replay = await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "grant",
      creditDelta: creditsToUnits(500),
      idempotencyKey: "crashed-before-materialize",
      reason: "test",
    });

    expect(replay.alreadyPosted).toBe(true);
    expect(replay.entry.id).toBe((pending as { id: string }).id);

    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.posted).toBe(creditsToUnits(1500));
  });

  it("still reports an ordinary replay as already posted", async () => {
    const account = await fundedAccount(1000);

    const first = await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "grant",
      creditDelta: creditsToUnits(500),
      idempotencyKey: "clean-replay",
      reason: "test",
    });
    const second = await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "grant",
      creditDelta: creditsToUnits(500),
      idempotencyKey: "clean-replay",
      reason: "test",
    });

    expect(first.alreadyPosted).toBe(false);
    expect(second.alreadyPosted).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    // Exactly one delta applied, and the cache agrees with the ledger.
    const balance = await getCreditBalance(supabase(), USER);
    expect(balance?.posted).toBe(creditsToUnits(1500));
  });
});

/**
 * ADR 0042 §P3 — an unexpected materialization error propagates rather than
 * being swallowed.
 *
 * There is no retry loop left to exhaust: `postLedgerEntry` and
 * `claimReservation` each make one `.rpc()` call, and its only recognized
 * refusal is the specific constraint violation each already translates
 * (`23514` on the account row). Anything else the call could fail with — a
 * network error, a function that does not exist, a row genuinely missing —
 * must reach the caller as a thrown error, not a quiet no-op, because by the
 * time this runs the ledger row (or the reservation row) is already durably
 * committed.
 */
describe("an unrecognized materialization failure is never swallowed", () => {
  /** Passes everything through, but every `.rpc()` call fails with an error `admitHold`/`materializeLedgerEntry` do not specifically handle. */
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

  it("propagates a posting failure that is not a recognized refusal", async () => {
    const account = await fundedAccount(1000);

    await expect(
      postLedgerEntry(rpcAlwaysErrors(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditsToUnits(250),
        idempotencyKey: "rpc-error",
        reason: "test",
      }),
    ).rejects.toMatchObject({ code: "53300" });
  });

  it("propagates an admission failure that is not the insufficient-credits refusal", async () => {
    const account = await fundedAccount(1000);

    await expect(
      claimReservation(rpcAlwaysErrors(), {
        account,
        reservedCredits: creditsToUnits(250),
        idempotencyKey: "rpc-error:reserve",
        projectId: PROJECT,
      }),
    ).rejects.toMatchObject({ code: "53300" });
  });
});
