import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Two properties every table in `public` must have, asserted against the
 * database the **migration files** build.
 *
 * ## Why here rather than against the deployed project
 *
 * Because the deployed project can be right for a reason the files are not.
 * Supabase runs a platform event trigger, `rls_auto_enable`, that silently
 * turns RLS on for any table created in `public` — it exists on the deployed
 * database and in no file under `supabase/migrations/`. So a migration that
 * forgot RLS would be quietly corrected in production and left uncorrected
 * everywhere else, and reading production would report the property holding
 * when the thing that has to hold it does not.
 *
 * These assertions are what make that trigger genuinely redundant instead of
 * load-bearing-and-undeclared. With them, a forgotten grant or a forgotten
 * `enable row level security` fails here, loudly, before it reaches an
 * environment that hides it.
 *
 * ## Why the second assertion exists
 *
 * It was written the day it would have caught a live defect.
 * `browser_runtime_images` (ADR 0076) shipped with **no** `service_role`
 * grants, because its migration said nothing about privileges and the default
 * privileges revoke covers `service_role` too. RLS was on, no policy existed,
 * and by every check the repository had, the table looked correct. The first
 * Deep Scan would have failed with `42501` at the image lookup — before the
 * insert, before the browser, before anything a person could see a reason for.
 *
 * `owner-pin.migration.ts` already asserts that nobody holds *too much*. This
 * is the other direction, and nothing was asserting it: a table the
 * application cannot reach at all.
 */

/**
 * Tables that deliberately hold no direct `service_role` grant.
 *
 * An entry is a design, not a waiver — each names why reaching the table
 * directly is the wrong shape. Adding one is the review.
 */
const NO_DIRECT_SERVICE_ROLE_ACCESS: readonly { table: string; why: string }[] = [
  {
    table: "auth_attempt_windows",
    why:
      "ADR 0060. The throttle is reached only through `record_auth_attempt`, a SECURITY DEFINER " +
      "function, and that indirection is the design: the table has no tenant column, so there is " +
      "no ownership a direct caller could be scoped by. A grant here would create a second way in " +
      "that the function exists to prevent.",
  },
];

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 180_000);

afterAll(() => {
  db?.stop();
});

/** Every ordinary table in `public`, as the migrations built it. */
function publicTables(): string[] {
  return db
    .sql(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname;`,
    )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe("the migration files, not the platform, enable row level security", () => {
  it("finds the tables it is supposed to be checking", () => {
    // The guard against a query that silently matched nothing and passed.
    expect(publicTables().length).toBeGreaterThan(40);
  });

  it("leaves no table in public without RLS", () => {
    const without = db.sql(
      `select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;`,
    );

    expect(
      without,
      "A table without RLS is readable by anyone holding the publishable key. Production would " +
        "hide this — Supabase's rls_auto_enable trigger turns it on there and exists in no " +
        "migration — so the file that creates a table must enable it itself.",
    ).toBe("");
  });

  it("does not rely on a platform trigger that no migration declares", () => {
    // The drift itself, asserted from the other side: the database these files
    // build has no such trigger, which is exactly why the assertion above has
    // to hold on its own.
    const triggers = db.sql(`select coalesce(string_agg(evtname, ', '), '') from pg_event_trigger;`);

    expect(triggers).not.toContain("ensure_rls");
  });
});

describe("every table the application uses is reachable by service_role", () => {
  it("grants service_role at least one of the four table privileges", () => {
    const exempt = new Set(NO_DIRECT_SERVICE_ROLE_ACCESS.map((entry) => entry.table));

    const unreachable = publicTables().filter((table) => {
      if (exempt.has(table)) return false;
      const held = db.sql(
        `select coalesce(string_agg(distinct privilege_type, ','), '')
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = '${table}'
            and grantee = 'service_role'
            and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');`,
      );
      return held === "";
    });

    expect(
      unreachable,
      "A table service_role cannot reach is a table the application cannot use. RLS does not " +
        "produce this and no policy fixes it — the default privileges revoke covers service_role " +
        "too, so a migration that says nothing about grants produces a table that fails with " +
        "42501 the first time anything reads it.",
    ).toEqual([]);
  });

  it("keeps every exemption pointing at a table that still exists", () => {
    // A stale entry is worse than a missing one: it is a standing exemption
    // nobody is checking, pre-approving whatever is created at that name next.
    const tables = new Set(publicTables());

    for (const entry of NO_DIRECT_SERVICE_ROLE_ACCESS) {
      expect(tables.has(entry.table), `${entry.table} is exempt but does not exist`).toBe(true);
    }
  });

  it("makes every exemption argue a design rather than assert a waiver", () => {
    for (const entry of NO_DIRECT_SERVICE_ROLE_ACCESS) {
      expect(entry.why.length).toBeGreaterThan(120);
      expect(entry.why).toMatch(/ADR \d{4}/);
    }
  });
});
