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
        -- Both spellings. VB-026 rewrote every policy to the InitPlan form,
        -- so the pin now reads "SELECT auth.uid() AS uid" rather than the bare
        -- call. Same guarantee either way: this asserts the shape, and the
        -- tests below assert the behaviour that actually matters.
        and coalesce(p.with_check, '') !~ 'user_id = (auth[.]uid[(][)]|[(] SELECT auth[.]uid[(][)])';
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

/**
 * VB-018 — execution evidence is not writable from a browser.
 *
 * The pin above stops an owner *reassigning* a row. This stops them rewriting
 * what Vibe concluded about it, which is the more valuable forgery: a customer
 * who can set their own validation to `passed` has defeated the gate the
 * approval and merge machinery downstream trusts.
 *
 * No fixture row is needed, and deliberately so. The guarantee is a privilege,
 * and PostgreSQL checks privileges while planning the statement — so
 * `UPDATE … WHERE false` is refused for a missing grant and succeeds (touching
 * nothing) for a present one. That makes each assertion about the grant itself
 * rather than about whatever a fixture happened to contain.
 */
describe("execution evidence", () => {
  const CLOSED = ["validation_runs", "prepared_changes"] as const;

  for (const table of CLOSED) {
    it(`refuses any client UPDATE of ${table}`, () => {
      const error = db.sqlExpectingError(
        asUser(owner, `update public.${table} set status = 'passed' where false;`),
      );
      expect(error).toMatch(/permission denied/i);
    });
  }

  it("leaves the audit's founder-answer columns writable", () => {
    // The one legitimate client write on this table, and the reason it is
    // column-restricted rather than closed: `submitFounderAnswerAction` runs on
    // the authenticated client and sets exactly these two.
    db.sql(
      asUser(
        owner,
        `update public.business_readiness_audits set status = 'analyzing', pending_question = null where false;`,
      ),
    );
  });

  it("refuses the same client rewriting the audit's conclusion", () => {
    const error = db.sqlExpectingError(
      asUser(owner, `update public.business_readiness_audits set result = '{}'::jsonb where false;`),
    );
    expect(error).toMatch(/permission denied/i);
  });

  it("leaves durable execution untouched, because service_role bypasses RLS", () => {
    // Not a formality: if this had been done with a policy alone, revoking the
    // grant would have caught the service role too and stopped every audit.
    expect(db.sql(`select rolbypassrls from pg_roles where rolname = 'service_role';`)).toBe("t");
  });
});

/**
 * VB-015 — the surplus Data API privileges are gone.
 *
 * The sharp edge is `TRUNCATE`: row-level security does not govern it, so a
 * role holding it empties a table regardless of every policy on it. No policy
 * anywhere closed that, which is why it needed a grant change rather than a
 * policy change.
 */
describe("Data API privileges", () => {
  it("grants anon nothing on any public table", () => {
    const held = db.sql(`
      select coalesce(string_agg(distinct table_name, ', '), '')
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon';
    `);

    expect(held).toBe("");
  });

  it("leaves nobody holding TRUNCATE, which RLS cannot govern", () => {
    const held = db.sql(`
      select coalesce(string_agg(distinct grantee || ':' || table_name, ', '), '')
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
    `);

    expect(held).toBe("");
  });

  /**
   * The rule the migration derives, checked from the other direction: a
   * privilege `authenticated` holds must have a policy behind it, or it is
   * surplus again.
   */
  it("gives authenticated no privilege without a policy behind it", () => {
    const surplus = db.sql(`
      select coalesce(string_agg(g.table_name || ':' || g.privilege_type, ', '), '')
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.grantee = 'authenticated'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = g.table_name
            and (p.cmd = 'ALL' or upper(p.cmd) = g.privilege_type)
        );
    `);

    expect(surplus).toBe("");
  });

  it("keeps VB-018's column restriction rather than re-granting the table", () => {
    // The derived rule sees an UPDATE policy on this table and would re-grant
    // it wholesale; the migration restates the column form afterwards.
    expect(
      db.sql(`
        select coalesce(string_agg(column_name, ',' order by column_name), '')
        from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'business_readiness_audits'
          and grantee = 'authenticated' and privilege_type = 'UPDATE';
      `),
    ).toBe("pending_question,status");
  });

  it("pins set_updated_at's search_path", () => {
    expect(
      db.sql(`
        select coalesce(array_to_string(p.proconfig, ','), '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_updated_at';
      `),
    ).toContain("search_path=");
  });
});

