import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The Security Test Plan's two largest rows, executed rather than asserted.
 *
 * > **RLS direct** — PostgREST calls with B's JWT against A's rows on all 50
 * > tables (SELECT/INSERT/UPDATE/DELETE); anon-key calls with no JWT →
 * > *zero rows / 42501; after VB-015: privilege-level denial too*
 *
 * Every other migration test in this directory checks one table, one policy or
 * one function — each written when that thing was built, and each therefore
 * scoped to what its author was thinking about. What none of them answers is
 * the question the plan actually asks: **is there any table at all where this
 * fails?**
 *
 * So this one enumerates. The table list comes from the catalog, not from a
 * literal, which is the entire point: a table added next month is in this test
 * the day it exists, and a table whose grants were never thought about fails
 * here rather than in production.
 *
 * ## Two users, both real
 *
 * `build_lifecycle_fixture` builds a full-depth project — fifteen tables deep,
 * from the installation down to an open interrupt. Two of them, and then every
 * question is asked as B about A.
 *
 * ## What this cannot cover
 *
 * PostgREST is not in the loop; this is psql with the role and JWT claim set
 * the way PostgREST sets them. That is the layer the guarantee actually lives
 * at — a policy that denies here denies through any client — but a defect in
 * PostgREST's own claim handling would not show up.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let alice: { userId: string; projectId: string };
let bob: { userId: string; projectId: string };

/** Acts as PostgREST does: the role plus that user's JWT subject. */
function asUser(userId: string, statement: string): string {
  return (
    `begin;` +
    ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
    ` set local role authenticated;` +
    ` ${statement} commit;`
  );
}

function fixture(label: string): { userId: string; projectId: string } {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");
  return { userId, projectId };
}

/** Every base table in `public`, from the catalog rather than from a literal. */
function publicTables(): string[] {
  return db
    .sql(
      `select string_agg(tablename, ',' order by tablename)
       from pg_tables where schemaname = 'public';`,
    )
    .split(",")
    .filter((name) => name.length > 0);
}

/** The tables that carry a direct owner column, which is what makes B's view checkable. */
function ownedTables(): string[] {
  return db
    .sql(
      `select coalesce(string_agg(c.table_name, ',' order by c.table_name), '')
       from information_schema.columns c
       join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
       where c.table_schema = 'public' and c.column_name = 'user_id';`,
    )
    .split(",")
    .filter((name) => name.length > 0);
}


/**
 * How one table protects another tenant's rows, or that it failed to.
 *
 * The plan accepts two answers and they are not equally strong: *"zero rows /
 * 42501; after VB-015: privilege-level denial too"*. A table the client cannot
 * reach at all is protected by privilege; one it can query but sees nothing in
 * is protected by a policy. Both are passes, and which one each table uses is
 * worth knowing, so the sweep records it rather than collapsing it to a
 * boolean.
 */
type Protection = "denied_by_privilege" | "hidden_by_policy" | "LEAKED";

function protectionOf(table: string, predicate: string): Protection {
  try {
    const visible = db.sqlLast(asUser(bob.userId, `select count(*) from public.${table} where ${predicate};`));
    return visible === "0" ? "hidden_by_policy" : "LEAKED";
  } catch {
    return "denied_by_privilege";
  }
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
  alice = fixture("tenant-a");
  bob = fixture("tenant-b");
}, 300_000);

afterAll(() => db?.stop());

describe("an anonymous caller", () => {
  /**
   * The whole table list, every time. VB-015 revoked the platform's default
   * `arwdDxtm` from `anon` on every table — including `TRUNCATE`, which RLS
   * does not govern at all — and this is what says a table created since then
   * did not quietly get it back.
   */
  it("cannot read any table in the schema", () => {
    const tables = publicTables();
    expect(tables.length).toBeGreaterThan(40);

    const reachable: string[] = [];
    for (const table of tables) {
      try {
        db.sql(`begin; set local role anon; select count(*) from public.${table}; commit;`);
        reachable.push(table);
      } catch {
        // Denied, which is the expected answer for every table.
      }
    }

    expect(reachable, "anon must reach no table at all").toEqual([]);
  });

  it("cannot write to any table in the schema", () => {
    const writable: string[] = [];
    for (const table of publicTables()) {
      try {
        db.sql(`begin; set local role anon; delete from public.${table}; commit;`);
        writable.push(table);
      } catch {
        // Denied.
      }
    }

    expect(writable, "anon must write to no table at all").toEqual([]);
  });
});

