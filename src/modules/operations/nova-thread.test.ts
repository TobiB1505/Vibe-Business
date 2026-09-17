import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "./test-support";
import { completeOperationRun, failOperationRun } from "./store";
import { THREAD_EVENT_WORDS } from "../nova/threads/schema";

/**
 * A run that ended leaves a memory, and the run never depends on it.
 *
 * ## Why this is asserted through the store rather than the tail
 *
 * Because the claim is *"every terminal transition leaves one"*, and the tail
 * proves only that a function called directly does what it says. There are
 * ninety call sites of these two transitions across twenty-three files; what
 * makes a founder's thread complete is that the message is written where the
 * transition is rather than at each of them, and that is a property of
 * `completeOperationRun` and `failOperationRun`.
 */

const PROJECT = "project_1";
const USER = "user_1";

function database(overrides: Record<string, unknown> = {}) {
  const db = new FakeDatabase();
  /*
   * The thread's owner comes from the project row, never from the caller
   * (`open_nova_thread` selects it). A run always has one; seeding it is the
   * precondition, not a convenience.
   */
  db.rows("projects").push({ id: PROJECT, user_id: USER, name: "race" });
  db.rows("operation_runs").push({
    id: "op_1",
    project_id: PROJECT,
    user_id: USER,
    operation_type: "business_audit",
    status: "running",
    stage: "running_ai",
    ...overrides,
  });
  return db;
}

describe("a run that ends leaves a memory", () => {
  it("opens the project's thread and records the run that finished", async () => {
    const db = database();

    expect(
      await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" }),
    ).toBe(true);

    const threads = db.rows("nova_threads");
    expect(threads).toHaveLength(1);
    expect(threads[0].project_id).toBe(PROJECT);

    const messages = db.rows("nova_messages");
    expect(messages).toHaveLength(1);
    expect(messages[0].author).toBe("system");
    expect(messages[0].kind).toBe("event");
    expect(messages[0].operation_run_id).toBe("op_1");
    // The sentence is composed on read. A stored one would freeze today's
    // wording into a row that outlives it.
    expect(messages[0].body).toBeNull();
    expect(THREAD_EVENT_WORDS.business_audit).not.toBeNull();
  });

  it("records a run that did not finish, too", async () => {
    const db = database();

    expect(
      await failOperationRun(fakeSupabase(db), {
        operationId: "op_1",
        failureCode: "provider_failed",
      }),
    ).toBe(true);

    expect(db.rows("nova_messages")).toHaveLength(1);
  });

  it("writes one message per run, not one per replay", async () => {
    const db = database();

    await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" });
    // A replayed workflow step. The transition already happened, so the
    // update matches nothing and there is nothing new to remember.
    expect(
      await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" }),
    ).toBe(false);

    expect(db.rows("nova_messages")).toHaveLength(1);
  });

  it("reuses the thread a project already has", async () => {
    const db = database();
    db.rows("operation_runs").push({
      id: "op_2",
      project_id: PROJECT,
      user_id: USER,
      operation_type: "product_scan",
      status: "running",
      stage: "running_ai",
    });

    await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" });
    await completeOperationRun(fakeSupabase(db), { operationId: "op_2", resultId: "r_2" });

    expect(db.rows("nova_threads")).toHaveLength(1);
    expect(db.rows("nova_messages").map((row) => row.sequence)).toEqual([1, 2]);
  });

  /**
   * Machinery a founder has no reason to remember. `THREAD_EVENT_WORDS` says
   * so, and this is where that decision reaches the database.
   */
  it("remembers nothing about a preview being torn down", async () => {
    const db = database({ operation_type: "preview_teardown" });

    await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" });

    expect(db.rows("nova_threads")).toHaveLength(0);
    expect(db.rows("nova_messages")).toHaveLength(0);
  });

  /**
   * An erased owner. `operation_runs.user_id` goes null when an account is
   * tombstoned (ADR 0057 §2), and a thread has an owner by definition — there
   * is nobody left for this to be a memory for.
   */
  it("remembers nothing for an operation whose owner has been erased", async () => {
    const db = database({ user_id: null });

    await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" });

    expect(db.rows("nova_threads")).toHaveLength(0);
    expect(db.rows("nova_messages")).toHaveLength(0);
  });

  it("remembers nothing about an operation with no project", async () => {
    const db = database({ project_id: null, operation_type: "account_erasure" });

    await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: null });

    expect(db.rows("nova_threads")).toHaveLength(0);
  });

  /**
   * The standing `speakAfterOperation` has, for the same reason: a
   * conversation entry is never worth failing a run that already succeeded
   * over. A thread with a gap is a worse product; a merge marked failed
   * because a message could not be written is a worse incident.
   */
  it("still completes the run when the thread cannot be written", async () => {
    const db = database();
    db.failNextWriteWith = { table: "nova_threads", message: "nope" };

    expect(
      await completeOperationRun(fakeSupabase(db), { operationId: "op_1", resultId: "r_1" }),
    ).toBe(true);
    expect(db.rows("operation_runs")[0].status).toBe("completed");
    expect(db.rows("nova_messages")).toHaveLength(0);
  });
});
