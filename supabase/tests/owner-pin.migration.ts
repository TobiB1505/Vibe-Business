import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-019 — the denormalized owner survives an owner's own UPDATE.
 *
 * This has to run against real PostgreSQL, and against the `authenticated`
 * role specifically. `FakeDatabase` does not evaluate RLS at all, so a policy
 * test written against it would pass whatever the policy said — the whole
 * claim here is about what the database refuses, which only the database can
 * answer.
 *
 * Both directions are asserted, and the second is what keeps the first
 * honest: a policy that refuses everything would pass a refusal test alone.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The six tables the audit's finding covers, after ADR 0057 added a seventh case. */
const PINNED_TABLES = [
  "operation_runs",
  "validation_runs",
  "prepared_changes",
  "preview_sessions",
  "review_artifacts",
  "execution_interrupts",
] as const;

let db: Cluster;
let owner = "";
let intruder = "";
let projectId = "";

/**
 * Runs a statement as `authenticated` with `auth.uid()` bound to one identity.
 *
 * The setting name is `request.jwt.claim.sub` because that is what this
 * harness's `auth.uid()` stub reads (`supabase/tests/harness.ts`). Production
 * Supabase reads `request.jwt.claims->>'sub'` instead — a fidelity gap in the
 * stub, not in the policy: either way `auth.uid()` returns this identity, which
 * is the only thing the policy under test consults.
 */
function asUser(userId: string, statement: string): string {
  return (
    `begin;` +
    ` set local role authenticated;` +
    ` set local request.jwt.claim.sub = '${userId}';` +
    ` ${statement}` +
    ` commit;`
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);

  owner = db.sql(
    `with i as (insert into auth.users (email) values ('pin-owner@fixture.test') returning id) select id from i;`,
  );
  intruder = db.sql(
    `with i as (insert into auth.users (email) values ('pin-intruder@fixture.test') returning id) select id from i;`,
  );
  projectId = db.sql(
    `with i as (insert into public.projects (user_id, name) values ('${owner}', 'pin') returning id) select id from i;`,
  );

  db.sql(`
    insert into public.operation_runs
      (project_id, user_id, operation_type, status, input_identity)
    values ('${projectId}', '${owner}', 'business_audit', 'queued', repeat('a', 64));
  `);
}, 300_000);

afterAll(() => db?.stop());

describe("the policy shape", () => {
  it("pins the owner in every WITH CHECK", () => {
    const unpinned = db.sql(`
      select coalesce(string_agg(p.tablename, ','), '')
      from pg_policies p
      where p.schemaname = 'public' and p.cmd = 'UPDATE'
        and p.tablename in (${PINNED_TABLES.map((t) => `'${t}'`).join(",")})
        and coalesce(p.with_check, '') not like '%user_id = auth.uid()%';
    `);

    expect(unpinned).toBe("");
  });
});

describe("what an owner may still do", () => {
  it("updates their own row without touching the owner column", () => {
    db.sql(asUser(owner, `update public.operation_runs set status = 'running' where project_id = '${projectId}';`));

    expect(
      db.sql(`select status from public.operation_runs where project_id = '${projectId}';`),
    ).toBe("running");
  });
});

describe("what it now refuses", () => {
  /**
   * The finding itself. The project check passes — the project really is the
   * caller's — and before this migration that was the whole policy, so the
   * write landed and the row's economic owner became somebody else.
   */
  it("refuses to move a row to another identity", () => {
    const error = db.sqlExpectingError(
      asUser(owner, `update public.operation_runs set user_id = '${intruder}' where project_id = '${projectId}';`),
    );

    expect(error).toMatch(/row-level security|violates row-level security policy/i);
    expect(db.sql(`select user_id from public.operation_runs where project_id = '${projectId}';`)).toBe(
      owner,
    );
  });

  it("refuses to null the owner, which is the erasure tombstone's shape", () => {
    db.sqlExpectingError(
      asUser(owner, `update public.operation_runs set user_id = null where project_id = '${projectId}';`),
    );

    expect(db.sql(`select user_id from public.operation_runs where project_id = '${projectId}';`)).toBe(
      owner,
    );
  });
});
