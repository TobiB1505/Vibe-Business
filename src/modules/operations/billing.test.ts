import { beforeEach, describe, expect, it } from "vitest";
import { grantCreditLot } from "@/modules/credits/grants";
import { listLedgerEntries } from "@/modules/credits/store";
import { creditsToUnits } from "@/modules/credits/units";
import { holdOperationCredits, settleOperationBilling } from "./billing";
import { FakeDatabase, fakeSupabase } from "./test-support";

/**
 * The card a charge is stamped with is the card that priced it.
 *
 * ## The defect this pins, found in production
 *
 * `settleOperationBilling` used to resolve the policy version as
 * `params.policyVersion ?? "retail-v1"`, and none of its three production
 * callers — the audit, opportunity and planner completions — passes one. So
 * every charge carried that literal whatever had priced it.
 *
 * That was correct for exactly as long as `retail-v1` was the only policy, and
 * wrong from the instant `launch-v1` took effect on 2026-09-01. Eleven
 * production charges name a card that cannot explain their own amount, the
 * clearest being an Action Plan settled at 20 Credits under a policy whose
 * Action Plan price is 15.
 *
 * The amounts were never wrong: the price comes from `retailChargeFor` at
 * authorization time and lands on the reservation. Only the provenance was,
 * which is worse in a quiet way — a charge whose recorded reason is checkable
 * and false is harder to catch than one that is simply missing.
 */

const PROJECT = "project_1";
const USER = "user_1";

/** After `launch-v1` takes effect, so the two policies disagree about the price. */
const AFTER_LAUNCH_V1 = new Date("2026-09-04T12:00:00.000Z");

let db: FakeDatabase;
const supabase = () => fakeSupabase(db);

async function fundedAccount() {
  db.seed("projects", { id: PROJECT, user_id: USER });
  await grantCreditLot(supabase(), {
    userId: USER,
    sourceKind: "welcome",
    credits: creditsToUnits(500),
    reason: "test funding",
    idempotencyKey: "test-grant",
  });
}

beforeEach(async () => {
  db = new FakeDatabase();
  await fundedAccount();
});

describe("settling an operation's charge", () => {
  it("stamps the policy that priced the hold, not a literal", async () => {
    const held = await holdOperationCredits(supabase(), {
      projectId: PROJECT,
      operationRunId: "run_1",
      operation: "action_plan",
      now: AFTER_LAUNCH_V1,
    });
    expect(held.ok).toBe(true);

    await settleOperationBilling(supabase(), { operationRunId: "run_1" });

    const account = db.rows("billing_credit_accounts")[0];
    const charges = (await listLedgerEntries(supabase(), account.id as string)).filter(
      (entry) => entry.kind === "charge",
    );

    expect(charges).toHaveLength(1);
    // `launch-v1` prices an Action Plan at 20; `retail-v1` priced it at 15. The
    // amount already proved which card resolved — the stamp has to agree.
    expect(charges[0].creditDelta).toEqual(creditsToUnits(-20));
    expect(charges[0].rateCardVersion).toBe("launch-v1");
  });

  it("lets a caller name the version explicitly, and prefers it", async () => {
    await holdOperationCredits(supabase(), {
      projectId: PROJECT,
      operationRunId: "run_2",
      operation: "business_audit",
      now: AFTER_LAUNCH_V1,
    });

    await settleOperationBilling(supabase(), {
      operationRunId: "run_2",
      policyVersion: "explicit-v9",
    });

    const account = db.rows("billing_credit_accounts")[0];
    const [charge] = (await listLedgerEntries(supabase(), account.id as string)).filter(
      (entry) => entry.kind === "charge",
    );

    expect(charge.rateCardVersion).toBe("explicit-v9");
  });

  it("is a no-op for an operation that never held anything", async () => {
    await settleOperationBilling(supabase(), { operationRunId: "run_never_held" });

    expect(db.rows("billing_credit_ledger").filter((row) => row.kind === "charge")).toEqual([]);
  });
});
