import { describe, expect, it } from "vitest";
import {
  compareSpendOrder,
  isSpendable,
  lotsDueForExpiry,
  planAllocation,
  reconcileLotAllocation,
  remainingCapacity,
  settleAcrossLots,
  spendableCapacity,
  spendableLots,
  type CreditLot,
  type CreditSourceKind,
} from "./lots";
import { creditsToUnits, creditUnits, ZERO_CREDITS } from "./units";

/**
 * The allocator's properties, proven without a database (BILLING CORE-2 §74,
 * §75, §76, §83).
 *
 * These are the tests that decide whose money gets spent. Every one of them
 * describes a customer-visible commercial promise rather than an implementation
 * detail: expiring Credits go first, purchased Credits are protected, a
 * reservation returns what it did not use, and nothing is ever created out of
 * nothing.
 */

const NOW = new Date("2026-09-01T12:00:00.000Z");

function lot(overrides: Partial<CreditLot> & { id: string; sourceKind: CreditSourceKind; credits: number }): CreditLot {
  const { credits, ...rest } = overrides;
  return {
    initialCreditUnits: creditsToUnits(credits),
    allocatedCreditUnits: ZERO_CREDITS,
    expiredCreditUnits: ZERO_CREDITS,
    grantedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    status: "active",
    ...rest,
  };
}

/** The §74 fixture: Welcome 30, Subscription 100, Purchased 500. */
function mixedAccount(): CreditLot[] {
  return [
    lot({
      id: "welcome",
      sourceKind: "welcome",
      credits: 30,
      grantedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
    }),
    lot({
      id: "subscription",
      sourceKind: "subscription",
      credits: 100,
      grantedAt: "2026-08-15T00:00:00.000Z",
      expiresAt: "2026-09-15T00:00:00.000Z",
    }),
    lot({ id: "purchased", sourceKind: "purchase", credits: 500, grantedAt: "2026-08-20T00:00:00.000Z" }),
  ];
}

describe("remaining capacity", () => {
  it("is what a lot has not already given out", () => {
    const partiallyUsed = lot({ id: "a", sourceKind: "welcome", credits: 100 });
    partiallyUsed.allocatedCreditUnits = creditsToUnits(40);

    expect(remainingCapacity(partiallyUsed)).toBe(creditsToUnits(60));
  });

  it("never reports negative capacity", () => {
    const overdrawn = lot({ id: "a", sourceKind: "welcome", credits: 10 });
    overdrawn.allocatedCreditUnits = creditsToUnits(10);
    overdrawn.expiredCreditUnits = creditsToUnits(5);

    expect(remainingCapacity(overdrawn)).toBe(ZERO_CREDITS);
  });
});

describe("spendability", () => {
  it("refuses a lapsed lot even before any sweep has marked it", () => {
    // The sweep runs after the moment Credits actually die. If spendability
    // depended on `status`, the sweep's timing would decide whether a customer
    // got to spend expired Credits.
    const lapsed = lot({
      id: "a",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-08-31T00:00:00.000Z",
      status: "active",
    });

    expect(isSpendable(lapsed, NOW)).toBe(false);
  });

  it("allows a lot expiring later today", () => {
    const expiring = lot({
      id: "a",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-09-01T23:59:00.000Z",
    });

    expect(isSpendable(expiring, NOW)).toBe(true);
  });

  it("allows a non-expiring lot indefinitely", () => {
    expect(isSpendable(lot({ id: "a", sourceKind: "purchase", credits: 500 }), NOW)).toBe(true);
  });

  it("refuses an already-swept lot", () => {
    const swept = lot({
      id: "a",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-09-30T00:00:00.000Z",
      status: "expired",
    });

    expect(isSpendable(swept, NOW)).toBe(false);
  });

  it("refuses a drained lot", () => {
    const drained = lot({ id: "a", sourceKind: "purchase", credits: 100 });
    drained.allocatedCreditUnits = creditsToUnits(100);

    expect(isSpendable(drained, NOW)).toBe(false);
  });
});

