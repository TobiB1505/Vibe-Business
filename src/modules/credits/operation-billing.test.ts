import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { grantCreditLot } from "./grants";
import {
  allocateReservation,
  listActiveLots,
  listReservationAllocations,
  settleReservationAllocations,
} from "./lot-store";
import {
  authorizeOperationCredits,
  availableSpendableCredits,
  releaseOperationCredits,
  settleOperationCredits,
} from "./operation-billing";
import { getBillingBalance, settleReservation } from "./service";
import { ensureCreditAccount, getReservation, listLedgerEntries } from "./store";
import { creditsToUnits, ZERO_CREDITS } from "./units";

/**
 * Real Credit consumption, through the service path
 * (BILLING CORE-2 §44, §75, §76, §77, §78, §79, §80, §82, §83, §90).
 *
 * These go through `authorizeOperationCredits` / `settleOperationCredits` —
 * the same functions the audit, opportunity and planner start paths call — not
 * a re-implementation of the algorithm. §77 is explicit that a replicated SQL
 * algorithm does not count, and the reason is worth stating: the bug this
 * guards against is not in the arithmetic, it is in the *sequence* of calls the
 * application actually makes.
 *
 * `FakeDatabase` models the real unique indexes and CHECK constraints,
 * including `billing_credit_accounts_available_non_negative` and
 * `billing_credit_grants_capacity_not_exceeded`. An overspend therefore has to
 * get past the same structures Postgres would apply, not merely past an `if`.
 */

const db = { current: new FakeDatabase() };
const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db.current = new FakeDatabase();
  db.current.seed("projects", { id: PROJECT, user_id: USER });
});

async function accountId(): Promise<string> {
  const { account } = await ensureCreditAccount(supabase(), USER);
  return account.id;
}

async function fund(
  sourceKind: "welcome" | "subscription" | "purchase",
  credits: number,
  expiresAt: string | null,
  key: string,
): Promise<void> {
  await grantCreditLot(supabase(), {
    userId: USER,
    sourceKind,
    credits: creditsToUnits(credits),
    reason: `${sourceKind} credits`,
    idempotencyKey: key,
    expiresAt,
    ...(sourceKind === "subscription"
      ? { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: expiresAt }
      : {}),
  });
}

async function available(): Promise<number> {
  return availableSpendableCredits(supabase(), await accountId());
}

/* -------------------------------------------------------------------------
 * §82 — insufficient balance never reaches a provider
 * ---------------------------------------------------------------------- */

describe("insufficient Credits (§43, §82, §90)", () => {
  it("refuses an audit at 20 Credits, stating what is needed and what is held", async () => {
    await fund("purchase", 20, null, "p1");

    const result = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    expect(result).toEqual({
      ok: false,
      refusal: "insufficient_credits",
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(20),
    });
  });

  it("takes no hold and posts no charge when it refuses", async () => {
    await fund("purchase", 20, null, "p1");

    await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.reserved).toBe(ZERO_CREDITS);
    expect(balance?.balance.available).toBe(creditsToUnits(20));

    const entries = await listLedgerEntries(supabase(), await accountId());
    expect(entries.filter((entry) => entry.kind === "charge")).toHaveLength(0);
  });

  it("refuses an account with no Credits at all", async () => {
    const result = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "action_plan",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    expect(result).toMatchObject({ ok: false, refusal: "insufficient_credits" });
  });

  it("never leaves a negative available balance (§90)", async () => {
    await fund("purchase", 40, null, "p1");

    for (let i = 0; i < 5; i += 1) {
      await authorizeOperationCredits(supabase(), {
        projectId: PROJECT,
        operation: "business_audit",
        idempotencyKey: `operation:op-${i}`,
        operationRunId: `op-${i}`,
      });
    }

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance!.balance.available).toBeGreaterThanOrEqual(0);
  });
});

/* -------------------------------------------------------------------------
 * §77 — real application-path concurrency
 * ---------------------------------------------------------------------- */

