import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "../test-support";
import { computeErasureIdentity, startAccountErasure } from "./service";

/**
 * Starting an account erasure (ADR 0056 §4, ADR 0057).
 *
 * The properties under test are the ones a second click and a failed enqueue
 * would otherwise get wrong, and both are about state that outlives the
 * request: an account-level operation that stays `queued` with nothing carrying
 * it holds the identity index *and* keeps the start-path trigger closed, which
 * would freeze the account on a failure to enqueue.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

let db: FakeDatabase;
const supabase = () => fakeSupabase(db);

beforeEach(() => {
  db = new FakeDatabase();
});

describe("starting one", () => {
  it("creates an account-level operation and enqueues exactly one run", async () => {
    const executor = new FakeExecutor();

    const result = await startAccountErasure(supabase(), executor, { userId: USER });

    expect(result.kind).toBe("started");
    expect(executor.starts).toHaveLength(1);

    const [row] = db.rows("operation_runs");
    // Null is the subject, not a missing value: an erasure is about the
    // account (ADR 0057 §1).
    expect(row.project_id ?? null).toBeNull();
    expect(row).toMatchObject({
      user_id: USER,
      operation_type: "account_erasure",
      status: "queued",
      input_identity: computeErasureIdentity(USER),
    });
  });

  it("attaches the durable run to the operation", async () => {
    const executor = new FakeExecutor();

    await startAccountErasure(supabase(), executor, { userId: USER });

    expect(db.rows("operation_runs")[0]).toMatchObject({
      workflow_run_id: "run_1",
      execution_provider: "fake_executor",
    });
  });
});

describe("starting a second one", () => {
  it("reports the live erasure rather than starting another", async () => {
    const executor = new FakeExecutor();
    const first = await startAccountErasure(supabase(), executor, { userId: USER });

    const second = await startAccountErasure(supabase(), executor, { userId: USER });

    expect(second).toEqual({
      kind: "active",
      operationId: first.kind === "started" ? first.operationId : "",
    });
    // The property that matters is not the return value — it is that no second
    // durable run was enqueued against an identity being deleted.
    expect(executor.starts).toHaveLength(1);
    expect(db.rows("operation_runs")).toHaveLength(1);
  });

  it("does not block a different account's erasure", async () => {
    const executor = new FakeExecutor();
    await startAccountErasure(supabase(), executor, { userId: USER });

    const other = await startAccountErasure(supabase(), executor, { userId: OTHER });

    expect(other.kind).toBe("started");
    expect(executor.starts).toHaveLength(2);
  });

  it("allows a retry once the first attempt has failed", async () => {
    // A failed erasure must never lock somebody out of erasing. The index is
    // partial on the active statuses precisely so this works.
    const executor = new FakeExecutor();
    await startAccountErasure(supabase(), executor, { userId: USER });
    for (const row of db.rows("operation_runs")) {
      row.status = "failed";
      row.failure_code = "stripe_cancel_failed";
      row.completed_at = new Date().toISOString();
    }

    const retry = await startAccountErasure(supabase(), executor, { userId: USER });

    expect(retry.kind).toBe("started");
  });
});

describe("when the run cannot be enqueued", () => {
  it("fails the operation rather than leaving it queued forever", async () => {
    const executor = new FakeExecutor({ fail: true });

    const result = await startAccountErasure(supabase(), executor, { userId: USER });

    expect(result).toEqual({ kind: "blocked", reason: "erasure_start_failed" });
    expect(db.rows("operation_runs")[0]).toMatchObject({
      status: "failed",
      failure_code: "erasure_start_failed",
    });
  });

  it("leaves the account able to try again", async () => {
    // The consequence of the previous test, stated as its own property because
    // it is the one a user would feel: a queued row would hold both the
    // identity index and the start-path trigger, freezing the whole account.
    await startAccountErasure(supabase(), new FakeExecutor({ fail: true }), { userId: USER });

    const retry = await startAccountErasure(supabase(), new FakeExecutor(), { userId: USER });

    expect(retry.kind).toBe("started");
  });
});

describe("the identity", () => {
  it("is stable per account and different between accounts", () => {
    expect(computeErasureIdentity(USER)).toBe(computeErasureIdentity(USER));
    expect(computeErasureIdentity(USER)).not.toBe(computeErasureIdentity(OTHER));
    expect(computeErasureIdentity(USER)).toHaveLength(64);
  });
});