describe("spend order", () => {
  it("puts the soonest expiry first and non-expiring Credits last", () => {
    const ordered = spendableLots(mixedAccount(), NOW).map((entry) => entry.id);
    expect(ordered).toEqual(["welcome", "subscription", "purchased"]);
  });

  it("orders by deadline rather than by source kind", () => {
    // The property that makes the rule correct for combinations that do not
    // exist yet: a promotional grant expiring before a subscription period is
    // spent first, which a category-ordered policy would get wrong.
    const lots = [
      lot({
        id: "subscription",
        sourceKind: "subscription",
        credits: 100,
        expiresAt: "2026-09-30T00:00:00.000Z",
      }),
      lot({
        id: "promotional",
        sourceKind: "promotional",
        credits: 50,
        expiresAt: "2026-09-05T00:00:00.000Z",
      }),
    ];

    expect(spendableLots(lots, NOW).map((entry) => entry.id)).toEqual(["promotional", "subscription"]);
  });

  it("breaks an expiry tie on the older grant", () => {
    const older = lot({
      id: "b",
      sourceKind: "welcome",
      credits: 10,
      grantedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
    });
    const newer = lot({
      id: "a",
      sourceKind: "welcome",
      credits: 10,
      grantedAt: "2026-08-05T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
    });

    expect(compareSpendOrder(older, newer)).toBeLessThan(0);
  });

  it("is a total order, so an allocation is reproducible from the same inputs", () => {
    const identical = {
      sourceKind: "welcome" as const,
      credits: 10,
      grantedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
    };

    expect(compareSpendOrder(lot({ id: "a", ...identical }), lot({ id: "b", ...identical }))).toBeLessThan(0);
    expect(compareSpendOrder(lot({ id: "b", ...identical }), lot({ id: "a", ...identical }))).toBeGreaterThan(0);
  });

  it("excludes lapsed lots from spendable capacity", () => {
    const lots = [
      lot({ id: "dead", sourceKind: "welcome", credits: 100, expiresAt: "2026-08-01T00:00:00.000Z" }),
      lot({ id: "alive", sourceKind: "purchase", credits: 500 }),
    ];

    expect(spendableCapacity(lots, NOW)).toBe(creditsToUnits(500));
  });
});

describe("allocation (§74)", () => {
  it("spends 30 Welcome and 40 Subscription for a 70-Credit charge, protecting the purchase", () => {
    const plan = planAllocation(mixedAccount(), creditsToUnits(70), NOW);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.allocations).toEqual([
      { lotId: "welcome", sourceKind: "welcome", creditUnits: creditsToUnits(30) },
      { lotId: "subscription", sourceKind: "subscription", creditUnits: creditsToUnits(40) },
    ]);

    // The purchased lot contributed nothing — the promise §11 makes to a
    // customer who paid real money.
    expect(plan.allocations.some((allocation) => allocation.lotId === "purchased")).toBe(false);
  });

  it("reaches into purchased Credits only once expiring capacity is exhausted", () => {
    const plan = planAllocation(mixedAccount(), creditsToUnits(200), NOW);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.allocations).toEqual([
      { lotId: "welcome", sourceKind: "welcome", creditUnits: creditsToUnits(30) },
      { lotId: "subscription", sourceKind: "subscription", creditUnits: creditsToUnits(100) },
      { lotId: "purchased", sourceKind: "purchase", creditUnits: creditsToUnits(70) },
    ]);
  });

  it("allocates exactly the requested amount, never more", () => {
    const plan = planAllocation(mixedAccount(), creditsToUnits(70), NOW);
    if (!plan.ok) throw new Error("expected a plan");

    const total = plan.allocations.reduce((sum, allocation) => sum + allocation.creditUnits, 0);
    expect(total).toBe(creditsToUnits(70));
  });

  it("refuses whole, with the exact shortfall, rather than partially funding", () => {
    const plan = planAllocation([lot({ id: "a", sourceKind: "welcome", credits: 20 })], creditsToUnits(35), NOW);

    expect(plan).toEqual({
      ok: false,
      refusal: "insufficient_credits",
      available: creditsToUnits(20),
      shortfall: creditsToUnits(15),
    });
  });

  it("does not count lapsed Credits toward affordability", () => {
    const lots = [
      lot({ id: "dead", sourceKind: "welcome", credits: 100, expiresAt: "2026-08-01T00:00:00.000Z" }),
      lot({ id: "alive", sourceKind: "purchase", credits: 20 }),
    ];

    const plan = planAllocation(lots, creditsToUnits(35), NOW);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.available).toBe(creditsToUnits(20));
  });

  it("skips lots already fully allocated to other reservations", () => {
    const lots = mixedAccount();
    lots[0].allocatedCreditUnits = creditsToUnits(30);

    const plan = planAllocation(lots, creditsToUnits(50), NOW);
    if (!plan.ok) throw new Error("expected a plan");

    expect(plan.allocations).toEqual([
      { lotId: "subscription", sourceKind: "subscription", creditUnits: creditsToUnits(50) },
    ]);
  });
});

