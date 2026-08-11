import { describe, expect, it } from "vitest";
import { getLatestSuccessfulAuthenticatedSnapshot } from "./store";
import { FakeDatabase, fakeSupabase } from "./test-support";

/**
 * Which Deep Scan snapshot the Business Audit is allowed to see
 * (Sprint 6 §6, §13).
 *
 * This query is the whole enforcement of "latest successful only". A failed or
 * in-flight scan holds partial or absent structure, and feeding that to the
 * audit would present an aborted crawl as evidence that a product lacks
 * features it actually has.
 */

const TABLE = "authenticated_product_intelligence_snapshots";

function seedSnapshot(
  db: FakeDatabase,
  params: { id: string; status: string; completedAt: string | null; result?: unknown },
) {
  db.seed(TABLE, {
    id: params.id,
    project_id: "project_1",
    session_id: null,
    origin: "https://app.example.com",
    status: params.status,
    access_mode: "included",
    completeness: { status: "complete", reasons: [] },
    completeness_reasons: [],
    pages_inspected: 4,
    failure_code: null,
    result: params.result ?? { schemaVersion: "authenticated-product-intelligence.v1" },
    created_at: params.completedAt ?? "2026-08-01T00:00:00.000Z",
    completed_at: params.completedAt,
  });
}

describe("getLatestSuccessfulAuthenticatedSnapshot", () => {
  it("returns the most recently completed snapshot", async () => {
    const db = new FakeDatabase();
    seedSnapshot(db, { id: "older", status: "completed", completedAt: "2026-08-01T00:00:00.000Z" });
    seedSnapshot(db, { id: "newer", status: "completed", completedAt: "2026-08-09T00:00:00.000Z" });

    const snapshot = await getLatestSuccessfulAuthenticatedSnapshot(fakeSupabase(db), "project_1");

    expect(snapshot?.id).toBe("newer");
  });

  it("ignores a failed scan even when it is the most recent", async () => {
    const db = new FakeDatabase();
    seedSnapshot(db, { id: "good", status: "completed", completedAt: "2026-08-01T00:00:00.000Z" });
    seedSnapshot(db, { id: "failed", status: "failed", completedAt: "2026-08-09T00:00:00.000Z" });

    const snapshot = await getLatestSuccessfulAuthenticatedSnapshot(fakeSupabase(db), "project_1");

    expect(snapshot?.id).toBe("good");
  });

  it("ignores a scan that is still running", async () => {
    const db = new FakeDatabase();
    seedSnapshot(db, { id: "running", status: "analyzing", completedAt: null });

    expect(await getLatestSuccessfulAuthenticatedSnapshot(fakeSupabase(db), "project_1")).toBeNull();
  });

  it("returns null when a project has never run one, so the audit proceeds without it", async () => {
    expect(
      await getLatestSuccessfulAuthenticatedSnapshot(fakeSupabase(new FakeDatabase()), "project_1"),
    ).toBeNull();
  });

  it("never returns another project's snapshot", async () => {
    const db = new FakeDatabase();
    db.seed(TABLE, {
      id: "other",
      project_id: "project_2",
      status: "completed",
      completed_at: "2026-08-09T00:00:00.000Z",
      result: {},
    });

    expect(await getLatestSuccessfulAuthenticatedSnapshot(fakeSupabase(db), "project_1")).toBeNull();
  });
});
