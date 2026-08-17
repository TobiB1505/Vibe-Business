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
