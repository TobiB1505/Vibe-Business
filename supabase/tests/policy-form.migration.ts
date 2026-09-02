import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startCluster, type Cluster } from "./harness";

/**
 * Every RLS policy calls `auth.uid()` once per query, not once per row
 * (PERF-019).
 *
 * ## The difference this protects
 *
 * `auth.uid()` is `STABLE`, not `IMMUTABLE`, so PostgreSQL will not hoist it
 * out of a per-row filter on its own. Written bare — `user_id = auth.uid()` —
 * it is evaluated for every row the planner examines. Wrapped —
 * `user_id = (select auth.uid())` — it becomes an InitPlan: computed once and
 * reused, whatever the table's size.
 *
 * `20260827202440_wave2_database_hygiene.sql` rewrote all of them into the
 * wrapped form. **Nothing then stopped the next policy being written bare**,
 * and a policy is the one place where that mistake is invisible: it is not in
 * the code path anybody reads, it produces the correct answer, and its cost
 * only appears as the table grows.
 *
 * ## Why the catalog and not the migration text
 *
 * Because the rewrite was catalog-based — it read `pg_policies` and
 * regenerated each policy — so the wrapped form appears in no migration file.
 * A text search over `supabase/migrations` would report every policy as bare
 * and be wrong about all of them.
 *
 * Measured while writing this: replaying every migration into a fresh cluster
 * produces **117 policies, all wrapped** — the same count and the same form as
 * the deployed database. The migrations do reproduce the deployed policies,
 * which is the premise this file needs and the audit had flagged as uncertain.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The session functions that must never be called per row.
 *
 * `auth.jwt()` and `auth.role()` are unused today and are listed anyway: the
 * whole point is to catch the policy nobody has written yet, and adding a name
 * after it appears is the failure mode this file exists to prevent.
 */
const PER_QUERY_FUNCTIONS = ["uid", "jwt", "role"] as const;

let db: Cluster;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 300_000);

afterAll(() => db?.stop());

/** Policy expressions, one row per policy, `qual` and `with_check` together. */
const POLICIES = `
  with p as (
    select tablename, policyname,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
    from pg_policies where schemaname = 'public'
  )
`;

describe("RLS policies evaluate the session once per query (PERF-019)", () => {
  it("has policies to check at all", () => {
    // A catalog query that matched nothing would pass every assertion below
    // while proving nothing — the shape of empty-set pass this repository has
    // already been caught by once (`[] satisfies "anything"[]`, Sprint 0119).
    const total = Number(db.sql(`select count(*) from pg_policies where schemaname = 'public';`));
    expect(total).toBeGreaterThan(100);
  });

  it.each(PER_QUERY_FUNCTIONS)("wraps every auth.%s() call in a select", (fn) => {
    const bare = db.sql(`
      ${POLICIES}
      select tablename || '.' || policyname from p
      where expr ~ 'auth\\.${fn}\\(\\)'
        and expr !~ '\\(\\s*SELECT\\s+auth\\.${fn}\\(\\)'
      order by 1;
    `);

    // Named rather than counted: the failure message is the list of policies to
    // fix, and a count would make the next person run this query by hand.
    expect(bare, `policies calling auth.${fn}() per row`).toBe("");
  });

  it("leaves no other per-row session lookup to grow into the same problem", () => {
    // `current_setting('request.jwt.claims')` is the other way to reach the
    // session, and it is STABLE for the same reason. None exists today; this
    // fails when the first one is added bare rather than after it is deployed.
    const bare = db.sql(`
      ${POLICIES}
      select tablename || '.' || policyname from p
      where expr ~ 'current_setting\\('
        and expr !~ '\\(\\s*SELECT\\s+current_setting\\('
      order by 1;
    `);

    expect(bare).toBe("");
  });
});
