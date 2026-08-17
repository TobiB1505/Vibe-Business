import { describe, expect, it } from "vitest";
import {
  computeBalance,
  decideRefund,
  decideRelease,
  decideReservation,
  decideSettlement,
  isValidLedgerDelta,
  postedBalance,
  reconcileBalance,
  totalRefunded,
  type LedgerDelta,
} from "./balance";
import { CREDIT_LEDGER_KINDS } from "./schema";
import { creditUnits, creditsToUnits, ZERO_CREDITS } from "./units";

/**
 * Balance, reservation and settlement invariants (BILLING CORE-1 §50, §51).
 *
 * These are the arithmetic claims the product makes about somebody's money, so
 * they are pinned exactly rather than approximately. The scenario in §50 is
 * reproduced literally — grant, reserve, settle for less than reserved, refund
 * — because the single most likely way to get this wrong is to model a
 * reservation as a posted debit, and that mistake is invisible until the
 * moment a customer's balance is wrong.
 */

const ACTIVE = { suspended: false };

function grant(credits: number): LedgerDelta {
  return { kind: "grant", creditDelta: creditsToUnits(credits) };
}
function charge(credits: number): LedgerDelta {
  return { kind: "charge", creditDelta: creditUnits(-creditsToUnits(credits)) };
}
function refund(credits: number): LedgerDelta {
  return { kind: "refund", creditDelta: creditsToUnits(credits) };
}

describe("ledger delta signs", () => {
  it("requires a charge to be negative and a grant to be positive", () => {
    expect(isValidLedgerDelta("charge", creditUnits(-100))).toBe(true);
    expect(isValidLedgerDelta("charge", creditUnits(100))).toBe(false);
    expect(isValidLedgerDelta("grant", creditUnits(100))).toBe(true);
    expect(isValidLedgerDelta("grant", creditUnits(-100))).toBe(false);
  });

  it("rejects a zero delta for every kind — a ledger entry that changes nothing is a mistake", () => {
    for (const kind of CREDIT_LEDGER_KINDS) {
      expect(isValidLedgerDelta(kind, ZERO_CREDITS)).toBe(false);
    }
  });

  /** The correction mechanism has to be able to move both ways. */
  it("allows an adjustment in either direction", () => {
    expect(isValidLedgerDelta("adjustment", creditUnits(50))).toBe(true);
    expect(isValidLedgerDelta("adjustment", creditUnits(-50))).toBe(true);
  });
});

/**
 * §50, walked through as one continuous account life. Each step asserts all
 * three figures, because the failure mode being guarded against — treating a
 * reservation as a posted debit — produces a *plausible* available balance
 * while making posted wrong.
 */
