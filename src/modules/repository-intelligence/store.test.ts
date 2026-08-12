import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/authenticated-product-intelligence/test-support";
import { getSnapshotById } from "./store";

/**
 * Snapshot lookup by id (Sprint 9 post-dogfood).
 *
 * Read by durable change preparation through the **service-role** client, which
 * bypasses RLS entirely (ADR 0013). That makes the `project_id` predicate the
 * only thing standing between an operation and another tenant's snapshot, so it
 * is tested directly rather than assumed from the database policy.
 */

const PROJECT = "project_1";

function seeded() {
  const db = new FakeDatabase();
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: { routes: { mode: "app_router", truncated: false, routes: [] } },
  });
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_other",
    project_id: "project_2",
    status: "completed",
    result: { routes: { mode: "app_router", truncated: false, routes: [] } },
  });
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_running",
    project_id: PROJECT,
    status: "running",
    result: null,
  });
  return fakeSupabase(db);
}

describe("getSnapshotById", () => {
  it("returns the snapshot when the project owns it", async () => {
    const snapshot = await getSnapshotById(seeded(), { snapshotId: "snapshot_1", projectId: PROJECT });

    expect(snapshot?.id).toBe("snapshot_1");
  });

  it("refuses a snapshot belonging to another project", async () => {
    // The mutation this exists for: dropping the ownership predicate would let
    // a preparation generate code from a different tenant's route intelligence.
    const snapshot = await getSnapshotById(seeded(), { snapshotId: "snapshot_other", projectId: PROJECT });

    expect(snapshot).toBeNull();
  });

  it("ignores a snapshot that never completed", async () => {
    const snapshot = await getSnapshotById(seeded(), { snapshotId: "snapshot_running", projectId: PROJECT });

    expect(snapshot).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    const snapshot = await getSnapshotById(seeded(), { snapshotId: "nope", projectId: PROJECT });

    expect(snapshot).toBeNull();
  });
});
