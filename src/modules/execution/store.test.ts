import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import {
  listPreparedChangesForProject,
  markPreparedChangeFailed,
  markPreparedChangePrepared,
} from "./store";

/**
 * Prepared-change lifecycle transitions (Sprint 9B §3, §26).
 *
 * A successful prepared change is immutable. The transitions are scoped to
 * `preparing` so a replayed persistence step reports that it did nothing,
 * rather than silently rewriting a finished result with a second commit —
 * which is how a "prepared" row could end up pointing at a branch the user
 * never reviewed.
 */

let db: FakeDatabase;

function seedPreparing(id = "prepared_1") {
  db.seed("prepared_changes", {
    id,
    project_id: "project_1",
    status: "preparing",
    branch_name: "vibe/seo-foundations-abc",
    execution_identity: "e".repeat(64),
    files: [],
    // A generator-produced change names its capability and the opportunity it
    // was prepared for. Both were always required by the schema; they became
    // load-bearing in the fixture when EXECUTION CORE-4 made the opportunity
    // columns nullable *only* for an agentic change, so a row omitting them
    // now has to say which kind it is.
    execution_capability: "nextjs_seo_foundations_v2",
    execution_version: "nextjs-seo-foundations-v2",
    opportunity_set_id: "set_1",
    opportunity_id: "opportunity_1",
    created_at: "2026-08-04T00:00:00.000Z",
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  seedPreparing();
});

describe("markPreparedChangePrepared", () => {
  it("reports the transition it performed", async () => {
    const done = await markPreparedChangePrepared(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      commitSha: "commit_1",
      files: [{ path: "src/app/robots.ts", contentHash: "h", bytes: 10 }],
    });

    expect(done).toBe(true);
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
    expect(db.rows("prepared_changes")[0].commit_sha).toBe("commit_1");
  });

  it("reports false on replay and does not rewrite the commit", async () => {
    // The guarantee: a second persistence attempt is a no-op, so a caller
    // that emits a completion event only when this returns true emits one.
    await markPreparedChangePrepared(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      commitSha: "commit_1",
      files: [],
    });

    const replay = await markPreparedChangePrepared(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      commitSha: "a-different-commit",
      files: [],
    });

    expect(replay).toBe(false);
    expect(db.rows("prepared_changes")[0].commit_sha).toBe("commit_1");
  });

  it("cannot resurrect a failed preparation", async () => {
    await markPreparedChangeFailed(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      failureCode: "branch_conflict",
    });

    const late = await markPreparedChangePrepared(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      commitSha: "commit_late",
      files: [],
    });

    expect(late).toBe(false);
    expect(db.rows("prepared_changes")[0].status).toBe("failed");
  });
});

describe("markPreparedChangeFailed", () => {
  it("reports false when the change already finished", async () => {
    await markPreparedChangePrepared(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      commitSha: "commit_1",
      files: [],
    });

    const failed = await markPreparedChangeFailed(fakeSupabase(db), {
      preparedChangeId: "prepared_1",
      failureCode: "github_unavailable",
    });

    expect(failed).toBe(false);
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
  });
});

describe("listPreparedChangesForProject (Sprint 10A §44)", () => {
  /**
   * The regression this exists for: a prepared change was only reachable via
   * the current opportunity set, so regenerating opportunities made an
   * existing branch disappear from the UI while it sat untouched in the
   * repository. An artifact must stay reachable regardless of current advice.
   */
  function seeded() {
    const db = new FakeDatabase();
    const base = {
      project_id: "project_1",
      user_id: "user_1",
      operation_run_id: "operation_1",
      execution_capability: "nextjs_seo_foundations_v1",
      execution_version: "nextjs-seo-foundations-v1",
      repository_snapshot_id: "snapshot_1",
      base_branch: "main",
      base_sha: "528d372",
      files: [{ path: "src/app/robots.ts", contentHash: "a".repeat(64), bytes: 408 }],
      execution_identity: "b".repeat(64),
    };

    db.seed("prepared_changes", {
      ...base,
      id: "prepared_old_set",
      opportunity_set_id: "set_superseded",
      opportunity_id: "opportunity_gone",
      branch_name: "vibe/seo-foundations-cc32273131c5",
      commit_sha: "2f05958",
      status: "prepared",
      created_at: "2026-08-12T13:00:00.000Z",
    });
    db.seed("prepared_changes", {
      ...base,
      id: "prepared_failed",
      opportunity_set_id: "set_superseded",
      opportunity_id: "opportunity_gone",
      branch_name: "vibe/failed",
      commit_sha: null,
      status: "failed",
      created_at: "2026-08-12T14:00:00.000Z",
    });
    db.seed("prepared_changes", {
      ...base,
      id: "prepared_other_project",
      project_id: "project_2",
      opportunity_set_id: "set_x",
      opportunity_id: "opportunity_x",
      branch_name: "vibe/other",
      commit_sha: "abc1234",
      status: "prepared",
      created_at: "2026-08-12T15:00:00.000Z",
    });

    return fakeSupabase(db);
  }

  it("returns a prepared change whose opportunity set has been superseded", async () => {
    const changes = await listPreparedChangesForProject(seeded(), "project_1");

    expect(changes.map((change) => change.id)).toEqual(["prepared_old_set"]);
    expect(changes[0].branchName).toBe("vibe/seo-foundations-cc32273131c5");
  });

  it("omits changes that never completed", async () => {
    const changes = await listPreparedChangesForProject(seeded(), "project_1");

    expect(changes.some((change) => change.id === "prepared_failed")).toBe(false);
  });

  it("never returns another project's changes", async () => {
    const changes = await listPreparedChangesForProject(seeded(), "project_1");

    expect(changes.some((change) => change.id === "prepared_other_project")).toBe(false);
  });
});