describe("the §50 ledger walkthrough", () => {
  it("grant 1000 → posted 1000, reserved 0, available 1000", () => {
    const balance = computeBalance([grant(1000)], []);
    expect(balance.posted).toBe(creditsToUnits(1000));
    expect(balance.reserved).toBe(ZERO_CREDITS);
    expect(balance.available).toBe(creditsToUnits(1000));
  });

  it("reserve 600 → posted UNCHANGED at 1000, reserved 600, available 400", () => {
    const balance = computeBalance([grant(1000)], [{ reservedCredits: creditsToUnits(600) }]);
    // The load-bearing assertion of this whole file: reserving spends nothing.
    expect(balance.posted).toBe(creditsToUnits(1000));
    expect(balance.reserved).toBe(creditsToUnits(600));
    expect(balance.available).toBe(creditsToUnits(400));
  });

  it("settle actual 450 → posted 550, reserved 0, available 550", () => {
    const settlement = decideSettlement(
      { status: "active", reservedCredits: creditsToUnits(600) },
      creditsToUnits(450),
    );
    expect(settlement.ok).toBe(true);
    if (!settlement.ok) return;

    expect(settlement.chargeDelta).toBe(creditUnits(-creditsToUnits(450)));
    expect(settlement.releasedCredits).toBe(creditsToUnits(150));

    // The reservation is gone and exactly one charge is posted in its place.
    const balance = computeBalance([grant(1000), { kind: "charge", creditDelta: settlement.chargeDelta }], []);
    expect(balance.posted).toBe(creditsToUnits(550));
    expect(balance.reserved).toBe(ZERO_CREDITS);
    expect(balance.available).toBe(creditsToUnits(550));
  });

  it("releasing a reservation leaves posted untouched", () => {
    const release = decideRelease(
      { status: "active", reservedCredits: creditsToUnits(600) },
      "cancelled_before_usage",
    );
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    expect(release.releasedCredits).toBe(creditsToUnits(600));

    const balance = computeBalance([grant(1000)], []);
    expect(balance.posted).toBe(creditsToUnits(1000));
    expect(balance.available).toBe(creditsToUnits(1000));
  });

  it("refund 200 → posted increases by exactly 200", () => {
    const before = postedBalance([grant(1000), charge(450)]);
    const after = postedBalance([grant(1000), charge(450), refund(200)]);
    expect(after).toBe(creditUnits(before + creditsToUnits(200)));
    expect(after).toBe(creditsToUnits(750));
  });
});

/** §51 — the maximum-budget contract, in both directions. */
describe("the reserved maximum is a ceiling, not a suggestion", () => {
  it("reserve 700 / actual 526 → charges 526 and frees the unused 174", () => {
    const settlement = decideSettlement(
      { status: "active", reservedCredits: creditsToUnits(700) },
      creditsToUnits(526),
    );
    expect(settlement.ok).toBe(true);
    if (!settlement.ok) return;

    expect(settlement.chargeDelta).toBe(creditUnits(-creditsToUnits(526)));
    expect(settlement.releasedCredits).toBe(creditsToUnits(174));

    const balance = computeBalance([grant(1000), { kind: "charge", creditDelta: settlement.chargeDelta }], []);
    // Balance fell by the actual amount, not by the reserved maximum.
    expect(balance.posted).toBe(creditsToUnits(474));
  });

  /**
   * The surprise-invoice test. An over-run must refuse and say by how much —
   * never charge 850 against an approved 700.
   */
  it("reserve 700 / actual 850 → refuses with the shortfall, charging nothing", () => {
    const settlement = decideSettlement(
      { status: "active", reservedCredits: creditsToUnits(700) },
      creditsToUnits(850),
    );

    expect(settlement.ok).toBe(false);
    if (settlement.ok) return;
    expect(settlement.refusal).toBe("additional_credits_required");
    expect(settlement.shortfall).toBe(creditsToUnits(150));
  });

  it("settles an operation that did no billable work for nothing, returning the whole hold", () => {
    const settlement = decideSettlement(
      { status: "active", reservedCredits: creditsToUnits(700) },
      ZERO_CREDITS,
    );
    expect(settlement.ok).toBe(true);
    if (!settlement.ok) return;
    expect(settlement.chargeDelta).toBe(ZERO_CREDITS);
    expect(settlement.releasedCredits).toBe(creditsToUnits(700));
  });

  it("refuses to settle a reservation that is no longer active", () => {
    for (const status of ["settled", "released", "expired"]) {
      const settlement = decideSettlement(
        { status, reservedCredits: creditsToUnits(700) },
        creditsToUnits(10),
      );
      expect(settlement.ok).toBe(false);
      if (settlement.ok) return;
      expect(settlement.refusal).toBe("reservation_not_active");
    }
  });
});

