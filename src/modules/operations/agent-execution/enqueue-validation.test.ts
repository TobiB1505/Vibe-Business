import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "../test-support";

/**
 * The automatic validation trigger (Sprint 0048).
 *
 * ## What is asserted, and what deliberately is not
 *
 * Asserted: that the step calls the **existing** entry point with ownership
 * taken from the persisted run row, that it survives every failure mode
 * without propagating one, and that it records what happened either way.
 *
 * Not asserted: any guard inside `startChangeValidation`. Reuse, in-flight
 * detection, profile support, depth and the unique index are that function's
 * own tests, and re-asserting them here would only prove this file can mock
 * them. The point of the design is that there is nothing new to test.
 */

const startChangeValidation = vi.fn();

vi.mock("@/modules/validation/service", () => ({
  startChangeValidation: (...args: unknown[]) => startChangeValidation(...args),
}));

const { enqueueValidationStep } = await import("./execution");

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OPERATION = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const PREPARED = "55555555-5555-4555-8555-555555555555";

const executor = { name: "fake", start: vi.fn() };

function seed(db: FakeDatabase, overrides: Record<string, unknown> = {}) {
  db.seed("agent_execution_runs", {
    id: RUN,
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: OPERATION,
    prepared_change_id: PREPARED,
    status: "succeeded",
    ...overrides,
  });
}

function deps(db: FakeDatabase) {
  return { supabase: fakeSupabase(db) } as unknown as Parameters<typeof enqueueValidationStep>[0];
}

describe("enqueueValidationStep", () => {
  beforeEach(() => {
    startChangeValidation.mockReset();
    startChangeValidation.mockResolvedValue({ kind: "started", operation: {} });
  });

  it("calls the existing entry point with ownership from the persisted row", async () => {
    const db = new FakeDatabase();
    seed(db);

    await enqueueValidationStep(deps(db), executor, OPERATION);

    expect(startChangeValidation).toHaveBeenCalledTimes(1);
    // The third argument is the params object. Project and user come from the
    // run row, never from an argument — this step runs under the service-role
    // client, which bypasses RLS (Rule 53).
    expect(startChangeValidation.mock.calls[0][2]).toEqual({
      projectId: PROJECT,
      userId: USER,
      preparedChangeId: PREPARED,
    });
  });

  it("records the outcome as an audit event", async () => {
    const db = new FakeDatabase();
    seed(db);

    await enqueueValidationStep(deps(db), executor, OPERATION);

    const events = db.rows("audit_events");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("agent_execution.validation_enqueued");
    expect((events[0].metadata as { outcome: string }).outcome).toBe("started");
  });

  it("does nothing at all when the run prepared no change", async () => {
    const db = new FakeDatabase();
    seed(db, { prepared_change_id: null });

    await enqueueValidationStep(deps(db), executor, OPERATION);

    expect(startChangeValidation).not.toHaveBeenCalled();
    expect(db.rows("audit_events")).toHaveLength(0);
  });

  it("does nothing when no agent run exists for the operation", async () => {
    const db = new FakeDatabase();

    await enqueueValidationStep(deps(db), executor, OPERATION);

    expect(startChangeValidation).not.toHaveBeenCalled();
  });

  /**
   * The important one. By the time this step runs the branch is written, the
   * prepared change exists and the credits are settled. A validation that
   * refuses to start leaves exactly the state this workflow produced before
   * Sprint 0048 — a change waiting for a click — and must never turn a finished
   * execution into a failed one.
   */
  it("does not throw when validation refuses to start, and records why", async () => {
    const db = new FakeDatabase();
    seed(db);
    startChangeValidation.mockResolvedValue({ kind: "failed", error: "validation_not_supported" });

    await expect(enqueueValidationStep(deps(db), executor, OPERATION)).resolves.toBeUndefined();

    const metadata = db.rows("audit_events")[0].metadata as { outcome: string; detail: string };
    expect(metadata.outcome).toBe("failed");
    expect(metadata.detail).toBe("validation_not_supported");
  });

  it("does not throw when the call itself explodes", async () => {
    const db = new FakeDatabase();
    seed(db);
    startChangeValidation.mockRejectedValue(new Error("provider exploded"));

    await expect(enqueueValidationStep(deps(db), executor, OPERATION)).resolves.toBeUndefined();

    const metadata = db.rows("audit_events")[0].metadata as { outcome: string; detail: string };
    expect(metadata.outcome).toBe("failed");
    expect(metadata.detail).toBe("execution_start_failed");
  });

  it("records a reused verdict as itself, not as a start", async () => {
    // Proof that the existing identity guard is what makes a second call safe:
    // this step does nothing to prevent one, because it does not need to.
    const db = new FakeDatabase();
    seed(db);
    startChangeValidation.mockResolvedValue({ kind: "reused", validationRunId: "x", status: "passed" });

    await enqueueValidationStep(deps(db), executor, OPERATION);

    expect((db.rows("audit_events")[0].metadata as { outcome: string }).outcome).toBe("reused");
  });

  it("never records the user's own identifiers beyond the ids it was given", async () => {
    const db = new FakeDatabase();
    seed(db);

    await enqueueValidationStep(deps(db), executor, OPERATION);

    const metadata = db.rows("audit_events")[0].metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual([
      "agentExecutionRunId",
      "operationId",
      "outcome",
      "preparedChangeId",
      "projectId",
    ]);
  });
});
