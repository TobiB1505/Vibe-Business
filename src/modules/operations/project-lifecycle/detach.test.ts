import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";

/**
 * VB-001 M5 — disconnecting stops being a deletion (ADR 0056 §1).
 *
 * The subject is what only the application can get wrong: whom it asks about,
 * what it refuses, and that it destroys nothing. Whether the row is actually
 * marked is proved against real PostgreSQL in `supabase/tests/`.
 */

const serviceDb = { current: new FakeDatabase() };
const rpc = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    const base = fakeSupabase(serviceDb.current);
    return Object.assign(Object.create(Object.getPrototypeOf(base) as object), base, { rpc });
  },
}));

const { detachRepository } = await import("./detach");

const PROJECT = "project-1";
const OWNER = "user-1";

beforeEach(() => {
  serviceDb.current = new FakeDatabase();
  serviceDb.current.seed("projects", { id: PROJECT, user_id: OWNER });
  serviceDb.current.seed("repository_connections", {
    id: "connection-1",
    project_id: PROJECT,
    detached_at: null,
  });
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "detached", error: null });
});

describe("ownership", () => {
  it("refuses a project the caller does not own, and asks the database nothing", async () => {
    await expect(detachRepository({ projectId: PROJECT, userId: "someone-else" })).resolves.toEqual({
      ok: false,
      reason: "project_not_found",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the session's user id to the database authority, unchanged", async () => {
    await detachRepository({ projectId: PROJECT, userId: OWNER });
    expect(rpc).toHaveBeenCalledWith("detach_repository", {
      p_project_id: PROJECT,
      p_user_id: OWNER,
    });
  });
});

describe("the gate", () => {
  /**
   * The same gate deletion uses, deliberately. Both ask whether anything is
   * still live for this project, and two definitions that must agree are one
   * definition that eventually will not.
   */
  it.each([
    ["operation_runs", { status: "needs_user" }, "active_operation"],
    ["agent_execution_runs", { status: "running" }, "agent_running"],
    ["change_merges", { status: "merging" }, "merge_in_progress"],
    ["billing_credit_reservations", { status: "active" }, "billing_not_finalized"],
  ])("refuses while %s says work is live", async (table, row, reason) => {
    serviceDb.current.seed(table, { id: "row-1", project_id: PROJECT, ...row });

    await expect(detachRepository({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("proceeds when the only work is finished", async () => {
    serviceDb.current.seed("operation_runs", {
      id: "op-1",
      project_id: PROJECT,
      status: "completed",
    });

    await expect(detachRepository({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("what it does and does not do", () => {
  it("destroys nothing", async () => {
    serviceDb.current.seed("business_readiness_audits", { id: "audit-1", project_id: PROJECT });

    await expect(detachRepository({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: true,
    });

    // The project and its derived work are the whole point of the split: a
    // disconnect that removed them would be the control this replaced.
    expect(serviceDb.current.rows("projects")).toHaveLength(1);
    expect(serviceDb.current.rows("business_readiness_audits")).toHaveLength(1);
    expect(serviceDb.current.rows("repository_connections")).toHaveLength(1);
  });

  it("reports nothing to disconnect when no live connection remains", async () => {
    rpc.mockResolvedValue({ data: "not_found", error: null });

    await expect(detachRepository({ projectId: PROJECT, userId: OWNER })).resolves.toEqual({
      ok: false,
      reason: "project_not_found",
    });
  });

  it("never lets a database message reach the caller", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "repository_connections" — secret' },
    });

    const result = await detachRepository({ projectId: PROJECT, userId: OWNER });

    expect(JSON.stringify(result)).toBe('{"ok":false,"reason":"detach_failed"}');
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
