import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { markAgentRunStarted, updateAgentRunCreditReservation } from "./store";

/**
 * `markAgentRunStarted`'s CAS, and the pointer a resume re-acquire updates
 * (ADR 0041 §P2).
 *
 * Both are exercised end-to-end through `startAgentStep` in
 * `operations/agent-execution/execution.test.ts`; this file isolates the two
 * primitives themselves — the CAS guard's exact boundary, and the fact that a
 * lost race still leaves exactly one winner.
 */

let db: FakeDatabase;

function seedRun(status: string, overrides: Record<string, unknown> = {}) {
  return db.seed("agent_execution_runs", {
    project_id: "project_1",
    user_id: "user_1",
    operation_run_id: "operation_1",
    status,
    started_at: "2026-08-18T00:00:00.000Z",
    credit_reservation_id: null,
    ...overrides,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("markAgentRunStarted", () => {
  it("wins from queued and stamps started_at", async () => {
    const run = seedRun("queued", { started_at: null });

    const claimed = await markAgentRunStarted(fakeSupabase(db), String(run.id));

    expect(claimed).toBe(true);
    const row = db.rows("agent_execution_runs")[0];
    expect(row.status).toBe("running");
    expect(row.started_at).not.toBeNull();
  });

  /**
   * The widened half of the guard (ADR 0041 §P2): a resumed run re-enters
   * from `needs_user_input`, not `queued`, and must both win the CAS and get
   * a fresh `started_at` — the original timestamp could already be past
   * `expireStaleAgentExecution`'s deadline by the time a customer answers.
   */
  it("wins from needs_user_input and re-stamps started_at", async () => {
    const run = seedRun("needs_user_input", { started_at: "2020-01-01T00:00:00.000Z" });

    const claimed = await markAgentRunStarted(fakeSupabase(db), String(run.id));

    expect(claimed).toBe(true);
    const row = db.rows("agent_execution_runs")[0];
    expect(row.status).toBe("running");
    expect(row.started_at).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it.each(["running", "succeeded", "failed", "cancelled"])(
    "refuses from %s",
    async (status) => {
      const run = seedRun(status);

      const claimed = await markAgentRunStarted(fakeSupabase(db), String(run.id));

      expect(claimed).toBe(false);
      expect(db.rows("agent_execution_runs")[0].status).toBe(status);
    },
  );

  it("lets only one of two concurrent callers win", async () => {
    const run = seedRun("needs_user_input");
    const supabase = fakeSupabase(db);

    const [first, second] = await Promise.all([
      markAgentRunStarted(supabase, String(run.id)),
      markAgentRunStarted(supabase, String(run.id)),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(db.rows("agent_execution_runs")[0].status).toBe("running");
  });
});

describe("updateAgentRunCreditReservation", () => {
  it("points the run at a freshly re-acquired reservation", async () => {
    const run = seedRun("running", { credit_reservation_id: "reservation-released" });

    await updateAgentRunCreditReservation(fakeSupabase(db), String(run.id), "reservation-fresh");

    expect(db.rows("agent_execution_runs")[0].credit_reservation_id).toBe("reservation-fresh");
  });
});
