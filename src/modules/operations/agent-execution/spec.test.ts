import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "../test-support";

/*
 * The service-role client is the whole point of this module, so it is the one
 * thing the test replaces — with a double over the same in-memory database, the
 * way `operations/service.test.ts` already does. One Postgres, two clients with
 * different write access to it.
 */
const serviceDb = { current: new FakeDatabase() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(serviceDb.current),
}));

const { persistAgentExecutionSpec } = await import("./spec");
const { fakeAgentSpec } = await import("@/modules/coding-agent/test-support");

/**
 * Persisting an ExecutionSpec.
 *
 * ## Why this module exists at all
 *
 * `execution_specs` has a select policy and **no insert policy**, deliberately:
 * RLS cannot tell a Server Action from a browser holding the public anon key,
 * so an owner insert policy would let anyone forge a mode, a base SHA, a tool
 * policy or a Credit ceiling and hand the resulting spec id to
 * `startAgentExecution`.
 *
 * The website gate shipped writing with the caller's own client, so every
 * insert was refused and the page reported the step as not eligible while
 * saying, one line above, that Vibe could build it. Nothing caught it because
 * the fake database models no RLS.
 *
 * The tests below therefore cannot prove "RLS would have refused the other
 * client" — no in-memory double can. What they *can* prove is the property that
 * makes bypassing RLS safe: ownership is checked here, explicitly, against the
 * persisted project row.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project-1";

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  serviceDb.current = db;
  db.seed("projects", { id: PROJECT, user_id: USER });
});

function spec() {
  return fakeAgentSpec({ projectId: PROJECT });
}

describe("persistAgentExecutionSpec", () => {
  it("records the spec and returns the row id", async () => {
    const result = await persistAgentExecutionSpec({
      spec: spec(),
      userId: USER,
      repositoryConnectionId: "conn-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyExisted).toBe(false);

    const rows = db.rows("execution_specs");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(result.executionSpecId);
    expect(rows[0].project_id).toBe(PROJECT);
  });

  /**
   * The property that makes a service-role write safe. Without this check the
   * client that bypasses RLS would happily write a spec binding another
   * person's project to a run this session could then start.
   */
  it("refuses a project the session does not own, before any row exists", async () => {
    const result = await persistAgentExecutionSpec({
      spec: spec(),
      userId: OTHER_USER,
      repositoryConnectionId: "conn-1",
    });

    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(db.rows("execution_specs")).toHaveLength(0);
  });

  it("refuses a project that does not exist at all", async () => {
    const result = await persistAgentExecutionSpec({
      spec: fakeAgentSpec({ projectId: "project-missing" }),
      userId: USER,
      repositoryConnectionId: "conn-1",
    });

    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(db.rows("execution_specs")).toHaveLength(0);
  });

  /**
   * A double-click, a retry and two tabs on one step all produce the same spec
   * identity, so they must all produce the same row — which is what lets the
   * preview stay a pure read and the write happen late.
   */
  it("is idempotent by spec identity", async () => {
    const shared = spec();

    const first = await persistAgentExecutionSpec({
      spec: shared,
      userId: USER,
      repositoryConnectionId: "conn-1",
    });
    const second = await persistAgentExecutionSpec({
      spec: shared,
      userId: USER,
      repositoryConnectionId: "conn-1",
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.executionSpecId).toBe(first.executionSpecId);
    expect(second.alreadyExisted).toBe(true);
    expect(db.rows("execution_specs")).toHaveLength(1);
  });

  it("records exactly one audit event for a spec, however many times it is written", async () => {
    const shared = spec();

    await persistAgentExecutionSpec({ spec: shared, userId: USER, repositoryConnectionId: "conn-1" });
    await persistAgentExecutionSpec({ spec: shared, userId: USER, repositoryConnectionId: "conn-1" });

    const created = db
      .rows("audit_events")
      .filter((row) => row.event_type === "execution.spec_created");
    expect(created).toHaveLength(1);
  });
});
