import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-002 M2 — metering outlives both lifecycle events (ADR 0056 §7).
 *
 * The claim under test is one sentence: after a project is deleted, and after
 * the owning identity is erased, the five metering rows are still there with
 * their measurements intact and their owner columns null. Nothing here can be
 * read out of the migration text — `on delete set null` is a promise about
 * behaviour, and the whole point of M2 is that the previous promise
 * (`cascade`) was destroying the evidence for charges that survived it.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const METERING_TABLES = [
  "ai_usage_events",
  "billing_usage_events",
  "deep_scan_provider_usage",
  "review_browser_usage",
  "sandbox_usage_events",
] as const;

/** The four that carry an owner of their own; Deep Scan resolves it via project. */
const USER_OWNED = METERING_TABLES.filter((table) => table !== "deep_scan_provider_usage");

let db: Cluster;

let counter = 0;

/** One project with one metering row in each of the five tables. */
function seed(): { userId: string; projectId: string } {
  counter += 1;
  const label = `m2x${counter}`;
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");

  db.sql(`
    insert into public.ai_usage_events
      (project_id, user_id, operation, provider, model, status, input_tokens, output_tokens)
    values ('${projectId}', '${userId}', 'business_audit', 'anthropic', 'm', 'succeeded', 11, 22);

    insert into public.billing_usage_events
      (project_id, user_id, source_kind, source_id, sku, quantity, occurred_at, provider, cost_status)
    values ('${projectId}', '${userId}', 'ai_usage_event', gen_random_uuid(), 'anthropic_input_tokens',
            11, now(), 'anthropic', 'cost_unknown');

    insert into public.deep_scan_provider_usage
      (project_id, provider, operation, access_mode, status, started_at, ended_at, duration_ms)
    values ('${projectId}', 'browserbase', 'authenticated_product_analysis', 'credits',
            'completed', now(), now(), 3333);

    insert into public.review_browser_usage
      (project_id, user_id, operation, provider, status, duration_ms, captures)
    values ('${projectId}', '${userId}', 'change_review', 'browserbase', 'ready', 4444, 2);

    insert into public.sandbox_usage_events
      (project_id, user_id, operation, provider, status, sandbox_duration_ms)
    values ('${projectId}', '${userId}', 'change_validation', 'vercel', 'passed', 5555);
  `);

  return { userId, projectId };
}

function rowCount(table: string, column: string, value: string): number {
  return Number(db.sql(`select count(*) from public.${table} where ${column} = '${value}';`));
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  // The fixture builds one full-depth project; metering is layered on top.
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("M2 schema shape", () => {
  it("A. every metering owner column is nullable and SET NULL", () => {
    const rows = db.sql(`
      select c.relname || ':' || a.attname || ':' || a.attnotnull::text || ':' || con.confdeltype::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_constraint con
        on con.conrelid = c.oid and con.contype = 'f' and a.attnum = any (con.conkey)
      where c.relname in (${METERING_TABLES.map((t) => `'${t}'`).join(",")})
        and a.attname in ('project_id', 'user_id')
      order by 1;
    `).split("\n");

    // 5 project_id + 4 user_id, each nullable ('f') with SET NULL ('n').
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row).toMatch(/:false:n$/);
  });
});

describe("deleting a project", () => {
  it("B. detaches every metering row instead of destroying it", () => {
    const { userId, projectId } = seed();

    db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`);

    expect(rowCount("projects", "id", projectId)).toBe(0);

    for (const table of METERING_TABLES) {
      expect(
        Number(db.sql(`select count(*) from public.${table} where project_id is null;`)),
      ).toBeGreaterThan(0);
    }

    // The measurement itself is untouched — this is the whole reason the row
    // is retained rather than deleted.
    expect(db.sql(`select duration_ms from public.review_browser_usage where project_id is null;`)).toBe(
      "4444",
    );
    expect(
      db.sql(`select sandbox_duration_ms from public.sandbox_usage_events where project_id is null;`),
    ).toBe("5555");

    // ...and the owner survives a project deletion. Only erasure clears it.
    for (const table of USER_OWNED) {
      expect(rowCount(table, "user_id", userId)).toBe(1);
    }
  });
});

describe("erasing the identity", () => {
  it("C. nulls the owner and keeps the measurement", () => {
    const { userId, projectId } = seed();

    db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`);
    db.sql(`delete from auth.users where id = '${userId}';`);

    for (const table of USER_OWNED) {
      expect(rowCount(table, "user_id", userId)).toBe(0);
    }

    expect(
      Number(db.sql(`select count(*) from public.ai_usage_events where user_id is null;`)),
    ).toBeGreaterThan(0);
    expect(db.sql(`select input_tokens from public.ai_usage_events where user_id is null limit 1;`)).toBe(
      "11",
    );
  });

  it("D. is refused while the identity still owns a project", () => {
    // Why ADR 0056 §4's step order is mandatory rather than tidy: step 11 is
    // physically unreachable until step 4 has emptied the account of projects.
    // Nothing in the erasure code enforces that; the database does.
    //
    // Measured, and not what the ordering argument assumed: the blocker that
    // fires is F3's `repository_connections.github_installation_id` RESTRICT,
    // not the `execution_specs` immutability trigger. Both stand in the way,
    // and which one PostgreSQL reaches first is not a guarantee to assert on —
    // so this asserts refusal, which is the invariant, rather than a message,
    // which is an implementation detail that M2′ will change.
    const { userId } = seed();

    db.sqlExpectingError(`delete from auth.users where id = '${userId}';`);
    expect(rowCount("projects", "user_id", userId)).toBe(1);
  });
});