describe("settlement across lots (§76)", () => {
  const held = [
    { id: "alloc-welcome", lotId: "welcome", creditUnits: creditsToUnits(30) },
    { id: "alloc-subscription", lotId: "subscription", creditUnits: creditsToUnits(100) },
    { id: "alloc-purchased", lotId: "purchased", creditUnits: creditsToUnits(70) },
  ];

  it("consumes 150 of a 200 hold and returns the other 50", () => {
    const settlements = settleAcrossLots(held, creditsToUnits(150));

    expect(settlements).toEqual([
      {
        allocationId: "alloc-welcome",
        lotId: "welcome",
        outcome: "consumed",
        consumedUnits: creditsToUnits(30),
        releasedUnits: ZERO_CREDITS,
      },
      {
        allocationId: "alloc-subscription",
        lotId: "subscription",
        outcome: "consumed",
        consumedUnits: creditsToUnits(100),
        releasedUnits: ZERO_CREDITS,
      },
      {
        allocationId: "alloc-purchased",
        lotId: "purchased",
        outcome: "consumed",
        consumedUnits: creditsToUnits(20),
        releasedUnits: creditsToUnits(50),
      },
    ]);
  });

  it("never permanently debits the full reservation on a partial settlement", () => {
    const consumed = settleAcrossLots(held, creditsToUnits(150))
      .filter((settlement) => settlement.outcome === "consumed")
      .reduce((sum, settlement) => sum + (settlement.outcome === "consumed" ? settlement.consumedUnits : 0), 0);

    expect(consumed).toBe(creditsToUnits(150));
  });

  it("consumes in the spend order the hold was taken in, not cheapest-lot-first", () => {
    // Settling 30 must eat the Welcome Credits that are about to expire, not
    // the purchased ones the customer paid for.
    const settlements = settleAcrossLots(held, creditsToUnits(30));

    expect(settlements[0]).toMatchObject({ lotId: "welcome", outcome: "consumed", consumedUnits: creditsToUnits(30) });
    expect(settlements[1]).toMatchObject({ lotId: "subscription", outcome: "released" });
    expect(settlements[2]).toMatchObject({ lotId: "purchased", outcome: "released" });
  });

  it("returns everything when nothing was consumed", () => {
    const settlements = settleAcrossLots(held, ZERO_CREDITS);

    expect(settlements.every((settlement) => settlement.outcome === "released")).toBe(true);
    const returned = settlements.reduce((sum, settlement) => sum + settlement.releasedUnits, 0);
    expect(returned).toBe(creditsToUnits(200));
  });

  it("refuses to settle more than was held rather than silently under-charging", () => {
    expect(() => settleAcrossLots(held, creditsToUnits(250))).toThrow(/cannot exceed/i);
  });
});

