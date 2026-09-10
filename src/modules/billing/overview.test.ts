import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { grantCreditLot } from "@/modules/credits/grants";
import {
  allocateReservation,
  listActiveLots,
  listReservationAllocations,
} from "@/modules/credits/lot-store";
import {
  claimReservation,
  ensureCreditAccount,
  LEDGER_READ_LIMIT,
  listLedgerEntries,
} from "@/modules/credits/store";
import { creditsToUnits } from "@/modules/credits/units";
import { deepScanIdempotencyKey } from "@/modules/authenticated-product-intelligence/billing";
import {
  subscriptionGrantIdempotencyKey,
  topUpGrantIdempotencyKey,
  welcomeGrantIdempotencyKey,
} from "./catalog";
import { getBillingOverview, getHeaderCreditBalance } from "./overview";

/**
 * `getBillingOverview`/`getHeaderCreditBalance` (ADR 0042 §P3).
 *
 * `getBillingOverview` is the one read a customer actually makes when they
 * look at their balance, which is why it — not `getHeaderCreditBalance`, not
 * the pre-operation admission check — is where both repair triggers
 * (`reconcileAndRepairBalance`, `reconcileAndRepairLotAllocations`) attach.
 * These tests prove the gate is real from the outside: `availableCredits`
 * itself changes with the flag, not just an internal reconciliation result.
 */

const db = { current: new FakeDatabase() };

/**
 * The repair primitives run under a service-role client in production
 * (PERF-011): the tables they write carry a select policy and no write policy,
 * so the caller's own client is refused. `FakeDatabase` has no RLS to bypass,
 * so both clients are the same fake here — which is what keeps these tests
 * about the repair's arithmetic rather than about who is allowed to run it.
 * Who is allowed is asserted by `service-boundary.test.ts` and by the grants
 * in the migration.
 */
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(db.current),
}));

const supabase = () => fakeSupabase(db.current);

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db.current = new FakeDatabase();
});

const previousFlag = process.env.BILLING_REPAIR_ENABLED;

beforeEach(() => {
  delete process.env.BILLING_REPAIR_ENABLED;
});

afterEach(() => {
  if (previousFlag === undefined) delete process.env.BILLING_REPAIR_ENABLED;
  else process.env.BILLING_REPAIR_ENABLED = previousFlag;
});

/**
 * Grants one lot, fully allocates it, then simulates a crash between the
 * allocation's release and its `materialize_allocation_capacity` call — the
 * lot's `allocated_credit_units` stays at the full amount even though the
 * hold was actually released, exactly as `lot-store.test.ts`'s
 * `reconcileAndRepairLotAllocations` tests construct it. Understates
 * `spendableCapacity` by the drifted amount until repaired.
 */
async function accountWithDriftedLot(credits: number): Promise<{ accountId: string }> {
  const { account } = await ensureCreditAccount(supabase(), USER);
  await grantCreditLot(supabase(), {
    userId: USER,
    sourceKind: "purchase",
    credits: creditsToUnits(credits),
    reason: "test lot",
    idempotencyKey: `lot:${credits}`,
    expiresAt: null,
  });

  const claim = await claimReservation(supabase(), {
    account,
    reservedCredits: creditsToUnits(credits),
    idempotencyKey: `hold:${credits}`,
    projectId: PROJECT,
  });
  if (!claim.ok) throw new Error("fixture could not take a hold");
  const allocated = await allocateReservation(supabase(), {
    creditAccountId: account.id,
    reservationId: claim.reservation.id,
    creditUnits: creditsToUnits(credits),
  });
  if (!allocated.ok) throw new Error("fixture could not allocate");

  const [allocation] = await listReservationAllocations(supabase(), claim.reservation.id);
  const row = db.current
    .rows("billing_credit_allocations")
    .find((entry) => (entry as { id: string }).id === allocation.id) as {
    status: string;
    released_at: string | null;
  };
  row.status = "released";
  row.released_at = new Date().toISOString();

  return { accountId: account.id };
}

