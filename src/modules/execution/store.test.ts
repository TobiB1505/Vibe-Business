import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { markPreparedChangeFailed, markPreparedChangePrepared } from "./store";

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
