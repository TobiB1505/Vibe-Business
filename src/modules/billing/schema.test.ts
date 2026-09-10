import { describe, expect, it } from "vitest";
import { migrationSql } from "@/modules/operations/migration-test-support";
import { CREDIT_SOURCE_KINDS } from "@/modules/credits/lots";
import { CREDIT_LEDGER_KINDS } from "@/modules/credits/schema";

/**
 * The Core-2 schema's guarantees, read out of the migration itself
 * (BILLING CORE-2 §64, §99, §100).
 *
 * ## Why assert against SQL text
 *
 * A TypeScript union and a SQL CHECK state the same rule in two places nothing
 * forces to agree, and the in-memory test database does not evaluate
 * constraints. This repository has been bitten by that drift twice already —
 * see `migration-test-support.ts`. For financial tables the stakes are higher
 * still: a missing unique index does not fail a test, it double-grants a
 * customer in production.
 */

/** Only the Core-2 migration — the Core-1 one has its own assertions. */
function coreTwoSql(): string {
  return migrationSql()
    .filter((file) => file.includes("billing_credit_grants"))
    .join("\n");
}

const sql = coreTwoSql();

describe("enums match their CHECK constraints", () => {
  it("permits exactly the declared Credit source kinds", () => {
    const match = /source_kind text not null check \(\s*source_kind in \(([^)]*)\)/m.exec(sql);
    expect(match, "source_kind CHECK not found").not.toBeNull();

    const permitted = match![1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();

    expect(permitted).toEqual([...CREDIT_SOURCE_KINDS].sort());
  });

  it("permits exactly the declared ledger kinds, including expiry", () => {
    // The kind CHECK was replaced by this migration to add `expiry`. A drift
    // here means either an expiry entry cannot be written, or a kind exists in
    // the database that no code knows how to render.
    const match = /billing_credit_ledger_kind_check\s*\n\s*check \(kind in \(([^)]*)\)\)/m.exec(sql);
    expect(match, "ledger kind CHECK not found").not.toBeNull();

    const permitted = match![1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();

    expect(permitted).toEqual([...CREDIT_LEDGER_KINDS].sort());
  });

  it("requires an expiry entry to be negative", () => {
    // An expiry that could be positive would be a way to mint Credits.
    expect(sql).toContain("kind in ('charge', 'expiry') and credit_delta < 0");
  });

  it("permits exactly the two paid plans", () => {
    expect(sql).toContain("plan_key text not null check (plan_key in ('builder', 'pro'))");
  });
});

describe("the Core-2 financial invariants exist in the database", () => {
  it("makes over-allocating a Credit lot structurally impossible", () => {
    // The lot-level equivalent of billing_credit_accounts_available_non_negative.
    expect(sql).toContain("billing_credit_grants_capacity_not_exceeded");
  });

  it("allows one lot per ledger entry, so a replayed grant cannot mint a second", () => {
    expect(sql).toContain("billing_credit_grants_ledger_entry_idx");
    expect(sql).toContain("create unique index billing_credit_grants_ledger_entry_idx");
  });

  it("forbids consuming more of a lot than was held", () => {
    expect(sql).toContain("billing_credit_allocations_consumed_within_held");
  });

  it("ties an allocation's consumed amount to its status", () => {
    expect(sql).toContain("billing_credit_allocations_consumed_has_amount");
    expect(sql).toContain("billing_credit_allocations_consumed_has_timestamp");
    expect(sql).toContain("billing_credit_allocations_released_has_timestamp");
  });

  it("lets only an expiring lot expire", () => {
    // A purchased lot has no expiry date and must never acquire one.
    expect(sql).toContain("billing_credit_grants_expired_had_a_date");
    expect(sql).toContain("billing_credit_grants_expired_has_timestamp");
  });

  it("lets only a subscription lot claim a billing period", () => {
    expect(sql).toContain("billing_credit_grants_period_matches_kind");
  });

  it("makes a replayed Stripe event structurally unable to grant twice (§28)", () => {
    expect(sql).toContain("create unique index billing_stripe_events_stripe_id_idx");
  });

  it("allows one Stripe customer per owner, and one owner per Stripe customer (§24)", () => {
    expect(sql).toContain("create unique index billing_stripe_customers_user_mode_idx");
    expect(sql).toContain("create unique index billing_stripe_customers_stripe_id_idx");
  });

  it("allows one row per Stripe subscription", () => {
    expect(sql).toContain("create unique index billing_subscriptions_stripe_id_idx");
  });
});

/**
 * §64, §65 — the client cannot mint Credits, change an expiry, or point its
 * account at somebody else's Stripe customer.
 *
 * Access control here is RLS plus deliberate omission: there are no GRANTs in
 * the migration history, so a table with only a SELECT policy is readable by
 * its owner and writable by nobody but the service role.
 */
describe("no client-writable financial surface", () => {
  const OWNER_READABLE = [
    "billing_credit_grants",
    "billing_credit_allocations",
    "billing_stripe_customers",
    "billing_subscriptions",
  ];

  it("declares only select policies on every new billing table", () => {
    for (const table of OWNER_READABLE) {
      const policies = [
        ...sql.matchAll(
          new RegExp(`create policy "[^"]+"\\s*\\n\\s*on public\\.${table}\\s*\\n\\s*for (\\w+)`, "gi"),
        ),
      ].map((match) => match[1].toLowerCase());

      expect(policies.length, `${table} has no policy`).toBeGreaterThan(0);
      expect(policies, `${table} has a write policy`).toEqual(policies.map(() => "select"));
    }
  });

  it("enables row level security on every new billing table", () => {
    for (const table of [...OWNER_READABLE, "billing_stripe_events"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("gives billing_stripe_events no policy at all, not even select", () => {
    // Vibe's operational record of its payment provider's traffic. It belongs
    // to no customer, so no customer reads it.
    const policies = [
      ...sql.matchAll(/create policy "[^"]+"\s*\n\s*on public\.billing_stripe_events/gi),
    ];
    expect(policies).toHaveLength(0);
  });

  it("scopes every owner-readable policy to the authenticated user", () => {
    // A policy that read `using (true)` would be a cross-customer billing leak.
    for (const table of OWNER_READABLE) {
      const policy = new RegExp(
        `on public\\.${table}\\s*\\n\\s*for select using \\(([\\s\\S]*?)\\);`,
        "i",
      ).exec(sql);

      expect(policy, `${table} select policy not found`).not.toBeNull();
      expect(policy![1]).toContain("auth.uid()");
      expect(policy![1]).not.toMatch(/using\s*\(\s*true\s*\)/i);
    }
  });
});

describe("performance (§100)", () => {
  it("indexes the allocator's hot path in spend order", () => {
    // Expiring soonest first, oldest first within that, non-expiring last —
    // the spend policy expressed as an index.
    expect(sql).toContain("billing_credit_grants_spend_order_idx");
    expect(sql).toContain("expires_at asc nulls last");
  });

  it("indexes the expiry sweep, so due lots are found without a scan", () => {
    expect(sql).toContain("billing_credit_grants_due_idx");
  });

  it("indexes reservation and account lookups for allocations", () => {
    expect(sql).toContain("billing_credit_allocations_reservation_idx");
    expect(sql).toContain("billing_credit_allocations_grant_status_idx");
  });

  it("indexes the external payment identities a webhook resolves", () => {
    expect(sql).toContain("billing_credit_grants_external_reference_idx");
    expect(sql).toContain("billing_subscriptions_user_idx");
  });
});

describe("what the schema deliberately does not store (§21, §67)", () => {
  it("has no column for a payment instrument, a card or a Stripe secret", () => {
    for (const forbidden of [
      "card_number",
      "card_last4",
      "payment_method_details",
      "stripe_secret",
      "webhook_signature",
      "client_secret",
    ]) {
      expect(sql, `schema declares ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("has no column for a raw webhook payload", () => {
    // §67: an id, a type and a status is the minimum that makes replay
    // idempotent and debugging possible. A payload column would duplicate
    // customer and payment data Vibe has no reason to hold.
    const eventsTable = /create table public\.billing_stripe_events \(([\s\S]*?)\n\);/m.exec(sql);
    expect(eventsTable).not.toBeNull();

    for (const forbidden of ["payload", "raw_event", "body", "data jsonb"]) {
      expect(eventsTable![1], `events table declares ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("stores no money amount on a Credit lot", () => {
    // A lot records Credits and an external identifier. What the customer paid
    // in euro is Stripe's record, not Vibe's second copy of it.
    const grantsTable = /create table public\.billing_credit_grants \(([\s\S]*?)\n\);/m.exec(sql);
    expect(grantsTable).not.toBeNull();

    for (const forbidden of ["amount_cents", "currency", "price_cents", "amount_paid"]) {
      expect(grantsTable![1], `grants table declares ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("migration safety (§98)", () => {
  it("adds only forward changes — no drop table, no delete", () => {
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("drops only the two constraints it immediately replaces", () => {
    // Replacing a CHECK is how a new enum value is added. Both are re-added in
    // the same migration, and nothing else is dropped.
    const drops = [...sql.matchAll(/drop constraint (\w+)/gi)].map((match) => match[1]);
    expect(drops.sort()).toEqual([
      "billing_credit_ledger_kind_check",
      "billing_credit_ledger_sign_matches_kind",
    ]);

    for (const dropped of drops) {
      expect(sql, `${dropped} was dropped but not re-added`).toContain(`add constraint ${dropped}`);
    }
  });
});
