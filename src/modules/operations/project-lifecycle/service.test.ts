import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakeStorage, withFakeStorage, type FakeStorage } from "@/modules/review/test-support";

/**
 * VB-001 — the lifecycle orchestrator (ADR 0056 §3).
 *
 * The subject is not "does it delete", which the database already proves
 * against real PostgreSQL in `supabase/tests/`. It is the four things only the
 * application can get wrong: whom it asks about, what it refuses, what order it
 * runs in, and what it says when a stage fails.
 */

const serviceDb = { current: new FakeDatabase() };
const storage = { current: fakeStorage() };
const eraseRpc = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => withFakeStorage(fakeSupabase(serviceDb.current), storage.current),
}));

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return { ...actual, callEraseProjectLifecycle: (...args: unknown[]) => eraseRpc(...args) };
});

const { deleteProjectLifecycle } = await import("./service");

const PROJECT = "project-1";
const OWNER = "user-1";

function seedScreenshots(store: FakeStorage, paths: readonly string[]): void {
  for (const path of paths) store.objects.set(path, new Uint8Array([1]));
}

beforeEach(() => {
  serviceDb.current = new FakeDatabase();
  serviceDb.current.seed("projects", { id: PROJECT, user_id: OWNER });
  storage.current = fakeStorage();
  eraseRpc.mockReset();
  eraseRpc.mockResolvedValue(true);
});

describe("ownership", () => {
  it("refuses a project the caller does not own, and touches nothing", async () => {
    await expect(
      deleteProjectLifecycle({ projectId: PROJECT, userId: "someone-else" }),
    ).resolves.toEqual({ ok: false, reason: "project_not_found" });

    expect(eraseRpc).not.toHaveBeenCalled();
    expect(storage.current.removed).toEqual([]);
  });

  it("gives the same answer for a project that does not exist", async () => {
    await expect(
      deleteProjectLifecycle({ projectId: "no-such-project", userId: OWNER }),
    ).resolves.toEqual({ ok: false, reason: "project_not_found" });
  });

  it("passes the session's user id to the database authority, unchanged", async () => {
    await deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER });
    expect(eraseRpc).toHaveBeenCalledWith(expect.anything(), {
      projectId: PROJECT,
      userId: OWNER,
    });
  });
});

describe("the active-work gate", () => {
  /**
   * The trap ADR 0056 §10 names by name. `operations/store.ts` defines its own
   * active set as `queued`/`running` — `needs_user` is deliberately absent
   * there, because it answers "is something *working*". A gate built on that
   * set deletes a project holding a paused audit that still owns a live Credit
   * reservation.
   */
  it.each(["queued", "running", "needs_user"])(
    "refuses while an operation is %s",
    async (status) => {
      serviceDb.current.seed("operation_runs", { id: `op-${status}`, project_id: PROJECT, status });

      await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
        ok: false,
        reason: "active_operation",
      });
      expect(eraseRpc).not.toHaveBeenCalled();
    },
  );

  it.each(["completed", "failed", "cancelled"])(
    "proceeds when the only operation is %s",
    async (status) => {
      serviceDb.current.seed("operation_runs", { id: `op-${status}`, project_id: PROJECT, status });

      await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
        ok: true,
      });
    },
  );

  it.each(["queued", "running", "needs_user_input"])(
    "refuses while an agent run is %s",
    async (status) => {
      serviceDb.current.seed("agent_execution_runs", { id: "run-1", project_id: PROJECT, status });

      await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
        ok: false,
        reason: "agent_running",
      });
    },
  );

  it.each(["preflight", "merging"])("refuses while a merge is %s", async (status) => {
    serviceDb.current.seed("change_merges", { id: "merge-1", project_id: PROJECT, status });

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "merge_in_progress",
    });
  });

  /**
   * Deletion waits for a hold; it never releases one. That authority belongs to
   * the CAS-gated finalizers (ADR 0042), and taking it here would risk the
   * `charge_without_hold` class four sprints of billing work eliminated.
   */
  it("refuses while a Credit reservation is still active, and releases nothing", async () => {
    serviceDb.current.seed("billing_credit_reservations", {
      id: "res-1",
      project_id: PROJECT,
      status: "active",
    });

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "billing_not_finalized",
    });
    expect(
      serviceDb.current.rows("billing_credit_reservations").map((row) => row.status),
    ).toEqual(["active"]);
  });

  it("ignores another project's live work", async () => {
    serviceDb.current.seed("projects", { id: "project-2", user_id: OWNER });
    serviceDb.current.seed("operation_runs", { id: "op-2", project_id: "project-2", status: "running" });

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("the storage sweep", () => {
  it("removes every screenshot under the project's prefix", async () => {
    seedScreenshots(storage.current, [
      `${PROJECT}/artifact-a/before.png`,
      `${PROJECT}/artifact-a/after.png`,
      `${PROJECT}/artifact-b/before.png`,
    ]);

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: true,
    });
    expect(storage.current.removed.sort()).toEqual([
      `${PROJECT}/artifact-a/after.png`,
      `${PROJECT}/artifact-a/before.png`,
      `${PROJECT}/artifact-b/before.png`,
    ]);
    expect(storage.current.objects.size).toBe(0);
  });

  it("leaves another project's screenshots alone", async () => {
    seedScreenshots(storage.current, [
      `${PROJECT}/artifact-a/before.png`,
      `project-2/artifact-z/before.png`,
    ]);

    await deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER });

    expect([...storage.current.objects.keys()]).toEqual(["project-2/artifact-z/before.png"]);
  });

  it("sweeps before the database, so a failure leaves the project visible", async () => {
    seedScreenshots(storage.current, [`${PROJECT}/artifact-a/before.png`]);
    storage.current.failRemove = true;

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "storage_cleanup_failed",
    });
    // The order is the point: the row is still there to try again from.
    expect(eraseRpc).not.toHaveBeenCalled();
    expect(serviceDb.current.rows("projects")).toHaveLength(1);
  });

  it("reports a failed listing rather than treating it as an empty prefix", async () => {
    seedScreenshots(storage.current, [`${PROJECT}/artifact-a/before.png`]);
    storage.current.failList = true;

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "storage_cleanup_failed",
    });
    expect(eraseRpc).not.toHaveBeenCalled();
  });

  it("succeeds when the project never had a screenshot", async () => {
    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: true,
    });
    expect(storage.current.removed).toEqual([]);
  });

  /** Re-running after a partial sweep must complete rather than re-fail. */
  it("is idempotent: a retry after a partial sweep completes", async () => {
    seedScreenshots(storage.current, [`${PROJECT}/artifact-a/before.png`]);
    storage.current.failRemove = true;
    await deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER });

    storage.current.failRemove = false;
    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("the deletion itself", () => {
  it("reports deletion_failed when the database refused the cascade", async () => {
    eraseRpc.mockRejectedValue(
      new Error('execution_specs rows are immutable — constraint "x" on table "y"'),
    );

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "deletion_failed",
    });
  });

  /** The VB-003 invariant, at the layer below where it was first fixed. */
  it("never lets a database message reach the caller", async () => {
    eraseRpc.mockRejectedValue(new Error("relation public.execution_specs — secret"));

    const result = await deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER });

    expect(JSON.stringify(result)).toBe('{"ok":false,"reason":"deletion_failed"}');
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  /**
   * The row existed at the ownership check and the function still reports it
   * deleted nothing. Reporting success here would be VB-003 in a new place.
   */
  it("does not claim success when the function deleted no row", async () => {
    eraseRpc.mockResolvedValue(false);

    await expect(deleteProjectLifecycle({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "deletion_failed",
    });
  });
});
