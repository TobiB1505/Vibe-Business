import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { readLatestPerPreparedChange } from "./latest-per-change";

/**
 * The batched read has one property worth proving and one worth proving twice.
 *
 * The first: it answers the same question the six per-change reads answered.
 * The second: it answers it *exactly*, including when its row budget is spent
 * — which is the case a reader would otherwise have to take on trust, because
 * it cannot be reached with realistic data.
 */

const PROJECT = "project_1";
const OTHER = "project_2";
const COLUMNS = "id, project_id, prepared_change_id, status, created_at";

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function seed(changeId: string, status: string, day: number, projectId = PROJECT) {
  db.seed("validation_runs", {
    id: `${changeId}_${status}_${day}`,
    project_id: projectId,
    prepared_change_id: changeId,
    status,
    created_at: new Date(Date.UTC(2026, 0, day)).toISOString(),
  });
}

async function read(ids: string[], rowBudget?: number) {
  return readLatestPerPreparedChange(client(), {
    table: "validation_runs",
    columns: COLUMNS,
    projectId: PROJECT,
    preparedChangeIds: ids,
    rowBudget,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
});

describe("the newest row per prepared change", () => {
  it("returns each change's newest row in one query", async () => {
    seed("change_a", "failed", 1);
    seed("change_a", "passed", 5);
    seed("change_b", "running", 3);

    const latest = await read(["change_a", "change_b"]);

    expect(latest.get("change_a")?.status).toBe("passed");
    expect(latest.get("change_b")?.status).toBe("running");
    expect(recorder.reads).toEqual(["validation_runs"]);
  });

  it("omits a change with no rows rather than mapping it to null", async () => {
    seed("change_a", "passed", 1);

    const latest = await read(["change_a", "change_b"]);

    expect(latest.has("change_b")).toBe(false);
    expect(latest.get("change_b") ?? null).toBeNull();
  });

  it("never returns another project's row", async () => {
    seed("change_a", "passed", 9, OTHER);

    const latest = await read(["change_a"]);

    expect(latest.size).toBe(0);
  });

  it("asks nothing when there are no changes", async () => {
    const latest = await read([]);

    expect(latest.size).toBe(0);
    expect(recorder.reads).toEqual([]);
  });

  it("does not ask twice for a repeated id", async () => {
    seed("change_a", "passed", 1);

    const latest = await read(["change_a", "change_a"]);

    expect(latest.size).toBe(1);
    expect(recorder.reads).toEqual(["validation_runs"]);
  });
});

describe("when the row budget is spent", () => {
  /*
   * The budget cannot be reached with realistic data, which is exactly why it
   * is driven directly here. A truncated batch must never answer *wrongly* —
   * only incompletely — and the incompleteness must be repaired rather than
   * returned.
   */

  it("still gives the newest row for every change it saw", async () => {
    // change_a monopolises the budget with the four newest rows.
    seed("change_a", "failed", 10);
    seed("change_a", "failed", 11);
    seed("change_a", "passed", 12);
    seed("change_b", "running", 1);

    const latest = await read(["change_a", "change_b"], 3);

    expect(latest.get("change_a")?.status).toBe("passed");
  });

  it("re-reads only the changes the budget hid", async () => {
    seed("change_a", "failed", 10);
    seed("change_a", "failed", 11);
    seed("change_a", "passed", 12);
    seed("change_b", "running", 1);

    const latest = await read(["change_a", "change_b"], 3);

    expect(latest.get("change_b")?.status).toBe("running");
    // One batch, then one repair for the single change it could not see.
    expect(recorder.reads).toEqual(["validation_runs", "validation_runs"]);
  });

  it("repairs nothing when a full response happened to cover every change", async () => {
    seed("change_a", "passed", 2);
    seed("change_b", "running", 1);

    const latest = await read(["change_a", "change_b"], 2);

    expect(latest.size).toBe(2);
    expect(recorder.reads).toEqual(["validation_runs"]);
  });
});
