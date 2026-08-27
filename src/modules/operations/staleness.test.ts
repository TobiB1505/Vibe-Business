import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { FakeDatabase, fakeSupabase } from "./test-support";

/**
 * ADR 0042 §P2 — the backstop for a durable operation nothing is carrying any
 * more, generalizing `expireStaleAgentExecution`'s already-proven shape
 * (`agent-execution/lifecycle.test.ts`).
 *
 * VB-014 widened it from three families to every family but one. The tests
 * below that assert a *non*-action are therefore the load-bearing ones: after
 * the widening, the interesting question is no longer "does it fire" but "does
 * it fire on something still working".
 */

const USER = "user_1";
const PROJECT = "project_1";

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** A `running` operation, `minutesAgo` old, with a funded active hold. */
function stale(operationType: string, minutesAgo: number) {
  db.seed("projects", { id: PROJECT, user_id: USER });

  const startedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const operation = db.seed("operation_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_type: operationType,
    status: "running",
    stage: "running_ai",
    input_identity: `identity-${operationType}`,
    started_at: startedAt,
    created_at: startedAt,
  });

  db.seed("billing_credit_accounts", {
    id: "account-1",
    user_id: USER,
    status: "active",
    posted_credits: creditsToUnits(1_000),
    reserved_credits: creditsToUnits(35),
  });

  db.seed("billing_credit_reservations", {
    id: "reservation-1",
    credit_account_id: "account-1",
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: operation.id,
    status: "active",
    reserved_credits: creditsToUnits(35),
    created_at: startedAt,
    // Matches Sprint B0's phase-aware backfill for a pre-existing active
    // reservation — see the identical comment in agent-execution's own
    // lifecycle.test.ts, which this file's fixture mirrors.
    admitted_at: startedAt,
  });

  return { operation: { id: String(operation.id) } };
}

async function importStaleness() {
  vi.resetModules();
  vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase(db) }));
  return import("./staleness");
}

describe("an operation nothing is carrying any more", () => {
  it.each(["business_audit", "opportunity_generation", "action_planning"])(
    "fails a %s operation and releases its Credits once it is past its deadline",
    async (operationType) => {
      const { operation } = stale(operationType, 60);
      const { expireStaleOperation } = await importStaleness();

      expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: true });

      expect(db.rows("operation_runs")[0]).toMatchObject({
        status: "failed",
        failure_code: "operation_wall_clock_exceeded",
      });
      expect(db.rows("billing_credit_reservations")[0].status).toBe("released");
    },
  );

  it.each(["business_audit", "opportunity_generation", "action_planning"])(
    "leaves a %s operation that is still inside its bound alone",
    async (operationType) => {
      const { operation } = stale(operationType, 1);
      const { expireStaleOperation } = await importStaleness();

      expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: false });

      expect(db.rows("operation_runs")[0].status).toBe("running");
      expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
    },
  );

  it("repairs once however many times it is asked", async () => {
    const { operation } = stale("business_audit", 60);
    const { expireStaleOperation } = await importStaleness();

    await expireStaleOperation({ operationId: operation.id });
    const second = await expireStaleOperation({ operationId: operation.id });

    expect(second).toEqual({ expired: false });
    expect(db.rows("billing_credit_reservations")[0].status).toBe("released");
    expect(db.rows("billing_credit_accounts")[0].reserved_credits).toBe(0);
  });

  it("never touches a queued operation, which may simply not have started", async () => {
    const { operation } = stale("business_audit", 60);
    db.rows("operation_runs")[0].status = "queued";
    const { expireStaleOperation } = await importStaleness();

    expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: false });
    expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
  });

  /**
   * `needs_user` is never a staleness question (ADR 0042 §P2) — its Credits
   * are released at the moment of pause, not swept later, however long it
   * waits. Age alone must never trigger this path for it.
   */
  it("never touches a needs_user operation, regardless of age", async () => {
    const { operation } = stale("business_audit", 60 * 24 * 30);
    db.rows("operation_runs")[0].status = "needs_user";
    const { expireStaleOperation } = await importStaleness();

    expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: false });
    expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
  });

  /**
   * `agent_execution` has its own, more precise mechanism
   * (`expireStaleAgentExecution`, keyed off `agent_execution_runs.started_at`)
   * — this one must stay out of its way entirely rather than double-acting on
   * the same operation.
   */
  it("never touches an agent_execution operation — that family has its own mechanism", async () => {
    const { operation } = stale("agent_execution", 60);
    const { expireStaleOperation } = await importStaleness();

    expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: false });
    expect(db.rows("operation_runs")[0].status).toBe("running");
    expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
  });

});

describe("the families VB-014 added", () => {
  /**
   * This is the finding. Every one of these could be started, have its workflow
   * die, and leave `operation_runs` holding the partial unique index on the
   * active state — so the customer could never start that work again, with the
   * screen still showing a spinner and nothing anywhere saying why.
   *
   * The old assertion here said the opposite ("never touches a never-billed
   * operation type, like product_understanding"). It pinned the narrower
   * behaviour deliberately and correctly at the time; it is replaced rather
   * than deleted, because the behaviour it described is the defect.
   */
  it.each([
    "product_understanding",
    "product_scan",
    "change_preparation",
    "change_merge",
    "preview_teardown",
    "change_outcome_verification",
    "business_measurement",
    "change_review",
  ])("fails a long-dead %s", async (operationType) => {
    const { operation } = stale(operationType, 60);
    const { expireStaleOperation } = await importStaleness();

    expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: true });
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });

  /**
   * The three whose deadline is derived from a real ceiling elsewhere — the
   * sandbox's leak bound, the preview's TTL, the review session's timeout.
   * They are given far more room than the flat backstop, and that is the
   * assertion: at ten minutes a validation is still inside its own bound while
   * the families above have long since expired.
   */
  it.each(["change_validation", "change_preview"])(
    "leaves a %s alone at ten minutes, because its own ceiling is longer",
    async (operationType) => {
      const { operation } = stale(operationType, 10);
      const { expireStaleOperation } = await importStaleness();

      expect(await expireStaleOperation({ operationId: operation.id })).toEqual({
        expired: false,
      });
      expect(db.rows("operation_runs")[0].status).toBe("running");
    },
  );
});

describe("an account-level operation", () => {
  /**
   * The gap VB-014 exposed that the finding did not name, because the operation
   * type postdates it. `getProjectOperationRunById` refuses a row whose
   * `project_id` is null — which is exactly and only the account-level
   * operations — so erasure, the one family where being wedged means a person
   * cannot delete their account, was the one family this sweep could not see.
   */
  function staleErasure(minutesAgo: number) {
    const startedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const operation = db.seed("operation_runs", {
      project_id: null,
      user_id: USER,
      operation_type: "account_erasure",
      status: "running",
      stage: "running_ai",
      input_identity: "identity-erasure",
      started_at: startedAt,
      created_at: startedAt,
    });
    return { id: String(operation.id) };
  }

  it("is swept even though it belongs to no project", async () => {
    const operation = staleErasure(120);
    const { expireStaleOperation } = await importStaleness();

    expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: true });
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });

  it("is left alone while it is plausibly still walking the cascade", async () => {
    const operation = staleErasure(10);
    const { expireStaleOperation } = await importStaleness();

    expect(await expireStaleOperation({ operationId: operation.id })).toEqual({ expired: false });
    expect(db.rows("operation_runs")[0].status).toBe("running");
  });
});
