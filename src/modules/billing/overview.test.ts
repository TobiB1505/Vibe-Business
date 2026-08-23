import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { grantCreditLot } from "@/modules/credits/grants";
import {
  allocateReservation,
  listActiveLots,
  listReservationAllocations,
} from "@/modules/credits/lot-store";
import { claimReservation, ensureCreditAccount } from "@/modules/credits/store";
import { creditsToUnits } from "@/modules/credits/units";
import { getBillingOverview, getHeaderCreditBalance } from "./overview";

/**
 * `getBillingOverview`/`getHeaderCreditBalance` (ADR 0041 §P3).
 *
 * `getBillingOverview` is the one read a customer actually makes when they
 * look at their balance, which is why it — not `getHeaderCreditBalance`, not
 * the pre-operation admission check — is where both repair triggers
 * (`reconcileAndRepairBalance`, `reconcileAndRepairLotAllocations`) attach.
 * These tests prove the gate is real from the outside: `availableCredits`
 * itself changes with the flag, not just an internal reconciliation result.
 */

const db = { current: new FakeDatabase() };
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

describe("getBillingOverview repairs lot drift within the same call (ADR 0041 §P3)", () => {
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

describe("getHeaderCreditBalance does not trigger repair (ADR 0041 §P3)", () => {
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
