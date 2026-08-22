import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import {
  claimReservation,
  closeReservation,
  ensureCreditAccount,
  getCreditBalance,
  listActiveReservations,
  MaterializationError,
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
 * Sprint 0057 — the two money-cache writers that had no compare-and-swap.
 *
 * `admitHold` has guarded its write since PR #46. `applyPostedDelta` and
 * `releaseHeldCredits` did not, and the docblock above the first justified that
 * with "read-modify-write on a single row, which Postgres serializes" — which
 * Postgres does for concurrent UPDATEs of one row, and does not for a SELECT
 * and a separate UPDATE issued as two round-trips with no transaction.
 *
 * These interleave the way `concurrent reservations cannot overspend` does:
 * both callers read before either writes. The fake serializes each statement
 * but not a sequence, so this is the same window a real deployment has.
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
 * Sprint 0057, Proof 2 — an idempotent replay may not launder a drift.
 *
 * `postLedgerEntry` commits the ledger row and *then* materializes it. If the
 * materialization fails, the caller is told so. But the retry that follows hits
 * the unique index, takes the `alreadyPosted` early return, and — before this
 * sprint — reported success without ever touching the cache. Ledger and balance
 * still disagreed, and the second request said everything was fine.
 *
 * The forbidden sequence is `ERROR → SUCCESS` with the drift untouched between
 * them. Here the drift is created directly, because what matters is what the
 * replay does when it finds one, not how it got there.
 */
describe("an idempotent replay does not report success over a drift", () => {
  it("refuses when the ledger and the materialized balance disagree", async () => {
    const account = await fundedAccount(1000);

    await postLedgerEntry(supabase(), {
      creditAccountId: account.id,
      kind: "grant",
      creditDelta: creditsToUnits(500),
      idempotencyKey: "replayed",
      reason: "test",
    });

    // Exactly what a failed materialization leaves behind: the entry is
    // durable, the cache never moved.
    const row = db.current
      .rows("billing_credit_accounts")
      .find((candidate) => (candidate as { id: string }).id === account.id) as {
      posted_credits: number;
    };
    row.posted_credits = creditsToUnits(1000);

    // The replay. It must not answer "already posted, all good".
    await expect(
      postLedgerEntry(supabase(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditsToUnits(500),
        idempotencyKey: "replayed",
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(MaterializationError);
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
 * Sprint 0057 — what a compare-and-swap does when it never wins.
 *
 * The retry bounds liveness, so it has to end somewhere. What it must not do is
 * end quietly: `postLedgerEntry` has already committed the ledger row by the
 * time the materialization runs, so giving up without a sound leaves the
 * canonical record and its cache disagreeing with nothing to notice (§I3).
 *
 * A client whose account-row swaps never match models sustained contention
 * without depending on timing. Ten lost swaps is not a plausible production
 * event; a silent one is the failure mode being ruled out.
 */
describe("a materialization that never wins its swap fails loudly", () => {
  /** Passes everything through, but no guarded write to the account row ever matches. */
  function alwaysContended(): ReturnType<typeof supabase> {
    const real = supabase();
    const lost = {
      eq: () => lost,
      select: () => lost,
      single: async () => ({ data: null, error: null }),
      then: (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onfulfilled),
    };
    return {
      from(table: string) {
        const target = (real as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        if (table !== "billing_credit_accounts") return target;
        return {
          ...target,
          update: (payload: Record<string, unknown>) =>
            "posted_credits" in payload || "reserved_credits" in payload
              ? lost
              : (target.update as (p: Record<string, unknown>) => unknown)(payload),
        };
      },
    } as unknown as ReturnType<typeof supabase>;
  }

  it("throws MaterializationError rather than returning", async () => {
    const account = await fundedAccount(1000);

    await expect(
      postLedgerEntry(alwaysContended(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditsToUnits(250),
        idempotencyKey: "contended",
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(MaterializationError);
  });

  it("names the account and the column it could not move", async () => {
    const account = await fundedAccount(1000);

    let failure: MaterializationError | null = null;
    try {
      await postLedgerEntry(alwaysContended(), {
        creditAccountId: account.id,
        kind: "grant",
        creditDelta: creditsToUnits(250),
        idempotencyKey: "contended:named",
        reason: "test",
      });
    } catch (error) {
      failure = error as MaterializationError;
    }

    expect(failure).toBeInstanceOf(MaterializationError);
    expect(failure?.creditAccountId).toBe(account.id);
    expect(failure?.column).toBe("posted_credits");
    expect(failure?.attemptedDelta).toBe(creditsToUnits(250));
  });
});
