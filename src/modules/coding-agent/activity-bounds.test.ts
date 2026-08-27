import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { listAgentActivity } from "./store";

/**
 * VB-025 — the activity log is bounded, and bounded from the right end.
 *
 * An agent run can emit thousands of activity rows and this read had no limit.
 * The subtle half is the direction: the rows are ordered by sequence because a
 * log is read forwards, and a cap on an ascending order keeps the *first* N —
 * which hides how the run ended, the part anyone opening this is looking for.
 *
 * So the query takes the newest and the order is restored afterwards. Both
 * halves are asserted, because a rewrite that drops the reverse leaves a log
 * that reads backwards and still passes a naive "is it capped" test.
 */

const RUN = "run_1";
const PROJECT = "project_1";

/**
 * Sequences start at 1000 deliberately. `FakeDatabase` orders lexicographically
 * — production's `sequence` is an integer and PostgreSQL orders it numerically
 * — and with a range like 0..899 the two disagree (`"99" > "899"`). Starting
 * above 1000 makes every value the same width, so string and numeric order
 * agree and the assertion is about this code's direction rather than about a
 * quirk of the fake.
 */
const FIRST_SEQUENCE = 1000;

function seed(db: FakeDatabase, count: number) {
  for (let i = 0; i < count; i += 1) {
    db.seed("agent_activity_events", {
      agent_execution_run_id: RUN,
      project_id: PROJECT,
      sequence: FIRST_SEQUENCE + i,
      event: "file_read",
      occurred_at: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
      files_read: i,
      changed_paths: null,
      command: null,
    });
  }
}

describe("a long run", () => {
  it("returns at most the cap", async () => {
    const db = new FakeDatabase();
    seed(db, 900);

    const activity = await listAgentActivity(fakeSupabase(db), { runId: RUN, projectId: PROJECT });

    expect(activity).toHaveLength(500);
  });

  /**
   * The direction. Capping an ascending read would have returned rows 0–499
   * and thrown away the end of the run.
   */
  it("keeps the end of the run, not the beginning", async () => {
    const db = new FakeDatabase();
    seed(db, 900);

    const activity = await listAgentActivity(fakeSupabase(db), { runId: RUN, projectId: PROJECT });

    expect(activity[activity.length - 1]?.filesRead).toBe(899);
    expect(activity[0]?.filesRead).toBe(400);
  });

  it("hands them back oldest-first, the way a log reads", async () => {
    const db = new FakeDatabase();
    seed(db, 900);

    const activity = await listAgentActivity(fakeSupabase(db), { runId: RUN, projectId: PROJECT });
    const order = activity.map((entry) => entry.filesRead ?? -1);

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("a short run", () => {
  it("is unaffected, in its natural order", async () => {
    const db = new FakeDatabase();
    seed(db, 3);

    const activity = await listAgentActivity(fakeSupabase(db), { runId: RUN, projectId: PROJECT });

    expect(activity.map((entry) => entry.filesRead)).toEqual([0, 1, 2]);
  });
});
