import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { markAgentRunStarted } from "./store";

/**
 * `markAgentRunStarted` is the paid-call CAS. It accepts only a fresh queued
 * attempt; founder-input resolution must create a new run rather than revive
 * the historical one.
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

  it("refuses to revive a run that is waiting for founder input", async () => {
    const run = seedRun("needs_user_input", { started_at: "2020-01-01T00:00:00.000Z" });

    const claimed = await markAgentRunStarted(fakeSupabase(db), String(run.id));

    expect(claimed).toBe(false);
    const row = db.rows("agent_execution_runs")[0];
    expect(row.status).toBe("needs_user_input");
    expect(row.started_at).toBe("2020-01-01T00:00:00.000Z");
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
    const run = seedRun("queued");
    const supabase = fakeSupabase(db);

    const [first, second] = await Promise.all([
      markAgentRunStarted(supabase, String(run.id)),
      markAgentRunStarted(supabase, String(run.id)),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(db.rows("agent_execution_runs")[0].status).toBe("running");
  });
});