/**
 * Wave 2's database batch (VB-026, VB-027, VB-036).
 *
 * The first two are performance findings, and the reason they are asserted
 * here rather than left to the advisor is that both are *invariants a future
 * migration can silently undo*: a hand-written policy reintroduces the per-row
 * call, and a new table arrives with an unindexed foreign key. The advisor
 * catches those a week later; this catches them in CI.
 */
describe("VB-026 — policies resolve the caller once per statement", () => {
  it("leaves no policy calling auth.uid() per row", () => {
    // Counted rather than pattern-matched, because the deparsed bare call sits
    // inside parentheses and after a space — so "auth.uid() not preceded by X"
    // is easy to write and easy to get vacuously right. Every occurrence must
    // be a wrapped one: total calls minus wrapped calls has to be zero.
    const perRow = db.sql(`
      select coalesce(string_agg(distinct p.tablename || ':' || p.policyname, ', '), '')
      from pg_policies p
      cross join lateral (
        select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as body
      ) t
      where p.schemaname = 'public'
        and (length(t.body) - length(replace(t.body, 'auth.uid()', '')))
          <> (length(t.body) - length(replace(t.body, 'SELECT auth.uid()', '')))
             * length('auth.uid()') / length('SELECT auth.uid()');
    `);

    expect(perRow).toBe("");
  });

  /**
   * The rewrite read each policy's own definition out of the catalog and put
   * it back. That is safe only if nothing was lost on the way, so the count is
   * pinned: a policy silently dropped during a rewrite would show up here and
   * nowhere else until someone noticed a table was readable.
   */
  it("keeps every policy it rewrote", () => {
    // 119 before this batch, minus the two INSERT policies VB-036 drops from
    // the provider ledgers below, plus the one SELECT policy ADR 0084 adds to
    // `nova_voice_messages`. Stated as the arithmetic rather than as a magic
    // number, so a future change has to say which of the three it moved.
    expect(Number(db.sql(`select count(*) from pg_policies where schemaname = 'public';`))).toBe(
      119 - 2 + 1,
    );
  });
});

describe("VB-027 — every foreign key has a covering index", () => {
  it("leaves no foreign key unindexed, whatever its arity", () => {
    const unindexed = db.sql(`
      -- Composite keys included. They were the two the first draft missed by
      -- filtering on a single column, and one of them would have been indexed
      -- on the wrong column order had it been written by hand.
      select coalesce(string_agg(c.relname || '.' || con.conname, ', ' order by c.relname), '')
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where con.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.oid
            and (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] = con.conkey
        );
    `);

    expect(unindexed).toBe("");
  });
});

describe("VB-036 — the provider ledgers take no client writes", () => {
  for (const table of ["ai_usage_events", "deep_scan_provider_usage"] as const) {
    it(`refuses a client INSERT into ${table}`, () => {
      const error = db.sqlExpectingError(
        asUser(owner, `insert into public.${table} (project_id) values (null);`),
      );
      expect(error).toMatch(/permission denied/i);
    });
  }

  it("leaves durable execution able to write them", () => {
    // The grant went, not the table. service_role bypasses RLS and keeps its
    // privileges, or every AI call would stop being metered.
    expect(
      db.sql(`
        select count(*) from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'service_role'
          and table_name in ('ai_usage_events', 'deep_scan_provider_usage')
          and privilege_type = 'INSERT';
      `),
    ).toBe("2");
  });
});
