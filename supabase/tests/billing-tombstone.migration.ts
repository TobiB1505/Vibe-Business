import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-002 M3′ — the billing graph is tombstoned, never deleted (ADR 0056 §6).
 *
 * F5 is the reason this needs a real database rather than a reading of the
 * migration: the damage a `cascade` here would do is not that three rows
 * disappear, it is that everything hanging beneath the credit account goes
 * with them and no repair function can ever notice. The repair pass
 * re-materializes rows marked `materialized_at is null`; a deleted row is
 * invisible to it, not pending for it. So the assertion that matters is not
 * "the account survived" but "the ledger beneath it survived, still balanced".
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let counter = 0;

/** One identity with a wallet, a posted ledger entry, and both Stripe mappings. */
function seed(): { userId: string; accountId: string } {
  counter += 1;
  const label = `m3p${counter}`;

  // Wrapped in a CTE because psql prints the `INSERT 0 1` command tag after the
  // returned row, and the bare id is what the following statements interpolate.
  const userId = db.sql(
    `with ins as (insert into auth.users (email) values ('${label}@fixture.test') returning id)` +
      ` select id from ins;`,
  );

  const accountId = db.sql(
    `with ins as (` +
      `insert into public.billing_credit_accounts (user_id, status, posted_credits, reserved_credits)` +
      ` values ('${userId}', 'active', 500, 0) returning id) select id from ins;`,
  );

  db.sql(`
    insert into public.billing_credit_ledger
      (credit_account_id, kind, credit_delta, idempotency_key, reason)
    values ('${accountId}', 'grant', 500, '${label}-grant', 'fixture grant');

    insert into public.billing_stripe_customers (user_id, stripe_customer_id, livemode)
    values ('${userId}', 'cus_${label}', false);

    insert into public.billing_subscriptions
      (user_id, stripe_subscription_id, stripe_customer_id, plan_key, status)
    values ('${userId}', 'sub_${label}', 'cus_${label}', 'builder', 'active');
  `);

  return { userId, accountId };
}

/** Earlier tests leave tombstones behind, so counts are read as deltas. */
function tombstoneCounts(): { accounts: number; customers: number } {
  return {
    accounts: Number(db.sql(`select count(*) from public.billing_credit_accounts where user_id is null;`)),
    customers: Number(db.sql(`select count(*) from public.billing_stripe_customers where user_id is null;`)),
  };
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("M3′ schema shape", () => {
  it("A. all three owner columns are nullable and SET NULL", () => {
    const rows = db.sql(`
      select c.relname || ':' || a.attnotnull::text || ':' || con.confdeltype::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id'
      join pg_constraint con
        on con.conrelid = c.oid and con.contype = 'f' and a.attnum = any (con.conkey)
      where c.relname in
        ('billing_credit_accounts', 'billing_stripe_customers', 'billing_subscriptions')
      order by 1;
    `).split("\n");

    expect(rows).toEqual([
      "billing_credit_accounts:false:n",
      "billing_stripe_customers:false:n",
      "billing_subscriptions:false:n",
    ]);
  });
});

describe("erasing the identity", () => {
  it("B. tombstones the account and leaves the ledger beneath it whole", () => {
    const { userId, accountId } = seed();

    db.sql(`delete from auth.users where id = '${userId}';`);

    expect(db.sql(`select user_id is null from public.billing_credit_accounts where id = '${accountId}';`)).toBe(
      "t",
    );
    // F5's actual stake: the graph under the account, not the account row.
    expect(
      db.sql(
        `select count(*) from public.billing_credit_ledger where credit_account_id = '${accountId}';`,
      ),
    ).toBe("1");
    expect(
      db.sql(`select posted_credits from public.billing_credit_accounts where id = '${accountId}';`),
    ).toBe("500");
  });

  it("C. keeps the Stripe identifiers, which is what P-3 retains them for", () => {
    const { userId } = seed();
    const label = `m3p${counter}`;

    db.sql(`delete from auth.users where id = '${userId}';`);

    expect(
      db.sql(`select user_id is null from public.billing_stripe_customers where stripe_customer_id = 'cus_${label}';`),
    ).toBe("t");
    expect(
      db.sql(`select user_id is null from public.billing_subscriptions where stripe_subscription_id = 'sub_${label}';`),
    ).toBe("t");
  });

  it("D. lets a second erasure tombstone a second account", () => {
    // `billing_credit_accounts_user_idx` is a plain `nulls distinct` unique
    // index on `user_id`, and `billing_stripe_customers_user_mode_idx` is
    // `(user_id, livemode)`. If either were `nulls not distinct`, the second
    // erasure in the product's life would fail on a unique violation — which is
    // the kind of defect that only shows up in production.
    const first = seed();
    const second = seed();
    const before = tombstoneCounts();

    db.sql(`delete from auth.users where id = '${first.userId}';`);
    db.sql(`delete from auth.users where id = '${second.userId}';`);

    const after = tombstoneCounts();
    expect(after.accounts - before.accounts).toBe(2);
    expect(after.customers - before.customers).toBe(2);
  });
});

/* ---------------------------------------------------------------------------
 * Who may run a repair (PERF-011)
 * ------------------------------------------------------------------------ */

/**
 * The repair primitives write the materialized figures the whole Credit
 * balance rests on. Every billing table carries a select policy and
 * deliberately no write policy, so those writes are refused for any role RLS
 * applies to — which is why both functions are granted to `service_role`
 * alone, and why the caller has to be a service-role client.
 *
 * That grant was already correct and the caller was not: the billing page ran
 * the repair with its cookie-scoped client, so with `BILLING_REPAIR_ENABLED`
 * set every drifted account got `42501` and a `credit_drift.repair_failed`
 * row on every render. The caller is fixed in `src/`; this pins the grant, so
 * that the same symptom is never "fixed" the other way round — by opening a
 * financial write to the role a browser holds.
 */
describe("who may repair a materialized balance", () => {
  function acl(fn: string): string {
    return db
      .sql(
        `select coalesce(has_function_privilege('anon', p.oid, 'execute')::text, '?') || '|' ||` +
          ` has_function_privilege('authenticated', p.oid, 'execute')::text || '|' ||` +
          ` has_function_privilege('service_role', p.oid, 'execute')::text` +
          ` from pg_proc p join pg_namespace n on n.oid = p.pronamespace` +
          ` where n.nspname = 'public' and p.proname = '${fn}';`,
      )
      .trim();
  }

  it("is the service role alone, for the account-level repair", () => {
    expect(acl("repair_account_balance")).toBe("false|false|true");
  });

  it("is the service role alone, for the lot-level repair", () => {
    expect(acl("repair_lot_allocation")).toBe("false|false|true");
  });

  /**
   * The primitives they delegate to, for the same reason: a caller that could
   * materialize a ledger entry directly could move a balance without writing
   * the row that justifies it.
   */
  it("is the service role alone, for the primitives they delegate to", () => {
    expect(acl("materialize_ledger_entry")).toBe("false|false|true");
    expect(acl("materialize_reservation_hold")).toBe("false|false|true");
    expect(acl("materialize_allocation_capacity")).toBe("false|false|true");
  });
});
