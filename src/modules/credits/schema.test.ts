import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import {
  COST_STATUSES,
  CREDIT_LEDGER_KINDS,
  QUOTE_STATUSES,
  RATING_STATUSES,
  RESERVATION_STATUSES,
  USAGE_SKUS,
  USAGE_SOURCE_KINDS,
  SKU_UNITS,
} from "./schema";
import { RELEASE_REASONS } from "./balance";

/**
 * The TypeScript unions and the SQL CHECKs are the same rule, written twice
 * (BILLING CORE-1 §47).
 *
 * The in-memory test database does not evaluate constraints, so no behavioural
 * test can see a union and a CHECK disagree — and this project has been bitten
 * by exactly that twice before. On billing the failure mode is worse than a
 * broken screen: a `kind` TypeScript permits and Postgres rejects would fail
 * every INSERT of a charge, and a value Postgres permits and TypeScript does
 * not would let a financial state exist that no code can read.
 */

const sql = () => migrationSql().join("\n");

describe("billing enums match their CHECK constraints", () => {
  it("pins billing_credit_ledger.kind", () => {
    expect(checkedValues("billing_credit_ledger", "kind").sort()).toEqual([...CREDIT_LEDGER_KINDS].sort());
  });

  it("pins billing_credit_reservations.status", () => {
    expect(checkedValues("billing_credit_reservations", "status").sort()).toEqual(
      [...RESERVATION_STATUSES].sort(),
    );
  });

  it("pins billing_credit_reservations.release_reason", () => {
    expect(checkedValues("billing_credit_reservations", "release_reason").sort()).toEqual(
      [...RELEASE_REASONS].sort(),
    );
  });

  it("pins billing_credit_quotes.status", () => {
    expect(checkedValues("billing_credit_quotes", "status").sort()).toEqual([...QUOTE_STATUSES].sort());
  });

  it("pins billing_usage_events.source_kind", () => {
    expect(checkedValues("billing_usage_events", "source_kind").sort()).toEqual(
      [...USAGE_SOURCE_KINDS].sort(),
    );
  });

  it("pins billing_usage_events.sku", () => {
    expect(checkedValues("billing_usage_events", "sku").sort()).toEqual([...USAGE_SKUS].sort());
  });

  it("pins billing_usage_events.cost_status", () => {
    expect(checkedValues("billing_usage_events", "cost_status").sort()).toEqual([...COST_STATUSES].sort());
  });

  it("pins billing_usage_events.rating_status", () => {
    expect(checkedValues("billing_usage_events", "rating_status").sort()).toEqual(
      [...RATING_STATUSES].sort(),
    );
  });

  it("gives every SKU a declared physical unit", () => {
    for (const sku of USAGE_SKUS) {
      expect(SKU_UNITS[sku]).toBeDefined();
    }
  });
});

/**
 * The named constraints the domain's guarantees actually rest on.
 *
 * Asserted by name rather than by behaviour because the fake database cannot
 * evaluate them — if one were dropped in a future migration, only this test
 * would notice.
 */
describe("the financial invariants exist in the database", () => {
  it("makes an overspend structurally impossible", () => {
    expect(sql()).toContain("billing_credit_accounts_available_non_negative");
  });

  it("forbids a zero-delta ledger entry", () => {
    expect(sql()).toContain("credit_delta bigint not null check (credit_delta <> 0)");
  });

  it("ties a ledger entry's sign to its kind", () => {
    expect(sql()).toContain("billing_credit_ledger_sign_matches_kind");
  });

  it("requires a refund to name the charge it compensates", () => {
    expect(sql()).toContain("billing_credit_ledger_refund_references_charge");
  });

  it("requires a manual adjustment to carry a reason", () => {
    expect(sql()).toContain("billing_credit_ledger_adjustment_has_reason");
  });

  /** §26 — exactly-once, enforced by an index rather than an application check. */
  it("makes a duplicate financial write impossible", () => {
    expect(sql()).toContain("billing_credit_ledger_idempotency_idx");
    expect(sql()).toContain("billing_credit_reservations_idempotency_idx");
  });

  /** §28 — the ceiling the customer approved. */
  it("forbids settling above the reserved maximum", () => {
    expect(sql()).toContain("billing_credit_reservations_settled_within_reserved");
  });

  it("forbids a quote whose estimate exceeds its own ceiling", () => {
    expect(sql()).toContain("billing_credit_quotes_maximum_covers_estimate");
  });

  /**
   * §18, and the reason it is a constraint rather than a convention: this is
   * what makes "unknown cost became zero credits" unrepresentable. Rated
   * credits exist if and only if the rating actually happened.
   */
  it("makes unknown-became-zero unrepresentable", () => {
    expect(sql()).toContain("billing_usage_events_rated_has_credits");
    expect(sql()).toContain("billing_usage_events_costed_has_amount");
  });

  /** §43 — running reconciliation twice must not duplicate usage. */
  it("makes duplicate usage projection impossible", () => {
    expect(sql()).toContain("billing_usage_events_source_sku_idx");
  });

  it("allows at most one active reservation per operation", () => {
    expect(sql()).toContain("billing_credit_reservations_single_active_operation_idx");
  });
});

/**
 * §31, §32 — the client cannot mint Credits.
 *
 * Access control in this schema is RLS policies plus deliberate omission, and
 * there are no GRANT statements anywhere in the migration history. So the
 * assertion is that each billing table has exactly one policy, and it is a
 * SELECT: an insert or update policy on any of them would be a browser-writable
 * balance.
 */
describe("no client-writable financial surface", () => {
  const TABLES = [
    "billing_credit_accounts",
    "billing_credit_ledger",
    "billing_credit_reservations",
    "billing_credit_quotes",
    "billing_usage_events",
  ];

  it("declares only select policies on billing tables", () => {
    const billingSql = migrationSql()
      .filter((file) => file.includes("billing_credit_accounts"))
      .join("\n");

    for (const table of TABLES) {
      const policies = [
        ...billingSql.matchAll(new RegExp(`create policy "[^"]+"\\s*\\n\\s*on public\\.${table}\\s*\\n\\s*for (\\w+)`, "gi")),
      ].map((match) => match[1].toLowerCase());

      expect(policies.length).toBeGreaterThan(0);
      expect(policies).toEqual(policies.map(() => "select"));
    }
  });

  it("enables row level security on every billing table", () => {
    for (const table of TABLES) {
      expect(sql()).toContain(`alter table public.${table} enable row level security`);
    }
  });
});