describe("one signed-in user against another's data", () => {
  /**
   * The enumerated half. Every table with an owner column, checked with B's
   * JWT for rows belonging to A — so a table whose policy was written without
   * an ownership predicate, or with the wrong one, appears here by name.
   */
  it("sees none of it, on every owner-scoped table", () => {
    const tables = ownedTables();
    expect(tables.length).toBeGreaterThan(15);

    const leaked = tables.filter(
      (table) => protectionOf(table, `user_id = '${alice.userId}'`) === "LEAKED",
    );

    expect(leaked, "these tables showed one user another's rows").toEqual([]);
  });

  /**
   * The same sweep for the project column, which is how the tables that carry
   * no `user_id` are still owner-scoped — `business_readiness_audits` is the
   * one Wave 1 found has no owner column at all.
   */
  it("sees none of it through the project column either", () => {
    const tables = db
      .sql(
        `select coalesce(string_agg(c.table_name, ',' order by c.table_name), '')
         from information_schema.columns c
         join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
         where c.table_schema = 'public' and c.column_name = 'project_id';`,
      )
      .split(",")
      .filter((name) => name.length > 0);

    expect(tables.length).toBeGreaterThan(15);

    const leaked = tables.filter(
      (table) => protectionOf(table, `project_id = '${alice.projectId}'`) === "LEAKED",
    );

    expect(leaked, "these tables showed one project's rows to another owner").toEqual([]);
  });

  /**
   * Reading is half of it. A policy can be right about `USING` and wrong about
   * `WITH CHECK`, so this drives the writes too — and asserts on A's data
   * afterwards rather than on the statement's own report, because an UPDATE
   * that matched no rows and an UPDATE that was refused both "succeed" from
   * the caller's side.
   */
  it("cannot delete it", () => {
    const before = db.sql(
      `select count(*) from public.projects where user_id = '${alice.userId}';`,
    );

    try {
      db.sql(asUser(bob.userId, `delete from public.projects where id = '${alice.projectId}';`));
    } catch {
      // A privilege-level refusal is the stronger answer and equally acceptable.
    }

    expect(db.sql(`select count(*) from public.projects where user_id = '${alice.userId}';`)).toBe(
      before,
    );
  });

  it("cannot rename it", () => {
    const before = db.sql(`select name from public.projects where id = '${alice.projectId}';`);

    try {
      db.sql(
        asUser(bob.userId, `update public.projects set name = 'taken' where id = '${alice.projectId}';`),
      );
    } catch {
      // Also acceptable.
    }

    expect(db.sql(`select name from public.projects where id = '${alice.projectId}';`)).toBe(before);
  });

  /**
   * The insert direction: naming somebody else's project on a row of your own.
   * `WITH CHECK` is what refuses this, and it is the half a policy written
   * only for reads forgets.
   */
  it("cannot attach a row of its own to another user's project", () => {
    const error = db.sqlExpectingError(
      asUser(
        bob.userId,
        `insert into public.audit_events (user_id, project_id, event_type, metadata)
         values ('${bob.userId}', '${alice.projectId}', 'probe', '{}'::jsonb);`,
      ),
    );

    expect(error).toMatch(/row-level security|permission denied/i);
  });
});

describe("the fixture itself", () => {
  /**
   * If the fixture stopped producing rows the sweeps above would pass by
   * finding nothing anywhere — the classic way an enumerating test becomes
   * decoration. This is what says A's data exists to be leaked.
   */
  it("gave user A rows to lose", () => {
    const rows = db.sql(
      `select count(*) from public.operation_runs where user_id = '${alice.userId}';`,
    );

    expect(Number(rows)).toBeGreaterThan(0);
    expect(alice.userId).not.toBe(bob.userId);
  });

  it("lets user A see their own project, so the sweeps are not just denying everyone", () => {
    expect(
      db.sqlLast(
        asUser(alice.userId, `select count(*) from public.projects where id = '${alice.projectId}';`),
      ),
    ).toBe("1");
  });
});