describe("expiry (§17, §73)", () => {
  it("expires the unspent remainder of a lapsed lot", () => {
    const lapsed = lot({
      id: "welcome",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    lapsed.allocatedCreditUnits = creditsToUnits(40);

    expect(lotsDueForExpiry([{ lot: lapsed, hasLiveHold: false }], NOW)).toEqual([
      { lotId: "welcome", sourceKind: "welcome", expiringUnits: creditsToUnits(60) },
    ]);
  });

  it("leaves a non-expiring purchased lot alone forever", () => {
    const purchased = lot({ id: "purchased", sourceKind: "purchase", credits: 500 });
    expect(lotsDueForExpiry([{ lot: purchased, hasLiveHold: false }], NOW)).toEqual([]);
  });

  it("defers a lapsed lot that a live reservation is still holding (§17)", () => {
    // Credits valid when the customer approved an operation must not vanish
    // mid-run and fail work they already authorized.
    const lapsed = lot({
      id: "welcome",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    lapsed.allocatedCreditUnits = creditsToUnits(35);

    expect(lotsDueForExpiry([{ lot: lapsed, hasLiveHold: true }], NOW)).toEqual([]);
  });

  it("does not expire a lot that is not yet due", () => {
    const alive = lot({
      id: "welcome",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-09-30T00:00:00.000Z",
    });

    expect(lotsDueForExpiry([{ lot: alive, hasLiveHold: false }], NOW)).toEqual([]);
  });

  it("does not expire a fully spent lot — there is nothing left to lapse", () => {
    const spent = lot({
      id: "welcome",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    spent.allocatedCreditUnits = creditsToUnits(100);

    expect(lotsDueForExpiry([{ lot: spent, hasLiveHold: false }], NOW)).toEqual([]);
  });

  it("does not expire an already-swept lot twice", () => {
    const swept = lot({
      id: "welcome",
      sourceKind: "welcome",
      credits: 100,
      expiresAt: "2026-08-31T00:00:00.000Z",
      status: "expired",
    });
    swept.expiredCreditUnits = creditsToUnits(100);

    expect(lotsDueForExpiry([{ lot: swept, hasLiveHold: false }], NOW)).toEqual([]);
  });

  it("leaves 500 purchased Credits available after 100 Welcome Credits lapse (§73)", () => {
    const lots = [
      lot({
        id: "welcome",
        sourceKind: "welcome",
        credits: 100,
        expiresAt: "2026-09-01T11:00:00.000Z",
      }),
      lot({ id: "purchased", sourceKind: "purchase", credits: 500 }),
    ];

    const beforeExpiry = new Date("2026-09-01T10:00:00.000Z");
    expect(spendableCapacity(lots, beforeExpiry)).toBe(creditsToUnits(600));
    expect(spendableCapacity(lots, NOW)).toBe(creditsToUnits(500));

    // The historical lot is untouched by any of this — nothing was deleted.
    expect(lots[0].initialCreditUnits).toBe(creditsToUnits(100));
  });
});

describe("lot reconciliation (§14)", () => {
  /**
   * What is left here after PERF-018, and where the rest went.
   *
   * This used to take the allocation rows and apply the occupancy rule — held
   * occupies its full amount, consumed only what it charged, released nothing.
   * That rule now lives in `sum_lot_allocation_capacity`, because summing it
   * here meant transferring every allocation row an account has ever had and
   * getting a **fabricated drift** when `max_rows` truncated the read.
   *
   * So the rule's test moved with the rule, to
   * `supabase/tests/lot-capacity.migration.ts`, where it is proved against a
   * real cluster rather than against a hand-summed array. What stays here is
   * the comparison, which is the only thing this function still decides.
   */
  it("agrees when the materialized figure matches what the allocations occupy", () => {
    const subject = lot({ id: "a", sourceKind: "welcome", credits: 100 });
    subject.allocatedCreditUnits = creditsToUnits(50);

    const result = reconcileLotAllocation(subject, creditsToUnits(50));

    expect(result.consistent).toBe(true);
    expect(result.expected).toBe(creditsToUnits(50));
  });

  it("reports drift rather than trusting the cache", () => {
    const subject = lot({ id: "a", sourceKind: "welcome", credits: 100 });
    subject.allocatedCreditUnits = creditsToUnits(80);

    const result = reconcileLotAllocation(subject, creditsToUnits(20));

    expect(result.consistent).toBe(false);
    expect(result.drift).toBe(creditUnits(creditsToUnits(60)));
  });

  it("treats a lot nothing has allocated against as occupying nothing", () => {
    // The absent-versus-zero case the aggregate creates: `group by` emits no
    // row for such a lot, so the caller supplies ZERO_CREDITS and a lot whose
    // materialized figure is also zero must reconcile rather than drift.
    const subject = lot({ id: "a", sourceKind: "welcome", credits: 100 });
    subject.allocatedCreditUnits = creditsToUnits(0);

    expect(reconcileLotAllocation(subject, creditsToUnits(0)).consistent).toBe(true);
  });
});