describe("concurrency through the real service path (§44, §77)", () => {
  it("admits exactly one of two simultaneous audits against 40 Credits", async () => {
    // The §77 merge gate, stated exactly as the brief does: balance 40, two
    // simultaneous new audits at 35 each. One is admitted, one is refused,
    // and 70 Credits are never spent.
    await fund("purchase", 40, null, "p1");

    const [first, second] = await Promise.all([
      authorizeOperationCredits(supabase(), {
        projectId: PROJECT,
        operation: "business_audit",
        idempotencyKey: "operation:op-a",
        operationRunId: "op-a",
      }),
      authorizeOperationCredits(supabase(), {
        projectId: PROJECT,
        operation: "business_audit",
        idempotencyKey: "operation:op-b",
        operationRunId: "op-b",
      }),
    ]);

    const admitted = [first, second].filter((result) => result.ok);
    const refused = [first, second].filter((result) => !result.ok);

    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ refusal: "insufficient_credits" });

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.reserved).toBe(creditsToUnits(35));
    expect(balance!.balance.available).toBeGreaterThanOrEqual(0);
  });

  it("admits exactly as many as the balance funds, under heavy contention", async () => {
    // Ten simultaneous 35-Credit audits against 100 Credits: two fit.
    await fund("purchase", 100, null, "p1");

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        authorizeOperationCredits(supabase(), {
          projectId: PROJECT,
          operation: "business_audit",
          idempotencyKey: `operation:op-${i}`,
          operationRunId: `op-${i}`,
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(2);

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.reserved).toBe(creditsToUnits(70));
    expect(balance!.balance.available).toBeGreaterThanOrEqual(0);
  });

  it("never reserves the same lot capacity twice (§83)", async () => {
    // Mixed sources under contention. No lot may give out more than it holds —
    // `billing_credit_grants_capacity_not_exceeded` is the structure that
    // makes this impossible rather than merely unlikely.
    await fund("welcome", 30, "2026-12-01T00:00:00.000Z", "w1");
    await fund("subscription", 100, "2026-11-01T00:00:00.000Z", "s1");
    await fund("purchase", 500, null, "p1");

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        authorizeOperationCredits(supabase(), {
          projectId: PROJECT,
          operation: "business_audit",
          idempotencyKey: `operation:op-${i}`,
          operationRunId: `op-${i}`,
        }),
      ),
    );

    for (const lot of await listActiveLots(supabase(), await accountId())) {
      expect(lot.allocatedCreditUnits).toBeLessThanOrEqual(lot.initialCreditUnits);
      expect(lot.allocatedCreditUnits).toBeGreaterThanOrEqual(0);
    }

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance!.balance.available).toBeGreaterThanOrEqual(0);
  });

  it("never lets one lot fund more than it holds, under direct contention (§83)", async () => {
    /*
     * The per-lot guard, isolated from the account-level one.
     *
     * The account gate (`posted - reserved >= amount`) is usually the binding
     * constraint, and it masks lot-level bugs: a mutation removing both the
     * allocator's capacity check *and* the database's
     * `billing_credit_grants_capacity_not_exceeded` still passed every other
     * test in this file, because no scenario made a single lot the scarce
     * resource. Found by mutation testing (§102.9).
     *
     * So this contends one 100-Credit lot with two 60-Credit allocations
     * directly, where the lot — not the balance — is what has to say no.
     */
    await fund("purchase", 100, null, "p1");
    const account = await accountId();

    const [first, second] = await Promise.all([
      allocateReservation(supabase(), {
        creditAccountId: account,
        reservationId: "res-a",
        creditUnits: creditsToUnits(60),
      }),
      allocateReservation(supabase(), {
        creditAccountId: account,
        reservationId: "res-b",
        creditUnits: creditsToUnits(60),
      }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);

    const lot = (await listActiveLots(supabase(), account))[0];
    expect(lot.allocatedCreditUnits).toBe(creditsToUnits(60));
    expect(lot.allocatedCreditUnits).toBeLessThanOrEqual(lot.initialCreditUnits);
  });

  it("refuses an allocation larger than any single lot can fund", async () => {
    // Total balance is ample; no individual lot is. The allocator spreads
    // across them, and the per-lot capacity is what bounds each take.
    await fund("welcome", 30, "2026-11-01T00:00:00.000Z", "w1");
    await fund("subscription", 30, "2026-12-01T00:00:00.000Z", "s1");
    const account = await accountId();

    const result = await allocateReservation(supabase(), {
      creditAccountId: account,
      reservationId: "res-a",
      creditUnits: creditsToUnits(50),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.allocations).toEqual([
      { lotId: expect.any(String), creditUnits: creditsToUnits(30) },
      { lotId: expect.any(String), creditUnits: creditsToUnits(20) },
    ]);

    for (const lot of await listActiveLots(supabase(), account)) {
      expect(lot.allocatedCreditUnits).toBeLessThanOrEqual(lot.initialCreditUnits);
    }
  });

  it("protects purchased Credits while expiring capacity remains (§83)", async () => {
    // Welcome expires first, then the subscription period, then the purchase
    // which never does — the ordering the spend policy is defined over.
    await fund("welcome", 30, "2026-11-01T00:00:00.000Z", "w1");
    await fund("subscription", 100, "2026-12-01T00:00:00.000Z", "s1");
    await fund("purchase", 500, null, "p1");

    // One 35-Credit audit: 30 Welcome + 5 Subscription. The purchase is
    // untouched.
    const result = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    expect(result.ok).toBe(true);

    const lots = await listActiveLots(supabase(), await accountId());
    const byKind = Object.fromEntries(lots.map((lot) => [lot.sourceKind, lot]));

    expect(byKind.welcome.allocatedCreditUnits).toBe(creditsToUnits(30));
    expect(byKind.subscription.allocatedCreditUnits).toBe(creditsToUnits(5));
    expect(byKind.purchase.allocatedCreditUnits).toBe(ZERO_CREDITS);
  });
});

/* -------------------------------------------------------------------------
 * §78 — double click
 * ---------------------------------------------------------------------- */

describe("a duplicate request cannot double-charge (§78)", () => {
  it("takes one hold for two identical requests", async () => {
    await fund("purchase", 100, null, "p1");

    const first = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    const second = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    expect(first).toMatchObject({ ok: true, alreadyHeld: false });
    expect(second).toMatchObject({ ok: true, alreadyHeld: true });
    if (!first.ok || !first.billable || !second.ok || !second.billable) throw new Error("expected holds");
    expect(second.reservationId).toBe(first.reservationId);

    // 35 held, not 70.
    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.reserved).toBe(creditsToUnits(35));
  });

  it("posts one charge when both requests settle", async () => {
    await fund("purchase", 100, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    await settleOperationCredits(supabase(), {
      reservationId: held.reservationId,
      policyVersion: "retail-v1",
    });
    await settleOperationCredits(supabase(), {
      reservationId: held.reservationId,
      policyVersion: "retail-v1",
    });

    const charges = (await listLedgerEntries(supabase(), await accountId())).filter(
      (entry) => entry.kind === "charge",
    );
    expect(charges).toHaveLength(1);
    expect(charges[0].creditDelta).toBe(-creditsToUnits(35));
  });
});

/* -------------------------------------------------------------------------
 * §79 / §80 — success and failure
 * ---------------------------------------------------------------------- */

describe("a delivered operation is charged exactly once (§79)", () => {
  it("charges 35 for an audit, at the policy that priced it", async () => {
    await fund("purchase", 100, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    const settled = await settleOperationCredits(supabase(), {
      reservationId: held.reservationId,
      policyVersion: held.policyVersion,
    });

    expect(settled).toMatchObject({ ok: true, chargedCredits: creditsToUnits(35) });

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.posted).toBe(creditsToUnits(65));
    expect(balance?.balance.reserved).toBe(ZERO_CREDITS);
    expect(balance?.balance.available).toBe(creditsToUnits(65));

    const charge = (await listLedgerEntries(supabase(), await accountId())).find(
      (entry) => entry.kind === "charge",
    );
    // The policy identity travels with the charge, so history never re-rates.
    expect(charge?.rateCardVersion).toBe("retail-v1");
  });

  it("attributes the charge to the lots that funded it (§15)", async () => {
    await fund("welcome", 30, "2026-12-01T00:00:00.000Z", "w1");
    await fund("purchase", 500, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    await settleOperationCredits(supabase(), {
      reservationId: held.reservationId,
      policyVersion: held.policyVersion,
    });

    const allocations = await listReservationAllocations(supabase(), held.reservationId);
    const consumed = allocations.filter((allocation) => allocation.status === "consumed");

    // 30 from Welcome, 5 from the purchase — inspectable after the fact.
    expect(consumed).toHaveLength(2);
    expect(consumed[0].consumedUnits).toBe(creditsToUnits(30));
    expect(consumed[1].consumedUnits).toBe(creditsToUnits(5));
  });

  it("charges each priced operation its own price", async () => {
    await fund("purchase", 500, null, "p1");

    for (const [operation, credits] of [
      ["business_audit", 35],
      ["opportunity_generation", 20],
      ["action_plan", 15],
    ] as const) {
      const held = await authorizeOperationCredits(supabase(), {
        projectId: PROJECT,
        operation,
        idempotencyKey: `operation:${operation}`,
        operationRunId: `run-${operation}`,
      });
      if (!held.ok || !held.billable) throw new Error("expected a hold");

      const settled = await settleOperationCredits(supabase(), {
        reservationId: held.reservationId,
        policyVersion: held.policyVersion,
      });
      expect(settled).toMatchObject({ ok: true, chargedCredits: creditsToUnits(credits) });
    }

    // 500 − 35 − 20 − 15.
    expect((await getBillingBalance(supabase(), USER))?.balance.posted).toBe(creditsToUnits(430));
  });
});

describe("a failed operation costs the customer nothing (§45, §80)", () => {
  it("returns the whole hold and posts no charge", async () => {
    await fund("purchase", 100, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    const released = await releaseOperationCredits(supabase(), {
      reservationId: held.reservationId,
      reason: "abandoned_with_usage",
    });

    expect(released).toMatchObject({ ok: true, releasedCredits: creditsToUnits(35) });

    const balance = await getBillingBalance(supabase(), USER);
    expect(balance?.balance.posted).toBe(creditsToUnits(100));
    expect(balance?.balance.reserved).toBe(ZERO_CREDITS);
    expect(balance?.balance.available).toBe(creditsToUnits(100));

    const charges = (await listLedgerEntries(supabase(), await accountId())).filter(
      (entry) => entry.kind === "charge",
    );
    expect(charges).toHaveLength(0);
  });

  it("leaves no stuck reservation and no stranded lot capacity (§80)", async () => {
    await fund("welcome", 30, "2026-12-01T00:00:00.000Z", "w1");
    await fund("purchase", 500, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    await releaseOperationCredits(supabase(), {
      reservationId: held.reservationId,
      reason: "failed_without_usage",
    });

    for (const lot of await listActiveLots(supabase(), await accountId())) {
      expect(lot.allocatedCreditUnits).toBe(ZERO_CREDITS);
    }
    expect(await available()).toBe(creditsToUnits(530));
  });

  it("lets the customer try again with a full balance", async () => {
    await fund("purchase", 40, null, "p1");

    const first = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!first.ok || !first.billable) throw new Error("expected a hold");

    await releaseOperationCredits(supabase(), {
      reservationId: first.reservationId,
      reason: "failed_without_usage",
    });

    const retry = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-2",
      operationRunId: "op-2",
    });

    expect(retry.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * §75 — reservation allocation and release
 * ---------------------------------------------------------------------- */

describe("reservation allocation (§16, §75)", () => {
  it("allocates a hold across lots in spend order, then gives it all back", async () => {
    await fund("welcome", 30, "2026-11-01T00:00:00.000Z", "w1");
    await fund("subscription", 100, "2026-12-01T00:00:00.000Z", "s1");
    await fund("purchase", 500, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    const allocations = await listReservationAllocations(supabase(), held.reservationId);
    expect(allocations.map((allocation) => allocation.creditUnits)).toEqual([
      creditsToUnits(30),
      creditsToUnits(5),
    ]);

    await releaseOperationCredits(supabase(), {
      reservationId: held.reservationId,
      reason: "cancelled_before_usage",
    });

    // All capacity is available again, no charge exists, and the grants are
    // historically unchanged.
    expect(await available()).toBe(creditsToUnits(630));
    const lots = await listActiveLots(supabase(), await accountId());
    expect(lots.map((lot) => lot.initialCreditUnits)).toEqual([
      creditsToUnits(30),
      creditsToUnits(100),
      creditsToUnits(500),
    ]);
    expect(
      (await listLedgerEntries(supabase(), await accountId())).filter((entry) => entry.kind === "charge"),
    ).toHaveLength(0);
  });

  it("marks every allocation released, not merely the lot totals", async () => {
    await fund("purchase", 100, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    await releaseOperationCredits(supabase(), {
      reservationId: held.reservationId,
      reason: "failed_without_usage",
    });

    const allocations = await listReservationAllocations(supabase(), held.reservationId);
    expect(allocations.every((allocation) => allocation.status === "released")).toBe(true);
  });

  /**
   * ADR 0041 §P3, Lot Repair Authority Design — a checked property, not an
   * assumption. Nothing in the schema or in `settleReservationAllocations`
   * itself ties the allocations' own settled sum to what the reservation row
   * ends up recording; the two agree in production today only because
   * `settleOperationCredits` is the one caller of both and happens to pass
   * the identical value to each. Every operation family settles at the full
   * reserved amount through that one function — there is no production
   * caller of a *partial* settlement today — so this drives the two lower
   * functions directly, with a partial amount, to prove the property a
   * future variable-cost caller would depend on, rather than leaving it
   * implicit until one exists.
   */
  it("keeps an allocation's settled sum equal to the reservation's own settled figure", async () => {
    await fund("purchase", 300, null, "p1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    const PARTIAL = creditsToUnits(10);
    await settleReservationAllocations(supabase(), {
      reservationId: held.reservationId,
      actualCredits: PARTIAL,
    });
    await settleReservation(supabase(), {
      reservationId: held.reservationId,
      actualCredits: PARTIAL,
      rateCardVersion: "test",
    });

    const allocations = await listReservationAllocations(supabase(), held.reservationId);
    const allocatedSum = allocations.reduce(
      (total, allocation) => total + (allocation.consumedUnits ?? 0),
      0,
    );

    const reservation = await getReservation(supabase(), held.reservationId);
    expect(allocatedSum).toBe(PARTIAL);
    expect(reservation?.settledCredits).toBe(PARTIAL);
    expect(allocatedSum).toBe(reservation?.settledCredits);
  });
});

/* -------------------------------------------------------------------------
 * Expiry interacting with live work (§17)
 * ---------------------------------------------------------------------- */

describe("expiry and reservations (§17)", () => {
  it("does not spend Credits that lapsed before the request", async () => {
    await fund("welcome", 100, "2026-08-01T00:00:00.000Z", "w1");
    await fund("purchase", 20, null, "p1");

    const result = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
      now: new Date("2026-09-01T00:00:00.000Z"),
    });

    // The lapsed 100 does not count toward affordability, so 20 is all there is.
    expect(result).toMatchObject({
      ok: false,
      refusal: "insufficient_credits",
      availableCredits: creditsToUnits(20),
    });
  });

  it("keeps an approved operation funded when its Credits lapse mid-run (§17)", async () => {
    // Credits that were valid when the customer approved a reservation must not
    // silently disappear and fail work they already authorized.
    await fund("welcome", 100, "2026-09-02T00:00:00.000Z", "w1");

    const held = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    if (!held.ok || !held.billable) throw new Error("expected a hold");

    // The lot lapses while the operation is running.
    const settled = await settleOperationCredits(supabase(), {
      reservationId: held.reservationId,
      policyVersion: held.policyVersion,
    });

    expect(settled).toMatchObject({ ok: true, chargedCredits: creditsToUnits(35) });
  });
});

/* -------------------------------------------------------------------------
 * §56 — free operations
 * ---------------------------------------------------------------------- */

describe("free operations (§56)", () => {
  it("neither reserves nor charges for Product Understanding", async () => {
    const result = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "product_understanding",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    expect(result).toEqual({ ok: true, billable: false });
  });

  it("runs free even with an empty wallet", async () => {
    const result = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "product_understanding",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    expect(result.ok).toBe(true);
    // No wallet activity at all — not even a zero-Credit entry.
    const entries = await listLedgerEntries(supabase(), await accountId());
    expect(entries).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------
 * §65 — ownership
 * ---------------------------------------------------------------------- */

describe("ownership (§65)", () => {
  it("refuses to bill against a project the caller does not own", async () => {
    // `resolveBillingOwner` reads ownership from the project row; a project
    // that does not exist for this caller resolves to no owner and no account.
    const result = await authorizeOperationCredits(supabase(), {
      projectId: "99999999-9999-9999-9999-999999999999",
      operation: "business_audit",
      idempotencyKey: "operation:op-1",
      operationRunId: "op-1",
    });

    expect(result).toMatchObject({ ok: false, refusal: "account_not_found" });
  });
});

/**
 * Sprint 0057 — a retried authorization allocates, and only from a state it
 * can explain (§I2).
 *
 * `claimReservation` inserts the reservation row *before* `admitHold`, and
 * `authorizeOperationCredits` allocates only after the claim returns. So there
 * are two windows in which a durable, active reservation exists with no
 * allocations behind it — a crash between the claim and the allocation, and a
 * concurrent caller landing on the idempotency key mid-claim.
 *
 * The `alreadyHeld` branch returned on the comment "the hold and its
 * allocations already exist", which in those windows is simply false. The hold
 * then settled at full price with no lot provenance:
 * `settleReservationAllocations` finds nothing held and returns immediately.
 *
 * A blind "no rows, so allocate" would be unsafe on its own — it is safe only
 * because `allocateReservation` now unwinds every way out that is not a commit,
 * which is what makes zero rows mean zero capacity taken.
 */
describe("a retried authorization completes a missing allocation", () => {
  it("allocates when the hold exists and its allocations do not", async () => {
    await fund("purchase", 200, null, "grant:retry");

    const first = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:retried",
      operationRunId: "op-retried",
    });
    if (!first.ok || !first.billable) throw new Error("fixture could not authorize");

    // Exactly what a crash between the claim and the allocation leaves behind.
    db.current.rows("billing_credit_allocations").length = 0;
    expect(await listReservationAllocations(supabase(), first.reservationId)).toHaveLength(0);

    const retry = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:retried",
      operationRunId: "op-retried",
    });

    expect(retry).toMatchObject({ ok: true, billable: true, alreadyHeld: true });
    // The hold now has lots behind it, so a settlement can consume them.
    expect(await listReservationAllocations(supabase(), first.reservationId)).not.toHaveLength(0);
  });

  it("returns unchanged when the allocations are already complete", async () => {
    await fund("purchase", 200, null, "grant:complete");

    const first = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:complete",
      operationRunId: "op-complete",
    });
    if (!first.ok || !first.billable) throw new Error("fixture could not authorize");
    const before = await listReservationAllocations(supabase(), first.reservationId);

    const retry = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:complete",
      operationRunId: "op-complete",
    });

    expect(retry).toMatchObject({ ok: true, billable: true, alreadyHeld: true });
    // No second set of rows, and no second take from the lot.
    expect(await listReservationAllocations(supabase(), first.reservationId)).toHaveLength(
      before.length,
    );
  });
});

/**
 * Sprint 0057 — releasing checks the reservation's state before touching lots.
 *
 * `settleOperationCredits` has had a `status === "settled"` pre-check since it
 * was written. Its release counterpart had none, and released allocations
 * *first*: called on a settled reservation it walked the allocations, handed
 * their capacity back for a hold that had already been charged, and only then
 * discovered the reservation was not active — reporting success.
 */
describe("releasing an operation's credits checks the reservation first", () => {
  it("does not return capacity for a reservation that was already settled", async () => {
    await fund("purchase", 200, null, "grant:settled");

    const authorized = await authorizeOperationCredits(supabase(), {
      projectId: PROJECT,
      operation: "business_audit",
      idempotencyKey: "operation:settled",
      operationRunId: "op-settled",
    });
    if (!authorized.ok || !authorized.billable) throw new Error("fixture could not authorize");

    await settleOperationCredits(supabase(), {
      reservationId: authorized.reservationId,
      policyVersion: authorized.policyVersion,
    });
    const afterSettle = await available();

    const released = await releaseOperationCredits(supabase(), {
      reservationId: authorized.reservationId,
      reason: "cancelled_before_usage",
    });

    // The charge stands, so its capacity stays consumed. Handing it back would
    // give the customer Credits they have already spent.
    expect(released).toMatchObject({ ok: false });
    expect(await available()).toBe(afterSettle);
  });
});
