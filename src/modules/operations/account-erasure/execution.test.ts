import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "../test-support";

const deleteProjectLifecycle = vi.fn();
const cancelSubscriptionsForErasure = vi.fn();
const deleteUser = vi.fn();
const getUserById = vi.fn();

vi.mock("../project-lifecycle/service", () => ({
  deleteProjectLifecycle: (...args: unknown[]) => deleteProjectLifecycle(...args),
}));
vi.mock("@/modules/billing/subscription", () => ({
  cancelSubscriptionsForErasure: (...args: unknown[]) => cancelSubscriptionsForErasure(...args),
}));

const {
  admitErasureStep,
  cancelSubscriptionStep,
  deleteIdentityStep,
  deleteProjectsStep,
  failErasure,
  scrubAuditStep,
  tombstoneAccountStep,
} = await import("./execution");

/**
 * The eleven steps (ADR 0056 §4).
 *
 * Two properties dominate, and neither is about the happy path.
 *
 * **The owner is read from the operation row, never from an argument.** No step
 * here takes a `userId`. That is the one mistake in this file that would delete
 * the wrong person, so it is asserted directly rather than left to review.
 *
 * **A failed step stops the erasure.** There is no partial success: an identity
 * deleted while its subscription still bills, or a billing graph tombstoned
 * under an identity that still exists, are both worse than a refusal.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

let db: FakeDatabase;

function deps() {
  const client = fakeSupabase(db) as unknown as Record<string, unknown>;
  // `auth.users` is not reachable through PostgREST, so the identity delete is
  // the one write in the erasure that goes through the Admin API.
  client.auth = { admin: { deleteUser, getUserById } };
  return { supabase: client as never };
}

function seedErasure(userId = USER, status = "running"): string {
  const row = db.seed("operation_runs", {
    project_id: null,
    user_id: userId,
    operation_type: "account_erasure",
    input_identity: "d".repeat(64),
    status,
  });
  return String(row.id);
}

beforeEach(() => {
  db = new FakeDatabase();
  deleteProjectLifecycle.mockReset();
  cancelSubscriptionsForErasure.mockReset();
  deleteUser.mockReset().mockResolvedValue({ error: null });
  getUserById.mockReset().mockResolvedValue({ data: { user: null }, error: null });
});

describe("the owner comes from the operation row", () => {
  it("refuses an operation that is not an erasure", async () => {
    // A step is handed an operation id and nothing else. Handing it the id of
    // somebody's audit must not erase that somebody.
    const row = db.seed("operation_runs", {
      project_id: "33333333-3333-3333-3333-333333333333",
      user_id: OTHER,
      operation_type: "business_audit",
      input_identity: "e".repeat(64),
      status: "running",
    });

    expect(await admitErasureStep(deps(), String(row.id))).toEqual({
      ok: false,
      failureCode: "identity_not_found",
    });
  });

  it("refuses an operation whose owner has already gone", async () => {
    const operationId = seedErasure();
    for (const row of db.rows("operation_runs")) row.user_id = null;

    expect(await deleteIdentityStep(deps(), operationId)).toEqual({
      ok: false,
      failureCode: "identity_not_found",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("step 3 — billing is finalized, never cancelled by deletion", () => {
  it("refuses while a reservation is still active", async () => {
    const operationId = seedErasure();
    const account = db.seed("billing_credit_accounts", { user_id: USER });
    db.seed("billing_credit_reservations", { credit_account_id: account.id, status: "active" });

    expect(await admitErasureStep(deps(), operationId)).toEqual({
      ok: false,
      failureCode: "billing_not_finalized",
    });
  });

  it("does not release or settle the hold it refused on", async () => {
    // ADR 0056 §10. That authority belongs to the CAS-gated finalizers, and
    // moving it would risk the `charge_without_hold` class four sprints of
    // billing work went into eliminating.
    const operationId = seedErasure();
    const account = db.seed("billing_credit_accounts", { user_id: USER });
    db.seed("billing_credit_reservations", { credit_account_id: account.id, status: "active" });

    await admitErasureStep(deps(), operationId);

    expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
  });

  it("proceeds once every reservation is terminal", async () => {
    const operationId = seedErasure();
    const account = db.seed("billing_credit_accounts", { user_id: USER });
    db.seed("billing_credit_reservations", { credit_account_id: account.id, status: "settled" });

    expect(await admitErasureStep(deps(), operationId)).toEqual({ ok: true });
  });

  it("proceeds for an account that never had a wallet", async () => {
    expect(await admitErasureStep(deps(), seedErasure())).toEqual({ ok: true });
  });
});

describe("step 2 — the external effect stops the erasure", () => {
  it("fails the erasure when Stripe cannot be cancelled", async () => {
    cancelSubscriptionsForErasure.mockResolvedValue({ ok: false, reason: "stripe_cancel_failed" });

    expect(await cancelSubscriptionStep(deps(), seedErasure())).toEqual({
      ok: false,
      failureCode: "stripe_cancel_failed",
    });
  });

  it("passes the owner from the row, not from a caller", async () => {
    cancelSubscriptionsForErasure.mockResolvedValue({ ok: true, cancelled: 1 });

    await cancelSubscriptionStep(deps(), seedErasure());

    expect(cancelSubscriptionsForErasure).toHaveBeenCalledWith(expect.anything(), USER);
  });
});

describe("step 4 — every project, through the one deletion machine", () => {
  it("deletes each owned project and counts them", async () => {
    const operationId = seedErasure();
    db.seed("projects", { user_id: USER, name: "a", created_at: "2026-01-01T00:00:00Z" });
    db.seed("projects", { user_id: USER, name: "b", created_at: "2026-01-02T00:00:00Z" });
    db.seed("projects", { user_id: OTHER, name: "theirs", created_at: "2026-01-03T00:00:00Z" });
    deleteProjectLifecycle.mockResolvedValue({ ok: true });

    expect(await deleteProjectsStep(deps(), operationId)).toEqual({ ok: true, deletedProjects: 2 });
    // Never somebody else's, even though the fake client bypasses RLS exactly
    // as the service-role client does.
    for (const call of deleteProjectLifecycle.mock.calls) expect(call[0].userId).toBe(USER);
  });

  it("stops the whole erasure on the first project that cannot drain", async () => {
    const operationId = seedErasure();
    db.seed("projects", { user_id: USER, name: "a", created_at: "2026-01-01T00:00:00Z" });
    db.seed("projects", { user_id: USER, name: "b", created_at: "2026-01-02T00:00:00Z" });
    deleteProjectLifecycle.mockResolvedValue({ ok: false, reason: "agent_running" });

    expect(await deleteProjectsStep(deps(), operationId)).toEqual({
      ok: false,
      failureCode: "project_deletion_failed",
    });
    expect(deleteProjectLifecycle).toHaveBeenCalledTimes(1);
  });

  it("names the project that refused, so the failure is actionable", async () => {
    const operationId = seedErasure();
    const project = db.seed("projects", { user_id: USER, name: "a", created_at: "2026-01-01T00:00:00Z" });
    deleteProjectLifecycle.mockResolvedValue({ ok: false, reason: "merge_in_progress" });

    await deleteProjectsStep(deps(), operationId);

    expect(db.rows("audit_events")).toContainEqual(
      expect.objectContaining({
        event_type: "project.deletion_failed",
        project_id: project.id,
        metadata: expect.objectContaining({ reason: "merge_in_progress" }),
      }),
    );
  });
});

describe("steps 5 to 9 — delete what must not survive, tombstone what must", () => {
  it("deletes the identity rows and nulls the owner of everything retained", async () => {
    const operationId = seedErasure();
    db.seed("free_audit_grants", { user_id: USER });
    db.seed("github_connections", { user_id: USER });
    db.seed("github_installations", { user_id: USER });
    db.seed("billing_credit_accounts", { user_id: USER, posted_credits: 500 });
    db.seed("billing_stripe_customers", { user_id: USER, stripe_customer_id: "cus_1" });
    db.seed("billing_subscriptions", { user_id: USER, stripe_subscription_id: "sub_1" });
    db.seed("ai_usage_events", { user_id: USER, input_tokens: 11 });

    expect(await tombstoneAccountStep(deps(), operationId)).toEqual({ ok: true });

    for (const table of ["free_audit_grants", "github_connections", "github_installations"]) {
      expect(db.rows(table)).toHaveLength(0);
    }
    for (const table of [
      "billing_credit_accounts",
      "billing_stripe_customers",
      "billing_subscriptions",
      "ai_usage_events",
    ]) {
      expect(db.rows(table)).toHaveLength(1);
      expect(db.rows(table)[0].user_id).toBeNull();
    }
  });

  it("keeps the Stripe identifiers and the measurements, which is what P-3 and §7 retain them for", async () => {
    const operationId = seedErasure();
    db.seed("billing_stripe_customers", { user_id: USER, stripe_customer_id: "cus_1" });
    db.seed("ai_usage_events", { user_id: USER, input_tokens: 11 });
    db.seed("billing_credit_accounts", { user_id: USER, posted_credits: 500 });

    await tombstoneAccountStep(deps(), operationId);

    expect(db.rows("billing_stripe_customers")[0].stripe_customer_id).toBe("cus_1");
    expect(db.rows("ai_usage_events")[0].input_tokens).toBe(11);
    expect(db.rows("billing_credit_accounts")[0].posted_credits).toBe(500);
  });

  it("leaves another account's rows entirely alone", async () => {
    const operationId = seedErasure();
    db.seed("billing_credit_accounts", { user_id: OTHER, posted_credits: 90 });
    db.seed("github_installations", { user_id: OTHER });

    await tombstoneAccountStep(deps(), operationId);

    expect(db.rows("billing_credit_accounts")[0].user_id).toBe(OTHER);
    expect(db.rows("github_installations")).toHaveLength(1);
  });
});

describe("step 11 — the identity, and the operation's own outcome", () => {
  it("completes the operation with no result and records an ownerless receipt", async () => {
    const operationId = seedErasure();

    expect(await deleteIdentityStep(deps(), operationId)).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith(USER);

    expect(db.rows("operation_runs")[0]).toMatchObject({ status: "completed" });
    // An erasure's product is absence; there is no row to point at.
    expect(db.rows("operation_runs")[0].result_id ?? null).toBeNull();

    const receipt = db.rows("audit_events").find((row) => row.event_type === "account.erased");
    expect(receipt).toBeDefined();
    // Written after the delete, when there is nobody left to attribute it to.
    expect(receipt?.user_id ?? null).toBeNull();
  });

  it("verifies the deletion by reading back rather than trusting the response", async () => {
    // Rule 73. A call that reported success while the identity is still there
    // would otherwise complete the operation and write "account erased".
    getUserById.mockResolvedValue({ data: { user: { id: USER } }, error: null });

    expect(await deleteIdentityStep(deps(), seedErasure())).toEqual({
      ok: false,
      failureCode: "identity_delete_failed",
    });
    expect(db.rows("operation_runs")[0].status).toBe("running");
    expect(db.rows("audit_events")).toHaveLength(0);
  });

  it("treats an identity that is already gone as success", async () => {
    deleteUser.mockResolvedValue({ error: { status: 404, message: "not found" } });

    expect(await deleteIdentityStep(deps(), seedErasure())).toEqual({ ok: true });
  });

  it("stops on any other admin error", async () => {
    deleteUser.mockResolvedValue({ error: { status: 500, message: "boom" } });

    expect(await deleteIdentityStep(deps(), seedErasure())).toEqual({
      ok: false,
      failureCode: "identity_delete_failed",
    });
  });
});

describe("failing", () => {
  it("records the reason on the operation and in the log", async () => {
    const operationId = seedErasure();

    await failErasure(deps(), operationId, "stripe_cancel_failed");

    expect(db.rows("operation_runs")[0]).toMatchObject({
      status: "failed",
      failure_code: "stripe_cancel_failed",
    });
    expect(db.rows("audit_events")).toContainEqual(
      expect.objectContaining({
        event_type: "account.erasure_failed",
        user_id: USER,
        metadata: expect.objectContaining({ failureCode: "stripe_cancel_failed" }),
      }),
    );
  });
});

describe("re-entry", () => {
  it("converges when every step runs a second time", async () => {
    // What makes a retry after a partial erasure safe: the middle of the
    // sequence is idempotent, so re-running it reaches the same state.
    const operationId = seedErasure();
    db.seed("billing_credit_accounts", { user_id: USER, posted_credits: 500 });
    db.seed("github_installations", { user_id: USER });
    deleteProjectLifecycle.mockResolvedValue({ ok: true });
    cancelSubscriptionsForErasure.mockResolvedValue({ ok: true, cancelled: 0 });

    for (let pass = 0; pass < 2; pass += 1) {
      expect(await admitErasureStep(deps(), operationId)).toEqual({ ok: true });
      expect(await cancelSubscriptionStep(deps(), operationId)).toEqual({ ok: true });
      expect(await deleteProjectsStep(deps(), operationId)).toMatchObject({ ok: true });
      expect(await tombstoneAccountStep(deps(), operationId)).toEqual({ ok: true });
      expect(await scrubAuditStep(deps(), operationId)).toMatchObject({ ok: true });
    }

    expect(db.rows("billing_credit_accounts")).toHaveLength(1);
    expect(db.rows("billing_credit_accounts")[0].user_id).toBeNull();
    expect(db.rows("github_installations")).toHaveLength(0);
  });
});