describe("getBillingOverview repairs lot drift within the same call (ADR 0042 §P3)", () => {
  it("reflects a repaired lot's capacity in availableCredits when the flag is set", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    await accountWithDriftedLot(100);

    const overview = await getBillingOverview(supabase(), { userId: USER });

    // The release was real; repair brings the drifted capacity back.
    expect(overview.availableCredits).toBe(creditsToUnits(100));

    const lots = await listActiveLots(
      supabase(),
      (await ensureCreditAccount(supabase(), USER)).account.id,
    );
    expect(lots[0].allocatedCreditUnits).toBe(0);
  });

  it("computes availableCredits from the unrepaired, understated figure when the flag is unset", async () => {
    await accountWithDriftedLot(100);

    const overview = await getBillingOverview(supabase(), { userId: USER });

    // Repair never ran: the lot still reads as fully allocated, so the
    // customer would see 0 available Credits they actually have.
    expect(overview.availableCredits).toBe(0);
  });

  it("also repairs account-level drift as a side effect, invisible to the page's own return value", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    const { accountId } = await accountWithDriftedLot(100);

    // A second, independent drift: a ledger entry inserted directly, the
    // same technique `credits/service.test.ts`'s equivalent test uses.
    await supabase()
      .from("billing_credit_ledger")
      .insert({
        credit_account_id: accountId,
        kind: "grant",
        credit_delta: creditsToUnits(50),
        idempotency_key: "crashed-before-materialize",
      });

    await getBillingOverview(supabase(), { userId: USER });

    const account = db.current
      .rows("billing_credit_accounts")
      .find((row) => (row as { id: string }).id === accountId) as { posted_credits: number };
    expect(account.posted_credits).toBe(creditsToUnits(150));

    const driftEvents = db.current
      .rows("audit_events")
      .filter((row) => String(row.event_type).startsWith("credit_drift."));
    // One pair for the lot, one pair for the account.
    expect(driftEvents).toHaveLength(4);
    expect(driftEvents.filter((event) => event.event_type === "credit_drift.repaired")).toHaveLength(2);
  });
});

describe("getHeaderCreditBalance does not trigger repair (ADR 0042 §P3)", () => {
  it("still reads the drifted figure even when the flag is set", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    await accountWithDriftedLot(100);

    const header = await getHeaderCreditBalance(supabase(), { userId: USER });

    // Unrepaired: this read never calls reconcileAndRepairLotAllocations.
    expect(header?.availableCredits).toBe(0);
    const driftEvents = db.current
      .rows("audit_events")
      .filter((row) => String(row.event_type).startsWith("credit_drift."));
    expect(driftEvents).toHaveLength(0);
  });

  it("reads the corrected figure passively once a prior getBillingOverview call has repaired it", async () => {
    process.env.BILLING_REPAIR_ENABLED = "true";
    await accountWithDriftedLot(100);

    await getBillingOverview(supabase(), { userId: USER });
    const header = await getHeaderCreditBalance(supabase(), { userId: USER });

    expect(header?.availableCredits).toBe(creditsToUnits(100));
  });
});

