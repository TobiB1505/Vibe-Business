import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { ensureWelcomeGrant, findNextExpiry, grantCreditLot, sweepExpiredCredits } from "./grants";
import { listActiveLots, listAllLots } from "./lot-store";
import { getBillingBalance } from "./service";
import { ensureCreditAccount, listLedgerEntries } from "./store";
import { creditsToUnits } from "./units";

/**
 * Grants, expiry and the Welcome allowance (BILLING CORE-2 §70, §73).
 *
 * Against `FakeDatabase`, which models the real unique indexes and CHECK
 * constraints by hand — so these prove the *database's* guarantee rather than
 * the application's pre-check. That distinction is the whole point here: a
 * welcome grant deduplicated by an `if` is deduplicated right up until ten
 * provisioning attempts arrive together.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  db.current = new FakeDatabase();
});

async function accountId(userId = USER): Promise<string> {
  const { account } = await ensureCreditAccount(supabase(), userId);
  return account.id;
}

describe("Welcome Credits (§5, §70)", () => {
  it("grants 100 Credits expiring in 30 days", async () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    await ensureWelcomeGrant(supabase(), { userId: USER, now });

    const lots = await listActiveLots(supabase(), await accountId());

    expect(lots).toHaveLength(1);
    expect(lots[0].sourceKind).toBe("welcome");
    expect(lots[0].initialCreditUnits).toBe(creditsToUnits(100));
    expect(lots[0].expiresAt).toBe("2026-09-17T00:00:00.000Z");
  });

  it("grants exactly once across ten concurrent provisioning attempts (§70)", async () => {
    // The §70 gate. Every attempt computes the same idempotency key and the
    // ledger's unique index admits exactly one — this is not deduplicated by
    // an application check.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureWelcomeGrant(supabase(), { userId: USER })),
    );

    const lots = await listAllLots(supabase(), await accountId());
    expect(lots).toHaveLength(1);

    const entries = await listLedgerEntries(supabase(), await accountId());
    expect(entries.filter((entry) => entry.kind === "grant")).toHaveLength(1);

    // Exactly one caller sees itself as the granter.
    expect(results.filter((result) => !result.alreadyGranted).length).toBeLessThanOrEqual(1);

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.posted).toBe(creditsToUnits(100));
  });

  it("stays one grant however many times it is retried later (§70)", async () => {
    await ensureWelcomeGrant(supabase(), { userId: USER });
    await ensureWelcomeGrant(supabase(), { userId: USER });
    const third = await ensureWelcomeGrant(supabase(), { userId: USER });

    expect(third.alreadyGranted).toBe(true);
    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.posted).toBe(creditsToUnits(100));
  });

  it("is account-scoped, so more projects cannot farm more Credits (§5, §70)", async () => {
    // Nothing about the grant identity mentions a project, so there is no
    // number of projects that produces a second grant.
    for (let i = 0; i < 5; i += 1) {
      await ensureWelcomeGrant(supabase(), { userId: USER });
    }

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.posted).toBe(creditsToUnits(100));
  });

  it("gives a different account its own grant", async () => {
    await ensureWelcomeGrant(supabase(), { userId: USER });
    await ensureWelcomeGrant(supabase(), { userId: OTHER_USER });

    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(100));
    expect((await getBillingBalance(supabase(), OTHER_USER))?.balance.posted).toBe(creditsToUnits(100));
  });

  it("reconciles a pre-existing user exactly once (§6)", async () => {
    // A user who registered before Billing Core-2 existed receives their grant
    // the first time they are seen, and never a second time — the same key a
    // new user's provisioning would compute.
    const first = await ensureWelcomeGrant(supabase(), { userId: USER });
    expect(first.alreadyGranted).toBe(false);

    const reconciled = await ensureWelcomeGrant(supabase(), { userId: USER });
    expect(reconciled.alreadyGranted).toBe(true);

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
  });
});

describe("grant provenance (§13)", () => {
  it("records purchased Credits with no expiry", async () => {
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(500),
      reason: "Credit purchase (pack_500)",
      idempotencyKey: "topup-v1:cs_1",
      expiresAt: null,
      externalReference: "cs_1",
    });

    const lots = await listActiveLots(supabase(), await accountId());
    expect(lots[0]).toMatchObject({ sourceKind: "purchase", expiresAt: null });
  });

  it("posts purchased Credits under the ledger's purchase kind, not grant", async () => {
    // Whether real money was exchanged is a distinction an accountant needs.
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(500),
      reason: "Credit purchase",
      idempotencyKey: "topup-v1:cs_1",
    });

    const entries = await listLedgerEntries(supabase(), await accountId());
    expect(entries[0].kind).toBe("purchase");
  });

  it("records a subscription lot with its paid period", async () => {
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "subscription",
      credits: creditsToUnits(1_000),
      reason: "builder monthly Credits",
      idempotencyKey: "subscription-period-v1:in_1",
      expiresAt: "2026-09-18T00:00:00.000Z",
      periodStart: "2026-08-18T00:00:00.000Z",
      periodEnd: "2026-09-18T00:00:00.000Z",
      externalReference: "in_1",
    });

    const lots = await listActiveLots(supabase(), await accountId());
    expect(lots[0]).toMatchObject({
      sourceKind: "subscription",
      initialCreditUnits: creditsToUnits(1_000),
      expiresAt: "2026-09-18T00:00:00.000Z",
    });
  });

  it("creates one lot per ledger entry, even on a replayed grant (§71, §72)", async () => {
    for (let i = 0; i < 5; i += 1) {
      await grantCreditLot(supabase(), {
        userId: USER,
        sourceKind: "subscription",
        credits: creditsToUnits(1_000),
        reason: "builder monthly Credits",
        idempotencyKey: "subscription-period-v1:in_1",
        expiresAt: "2026-09-18T00:00:00.000Z",
        periodStart: "2026-08-18T00:00:00.000Z",
        periodEnd: "2026-09-18T00:00:00.000Z",
      });
    }

    expect(await listAllLots(supabase(), await accountId())).toHaveLength(1);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(1_000));
  });

  it("refuses a grant with no stated reason", async () => {
    await expect(
      grantCreditLot(supabase(), {
        userId: USER,
        sourceKind: "compensation",
        credits: creditsToUnits(10),
        reason: "   ",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/reason/i);
  });

  it("refuses a non-positive grant", async () => {
    await expect(
      grantCreditLot(supabase(), {
        userId: USER,
        sourceKind: "promotional",
        credits: creditsToUnits(0),
        reason: "nothing",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/positive/i);
  });
});

describe("expiry sweep (§73, §59, §60)", () => {
  const NOW = new Date("2026-09-20T00:00:00.000Z");

  async function seedExpiringAndPurchased(): Promise<void> {
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "welcome",
      credits: creditsToUnits(100),
      reason: "Welcome Credits",
      idempotencyKey: "welcome-credit-v1:user",
      expiresAt: "2026-09-19T00:00:00.000Z",
    });
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(500),
      reason: "Credit purchase",
      idempotencyKey: "topup-v1:cs_1",
      expiresAt: null,
    });
  }

  it("shows 600 available before expiry and 500 after (§73)", async () => {
    await seedExpiringAndPurchased();

    const before = await getBillingBalance(supabase(), USER);
    expect(before?.balance.available).toBe(creditsToUnits(600));

    await sweepExpiredCredits(supabase(), {
      userId: USER,
      creditAccountId: await accountId(),
      now: NOW,
    });

    const after = await getBillingBalance(supabase(), USER);
    expect(after?.balance.available).toBe(creditsToUnits(500));
  });

  it("keeps the expired grant in history rather than deleting it (§60)", async () => {
    await seedExpiringAndPurchased();
    await sweepExpiredCredits(supabase(), {
      userId: USER,
      creditAccountId: await accountId(),
      now: NOW,
    });

    const all = await listAllLots(supabase(), await accountId());
    const welcome = all.find((lot) => lot.sourceKind === "welcome");

    expect(welcome).toBeDefined();
    expect(welcome?.status).toBe("expired");
    // The original amount is never rewritten: "100 Welcome Credits, expired"
    // stays answerable.
    expect(welcome?.initialCreditUnits).toBe(creditsToUnits(100));
    expect(welcome?.expiredCreditUnits).toBe(creditsToUnits(100));
  });

  it("records expiry as an append-only ledger entry, never a mutation", async () => {
    await seedExpiringAndPurchased();
    await sweepExpiredCredits(supabase(), {
      userId: USER,
      creditAccountId: await accountId(),
      now: NOW,
    });

    const entries = await listLedgerEntries(supabase(), await accountId());
    const expiry = entries.find((entry) => entry.kind === "expiry");

    expect(expiry).toBeDefined();
    expect(expiry?.creditDelta).toBe(-creditsToUnits(100));
    // The original grant entry is untouched.
    expect(entries.filter((entry) => entry.kind === "grant")).toHaveLength(1);
  });

  it("is idempotent — sweeping repeatedly expires once", async () => {
    await seedExpiringAndPurchased();
    const account = await accountId();

    for (let i = 0; i < 4; i += 1) {
      await sweepExpiredCredits(supabase(), { userId: USER, creditAccountId: account, now: NOW });
    }

    const entries = await listLedgerEntries(supabase(), account);
    expect(entries.filter((entry) => entry.kind === "expiry")).toHaveLength(1);
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(500));
  });

  it("expires nothing before the deadline", async () => {
    await seedExpiringAndPurchased();

    const result = await sweepExpiredCredits(supabase(), {
      userId: USER,
      creditAccountId: await accountId(),
      now: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(result.expiredLotCount).toBe(0);
    expect((await getBillingBalance(supabase(), USER))?.balance.available).toBe(creditsToUnits(600));
  });

  it("never expires purchased Credits (§10)", async () => {
    await seedExpiringAndPurchased();

    await sweepExpiredCredits(supabase(), {
      userId: USER,
      creditAccountId: await accountId(),
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    const purchased = (await listActiveLots(supabase(), await accountId())).find(
      (lot) => lot.sourceKind === "purchase",
    );
    expect(purchased?.status).toBe("active");
    expect((await getBillingBalance(supabase(), USER))?.balance.available).toBe(creditsToUnits(500));
  });

  it("leaves the balance non-negative when everything expires", async () => {
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "welcome",
      credits: creditsToUnits(100),
      reason: "Welcome Credits",
      idempotencyKey: "welcome-credit-v1:user",
      expiresAt: "2026-09-19T00:00:00.000Z",
    });

    await sweepExpiredCredits(supabase(), {
      userId: USER,
      creditAccountId: await accountId(),
      now: NOW,
    });

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.posted).toBe(creditsToUnits(0));
    expect(balance?.balance.available).toBe(creditsToUnits(0));
  });
});

describe("the next expiry, for the balance surface (§50)", () => {
  it("reports the soonest tranche and when it goes", async () => {
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "welcome",
      credits: creditsToUnits(120),
      reason: "Welcome Credits",
      idempotencyKey: "w",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "subscription",
      credits: creditsToUnits(1_000),
      reason: "builder",
      idempotencyKey: "s",
      expiresAt: "2026-10-01T00:00:00.000Z",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-10-01T00:00:00.000Z",
    });

    expect(
      await findNextExpiry(supabase(), await accountId(), new Date("2026-08-20T00:00:00.000Z")),
    ).toEqual({ credits: creditsToUnits(120), expiresAt: "2026-09-01T00:00:00.000Z" });
  });

  it("reports nothing when only non-expiring Credits remain", async () => {
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(500),
      reason: "Credit purchase",
      idempotencyKey: "p",
      expiresAt: null,
    });

    expect(await findNextExpiry(supabase(), await accountId())).toBeNull();
  });
});
