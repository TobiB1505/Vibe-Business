import { beforeEach, describe, expect, it } from "vitest";
import { grantCreditLot } from "@/modules/credits/grants";
import { creditsToUnits } from "@/modules/credits/units";
import { FakeDatabase, fakeSupabase, seedProductUnderstanding } from "@/modules/operations/test-support";
import { auditBlockedByCredits, resolveAuditCreditGate } from "./entitlement";
import { getAuditAccessStatus } from "./service";

/**
 * The join between an entitlement decision and a wallet
 * (BILLING CORE-2 §39, §43).
 *
 * `toAuditAccessStatus` is a pure function over entitlement facts and is tested
 * exhaustively in `entitlement.test.ts`. What it cannot answer is the question
 * the screen actually asks after the included audit is spent — *can this
 * customer pay for another one, and how much are they short?* — because a
 * balance is not an entitlement fact.
 *
 * That gap was not theoretical. `credits_required` reached the UI as a bare
 * refusal, the UI drew it as a wall, and a customer holding 6,080 Credits was
 * told Credits were unavailable. These tests pin the seam that closes it.
 */

const USER = "user_1";
const PROJECT = "project_1";
const REPOSITORY_ID = 12345;

let db: FakeDatabase;

function seedAuditableProject() {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("repository_intelligence_snapshots", {
    id: "repo_snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: { schemaVersion: "repository_intelligence.v1" },
    created_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    id: "live_snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: { schemaVersion: "live-product-intelligence.v1" },
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  seedProductUnderstanding(db, { projectId: PROJECT });
}

/** Spends the included audit durably, the way a real reconnect-proof grant does. */
function consumeIncludedEntitlement() {
  db.seed("repository_connections", {
    id: "conn_1",
    project_id: PROJECT,
    github_repository_id: REPOSITORY_ID,
  });
  db.seed("free_audit_grants", {
    id: "grant_1",
    user_id: USER,
    github_repository_id: REPOSITORY_ID,
  });
}

async function fundWallet(credits: number) {
  await grantCreditLot(fakeSupabase(db), {
    userId: USER,
    sourceKind: "purchase",
    credits: creditsToUnits(credits),
    reason: "test funding",
    idempotencyKey: `test-fund:${credits}`,
  });
}

function status() {
  return getAuditAccessStatus(fakeSupabase(db), { projectId: PROJECT, userId: USER });
}

beforeEach(() => {
  db = new FakeDatabase();
  seedAuditableProject();
});

describe("getAuditAccessStatus", () => {
  it("resolves no price while the included audit is still available", async () => {
    const access = await status();

    expect(access.freeAuditAvailable).toBe(true);
    expect(access.blockedReason).toBeNull();
    // No price, and no wallet read — there is nothing to pay for.
    expect(access.creditCost).toBeNull();
  });

  it("reports the price and the balance once the included audit is spent", async () => {
    consumeIncludedEntitlement();
    await fundWallet(6080);

    const access = await status();

    expect(access.blockedReason).toBe("credits_required");
    expect(access.creditCost).toEqual({
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(6080),
      affordable: true,
    });
    // The regression, at the seam that produced it.
    expect(auditBlockedByCredits(resolveAuditCreditGate(access))).toBe(false);
  });

  it("reports both numbers when the wallet cannot cover it", async () => {
    consumeIncludedEntitlement();
    await fundWallet(20);

    const access = await status();

    expect(access.creditCost).toEqual({
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(20),
      affordable: false,
    });
    expect(auditBlockedByCredits(resolveAuditCreditGate(access))).toBe(true);
  });

  /**
   * A customer who has never spent anything has no wallet row. That is a
   * balance of zero, not a missing answer — and reading it must not create the
   * account, because this runs on every render of the score page.
   */
  it("reads a balance of zero without minting a billing account", async () => {
    consumeIncludedEntitlement();

    const access = await status();

    expect(access.creditCost).toEqual({
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(0),
      affordable: false,
    });
    expect(db.rows("billing_credit_accounts")).toHaveLength(0);
  });

  /**
   * Reserved Credits are somebody else's already. Reporting the posted balance
   * would tell a customer they can afford an audit whose price is spoken for by
   * an operation currently running.
   */
  it("excludes Credits already held by another operation", async () => {
    consumeIncludedEntitlement();
    await fundWallet(50);

    const { holdOperationCredits } = await import("@/modules/operations/billing");
    db.seed("operation_runs", {
      id: "operation_other",
      project_id: PROJECT,
      user_id: USER,
      operation_type: "business_audit",
      status: "running",
      stage: "running_ai",
      input_identity: "a".repeat(64),
      created_at: "2026-08-02T00:00:00.000Z",
    });
    await holdOperationCredits(fakeSupabase(db), {
      projectId: PROJECT,
      operationRunId: "operation_other",
      operation: "business_audit",
    });

    const access = await status();

    expect(access.creditCost).toEqual({
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(15),
      affordable: false,
    });
  });

  /**
   * A refusal that is not about money must not acquire a price. The wallet is
   * only read on the one path where the customer is being asked to spend.
   */
  it("resolves no price when something other than Credits blocks the audit", async () => {
    consumeIncludedEntitlement();
    await fundWallet(6080);
    db.rows("product_profiles").forEach((row) => {
      row.status = "failed";
    });

    const access = await status();

    expect(access.blockedReason).not.toBe("credits_required");
    expect(access.creditCost).toBeNull();
    expect(resolveAuditCreditGate(access)).toEqual({ kind: "not_applicable" });
  });
});