describe("the orphaned-hold detector on this same read (VB-020)", () => {
  /**
   * A Credit hold left standing over a finished operation used to be visible
   * only to a SQL query in a deployment checklist. It is now noticed at the one
   * read a customer makes about their own balance.
   *
   * These tests are about the wiring and about what it must never do to the
   * page — the detection rules themselves are pinned in
   * `credits/orphaned-holds.test.ts`.
   */
  async function accountWithHoldOver(operationStatus: string, completedMinutesAgo: number) {
    const { account } = await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(100),
      reason: "test lot",
      idempotencyKey: "lot:orphan",
      expiresAt: null,
    });

    const operation = db.current.seed("operation_runs", {
      project_id: PROJECT,
      user_id: USER,
      operation_type: "business_audit",
      status: operationStatus,
      stage: "running_ai",
      input_identity: "identity-orphan",
      started_at: new Date(Date.now() - 3_600_000).toISOString(),
      completed_at: new Date(Date.now() - completedMinutesAgo * 60_000).toISOString(),
    });

    const claim = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(35),
      idempotencyKey: "hold:orphan",
      projectId: PROJECT,
      operationRunId: String(operation.id),
    });
    if (!claim.ok) throw new Error("fixture could not take a hold");

    return { accountId: account.id };
  }

  function orphanEvents() {
    return db.current
      .rows("audit_events")
      .filter((row) => (row as { event_type?: string }).event_type === "credit_hold.orphaned");
  }

  it("records the stuck hold where a person can see it", async () => {
    await accountWithHoldOver("failed", 60);

    await getBillingOverview(supabase(), { userId: USER });

    expect(orphanEvents()).toHaveLength(1);
    expect(orphanEvents()[0]).toMatchObject({
      metadata: expect.objectContaining({ owed: "release" }),
    });
  });

  /**
   * The failure that would make this detector worse than the condition: every
   * successful operation is briefly terminal with an active hold, so a
   * detector without a grace window fires on the happy path and gets ignored.
   */
  it("says nothing during the ordinary gap between completing and settling", async () => {
    await accountWithHoldOver("completed", 0);

    await getBillingOverview(supabase(), { userId: USER });

    expect(orphanEvents()).toEqual([]);
  });

  /**
   * A customer who cannot see their balance because something noticed a stuck
   * hold is strictly worse off than one whose stuck hold went unreported.
   */
  it("never takes the billing page down when it fails", async () => {
    await accountWithHoldOver("failed", 60);
    // The failure that actually propagates: the read of the operations behind
    // the holds. `recordAuditEvent` swallows its own errors, so injecting one
    // there would have tested nothing — the first version of this test did
    // exactly that and passed with the `catch` removed.
    db.current.failNextReadWith = { table: "operation_runs", message: "boom" };

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.displayAvailable).toBeTruthy();
    expect(orphanEvents()).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * Activity labels
 * ------------------------------------------------------------------------ */

/**
 * What each line of Credit history is called.
 *
 * ## Why these are worth a test each
 *
 * Because the labels were wrong for as long as they existed, and nothing could
 * see it. `OPERATION_LABELS` sat in `overview.ts` exported "for the activity
 * view's tests" and was called by no renderer, so every charge — an audit, a
 * plan, an agent run — came out of `toActivityEntry` as "Credits used". The
 * browser fixtures meanwhile said "Agent improvement" and the e2e asserted it.
 * The suite was green and described a screen that did not exist.
 *
 * So the assertions below are deliberately made against **ledger rows**, not
 * against a mapping table: a test that checked `OPERATION_LABELS.business_audit`
 * would have passed throughout the entire period the bug existed.
 */
describe("recent activity is named from the record, never guessed", () => {
  async function fund(): Promise<{ accountId: string }> {
    const { account } = await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(5_000),
      reason: "test lot",
      idempotencyKey: "lot:labels",
      expiresAt: null,
    });
    return { accountId: account.id };
  }

  /** A settled charge against a real operation run, as production writes one. */
  async function charge(params: {
    accountId: string;
    operationType: string;
    credits: number;
    key: string;
  }): Promise<void> {
    const operation = db.current.seed("operation_runs", {
      project_id: PROJECT,
      user_id: USER,
      operation_type: params.operationType,
      status: "completed",
      stage: "done",
      input_identity: `identity-${params.key}`,
    });

    db.current.seed("billing_credit_ledger", {
      credit_account_id: params.accountId,
      kind: "charge",
      credit_delta: -creditsToUnits(params.credits),
      operation_run_id: String(operation.id),
      idempotency_key: params.key,
    });
  }

  async function labels(): Promise<string[]> {
    const overview = await getBillingOverview(supabase(), { userId: USER });
    return overview.recentActivity.map((entry) => entry.label);
  }

  /** Only what was spent — `fund()` posts a purchase of its own. */
  async function chargeLabels(): Promise<string[]> {
    const overview = await getBillingOverview(supabase(), { userId: USER });
    return overview.recentActivity.filter((entry) => entry.creditDelta < 0).map((entry) => entry.label);
  }

  it("calls a charge what the customer bought", async () => {
    const { accountId } = await fund();
    await charge({ accountId, operationType: "business_audit", credits: 35, key: "c:audit" });

    expect(await labels()).toContain("Business Audit");
  });

  it("names an agent run, which is the most expensive line anyone will see", async () => {
    const { accountId } = await fund();
    await charge({ accountId, operationType: "agent_execution", credits: 200, key: "c:agent" });

    const overview = await getBillingOverview(supabase(), { userId: USER });
    const entry = overview.recentActivity.find((row) => row.label === "Agent improvement");

    expect(entry?.displayAmount).toBe("-200");
  });

  /**
   * Deep Scan is the one paid operation with no `operation_runs` row — it is
   * not durable, and its reservation deliberately carries a null run id. The
   * only thing that identifies it afterwards is the key prefix.
   */
  it("names a Deep Scan from its reservation, having no operation to read", async () => {
    const { accountId } = await fund();
    const reservation = db.current.seed("billing_credit_reservations", {
      credit_account_id: accountId,
      project_id: PROJECT,
      operation_run_id: null,
      reserved_credits: creditsToUnits(25),
      status: "settled",
      settled_credits: creditsToUnits(25),
      idempotency_key: deepScanIdempotencyKey("session-1"),
    });

    db.current.seed("billing_credit_ledger", {
      credit_account_id: accountId,
      kind: "charge",
      credit_delta: -creditsToUnits(25),
      operation_run_id: null,
      reservation_id: String(reservation.id),
      idempotency_key: "c:scan",
    });

    expect(await labels()).toContain("Deep Scan");
  });

  it("tells a plan renewal, a pack and the welcome allowance apart", async () => {
    const { accountId } = await fund();

    for (const [key, credits] of [
      [subscriptionGrantIdempotencyKey("in_1"), 3_000],
      [topUpGrantIdempotencyKey("cs_1"), 1_000],
      [welcomeGrantIdempotencyKey(USER), 100],
    ] as const) {
      db.current.seed("billing_credit_ledger", {
        credit_account_id: accountId,
        kind: "grant",
        credit_delta: creditsToUnits(credits),
        idempotency_key: key,
      });
    }

    const found = await labels();
    expect(found).toContain("Monthly Credits");
    expect(found).toContain("Credit Pack");
    expect(found).toContain("Welcome Credits");
  });

  /**
   * The branch the whole design rests on. An operation type with no
   * customer-facing price has no customer-facing name, and inventing one — or
   * printing `change_validation` — would be worse than the vague truth.
   */
  it("falls back rather than naming an operation the customer never bought", async () => {
    const { accountId } = await fund();
    await charge({ accountId, operationType: "change_validation", credits: 5, key: "c:validation" });

    expect(await chargeLabels()).toEqual(["Credits used"]);
  });

  it("falls back when the operation behind a charge is gone", async () => {
    const { accountId } = await fund();
    db.current.seed("billing_credit_ledger", {
      credit_account_id: accountId,
      kind: "charge",
      credit_delta: -creditsToUnits(35),
      operation_run_id: "99999999-9999-9999-9999-999999999999",
      idempotency_key: "c:erased",
    });

    expect(await chargeLabels()).toEqual(["Credits used"]);
  });

  /**
   * A customer who cannot see their balance because a *label* lookup failed is
   * strictly worse off than one whose history reads "Credits used" — and unlike
   * the orphaned-hold detector, this runs on the happy path.
   */
  it("never takes the billing page down when naming fails", async () => {
    const { accountId } = await fund();
    await charge({ accountId, operationType: "business_audit", credits: 35, key: "c:audit" });
    db.current.failNextReadWith = { table: "operation_runs", message: "boom" };

    const overview = await getBillingOverview(supabase(), { userId: USER });

    // The balance is unaffected: it comes from lots, and naming is decoration.
    expect(overview.displayAvailable).toBe("5,000");
    expect(overview.recentActivity.filter((entry) => entry.creditDelta < 0)).toEqual([
      expect.objectContaining({ label: "Credits used" }),
    ]);
  });
});