describe("reservation admission", () => {
  it("admits a reservation within available balance", () => {
    const balance = computeBalance([grant(1000)], []);
    const decision = decideReservation(balance, creditsToUnits(700), ACTIVE);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.availableAfter).toBe(creditsToUnits(300));
  });

  /**
   * The sequential half of §48. The concurrent half cannot be proven here —
   * it is a database guarantee, tested in `store.test.ts` against the
   * conditional UPDATE that actually enforces it.
   */
  it("refuses a second reservation the remaining balance cannot cover", () => {
    const afterFirst = computeBalance([grant(1000)], [{ reservedCredits: creditsToUnits(700) }]);
    const second = decideReservation(afterFirst, creditsToUnits(700), ACTIVE);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.refusal).toBe("insufficient_credits");
    // Never -400.
    expect(afterFirst.available).toBe(creditsToUnits(300));
  });

  it("refuses a non-positive amount and a suspended account", () => {
    const balance = computeBalance([grant(1000)], []);
    expect(decideReservation(balance, ZERO_CREDITS, ACTIVE)).toMatchObject({ refusal: "invalid_amount" });
    expect(decideReservation(balance, creditsToUnits(1), { suspended: true })).toMatchObject({
      refusal: "account_suspended",
    });
  });
});

/** §29 — a failed operation that already spent provider money is not free. */
describe("release semantics", () => {
  it("flags outstanding usage when an operation was abandoned after spending", () => {
    const release = decideRelease(
      { status: "active", reservedCredits: creditsToUnits(700) },
      "abandoned_with_usage",
    );
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    expect(release.usageOutstanding).toBe(true);
  });

  it("does not flag usage for a clean cancellation", () => {
    for (const reason of ["cancelled_before_usage", "failed_without_usage", "expired"] as const) {
      const release = decideRelease({ status: "active", reservedCredits: creditsToUnits(700) }, reason);
      expect(release.ok).toBe(true);
      if (!release.ok) return;
      expect(release.usageOutstanding).toBe(false);
    }
  });
});

describe("refunds are compensating entries", () => {
  it("refunds up to the original charge and no further", () => {
    const original = { creditDelta: creditUnits(-creditsToUnits(500)) };
    expect(decideRefund(original, ZERO_CREDITS, creditsToUnits(500))).toMatchObject({ ok: true });
    expect(decideRefund(original, ZERO_CREDITS, creditsToUnits(501))).toMatchObject({
      refusal: "exceeds_original_charge",
    });
  });

  it("counts earlier partial refunds against the cap", () => {
    const original = { creditDelta: creditUnits(-creditsToUnits(500)) };
    const already = totalRefunded([refund(300)]);
    expect(already).toBe(creditsToUnits(300));

    expect(decideRefund(original, already, creditsToUnits(200))).toMatchObject({ ok: true });
    expect(decideRefund(original, already, creditsToUnits(201))).toMatchObject({
      refusal: "exceeds_original_charge",
    });
  });

  it("never removes the original charge — both entries coexist", () => {
    const entries = [grant(1000), charge(500), refund(500)];
    expect(postedBalance(entries)).toBe(creditsToUnits(1000));
    // The charge is still in history; the balance is restored by addition.
    expect(entries.filter((entry) => entry.kind === "charge")).toHaveLength(1);
  });
});

/** §10 — a materialized balance is only allowed because this proves it. */
describe("materialized balance reconciliation", () => {
  const entries = [grant(1000), charge(450)];
  const reservations = [{ reservedCredits: creditsToUnits(100) }];

  it("agrees when the cache is correct", () => {
    const result = reconcileBalance(
      { posted: creditsToUnits(550), reserved: creditsToUnits(100) },
      entries,
      reservations,
    );
    expect(result.consistent).toBe(true);
    expect(result.drift).toEqual({ posted: 0, reserved: 0 });
  });

  it("reports the exact drift when the cache is wrong", () => {
    const result = reconcileBalance(
      { posted: creditsToUnits(600), reserved: creditsToUnits(100) },
      entries,
      reservations,
    );
    expect(result.consistent).toBe(false);
    expect(result.drift.posted).toBe(creditsToUnits(50));
    expect(result.expected.posted).toBe(creditsToUnits(550));
  });
});