/* ---------------------------------------------------------------------------
 * Balance context
 * ------------------------------------------------------------------------ */

describe("what the balance card is allowed to claim", () => {
  it("reports Credits a live hold is holding, so a lower balance has an explanation", async () => {
    const { account } = await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "subscription",
      credits: creditsToUnits(1_000),
      reason: "period",
      idempotencyKey: "lot:period",
      expiresAt: null,
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-09-01T00:00:00.000Z",
    });

    const claim = await claimReservation(supabase(), {
      account,
      reservedCredits: creditsToUnits(200),
      idempotencyKey: "hold:agent",
      projectId: PROJECT,
    });
    if (!claim.ok) throw new Error("fixture could not take a hold");

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.reservedCredits).toBe(creditsToUnits(200));
    expect(overview.displayReserved).toBe("200");
  });

  it("says nothing about a hold when there is none", async () => {
    await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(100),
      reason: "pack",
      idempotencyKey: "lot:pack",
      expiresAt: null,
    });

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.reservedCredits).toBe(0);
  });

  /**
   * The allowance is the *subscription* lot's, not the wallet's. A purchased
   * pack is not part of a monthly allowance, and counting it would make the
   * denominator move when somebody topped up — "800 of 3,000" becoming
   * "800 of 4,000" for buying Credits is a page arguing with itself.
   */
  it("measures the monthly allowance against the plan grant alone", async () => {
    await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "subscription",
      credits: creditsToUnits(3_000),
      reason: "period",
      idempotencyKey: "lot:period",
      expiresAt: null,
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-09-01T00:00:00.000Z",
    });
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(1_000),
      reason: "pack",
      idempotencyKey: "lot:pack",
      expiresAt: null,
    });

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.availableCredits).toBe(creditsToUnits(4_000));
    expect(overview.monthlyAllowance).toMatchObject({
      displayRemaining: "3,000",
      displayInitial: "3,000",
    });
  });

  it("claims no allowance for an account with no plan grant", async () => {
    await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "welcome",
      credits: creditsToUnits(100),
      reason: "welcome",
      idempotencyKey: "lot:welcome",
      expiresAt: null,
    });

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.monthlyAllowance).toBeNull();
  });
});

/**
 * The welcome grant is the oldest row an account has, and the ledger read that
 * used to answer this question is capped and newest-first (VB-025). So the
 * answer decayed with age: past `LEDGER_READ_LIMIT` movements the row fell out
 * of the window, `welcomeGranted` flipped to false, and the screen re-offered
 * Credits the customer had already been given.
 */
describe("whether the welcome allowance was already granted (PERF-012)", () => {
  /** One welcome grant, then enough newer movements to push it out of the window. */
  async function accountWithBuriedWelcomeGrant(newerEntries: number): Promise<void> {
    const { account } = await ensureCreditAccount(supabase(), USER);

    db.current.seed("billing_credit_ledger", {
      credit_account_id: account.id,
      kind: "grant",
      credit_delta: creditsToUnits(100),
      idempotency_key: welcomeGrantIdempotencyKey(USER),
      created_at: "2020-01-01T00:00:00.000Z",
    });

    for (let index = 0; index < newerEntries; index += 1) {
      db.current.seed("billing_credit_ledger", {
        credit_account_id: account.id,
        kind: "charge",
        credit_delta: creditsToUnits(-1),
        idempotency_key: `charge:${index}`,
        created_at: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
    }
  }

  it("still reports the grant once it is older than the ledger read cap", async () => {
    await accountWithBuriedWelcomeGrant(LEDGER_READ_LIMIT + 20);

    // The premise, asserted rather than assumed: without this the test passes
    // for the wrong reason the day the cap or the ordering changes.
    const { account } = await ensureCreditAccount(supabase(), USER);
    const window = await listLedgerEntries(supabase(), account.id);
    expect(window.some((entry) => entry.idempotencyKey === welcomeGrantIdempotencyKey(USER))).toBe(
      false,
    );

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(
      overview.welcomeGranted,
      "the grant exists; the read that looks for it must not be the capped window",
    ).toBe(true);
  });

  it("reports it on a young account too, where the window would also have found it", async () => {
    await accountWithBuriedWelcomeGrant(3);

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.welcomeGranted).toBe(true);
  });

  it("reports no grant when the account genuinely never received one", async () => {
    await ensureCreditAccount(supabase(), USER);
    await grantCreditLot(supabase(), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(500),
      reason: "a pack, not the welcome allowance",
      idempotencyKey: "lot:pack",
      expiresAt: null,
    });

    const overview = await getBillingOverview(supabase(), { userId: USER });

    expect(overview.welcomeGranted).toBe(false);
  });
});
