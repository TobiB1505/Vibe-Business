import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startCluster, type Cluster } from "./harness";

/**
 * The occupancy rule, where it now lives (PERF-018).
 *
 * ## Why this file exists
 *
 * `reconcileLotAllocation` used to apply the rule in TypeScript over every
 * allocation row an account had ever accumulated — a read with no bound, behind
 * `max_rows = 1000`, which truncates without an error. A truncated read makes
 * `expected` too low and the reconciliation report a **drift that does not
 * exist**: an operator alert on every visit to the billing page, a false
 * `credit_drift.detected`, a service-role repair for nothing, and a
 * `repair_failed` on the re-check against the same short list.
 *
 * Moving the sum into `sum_lot_allocation_capacity` fixes that and moves the
 * rule out of a language with a test suite into one without. **So its test
 * moves with it.** `lots.test.ts` keeps the comparison, which is all that
 * function still decides; the arithmetic is proved here, against a real
 * PostgreSQL, and that is also what makes the fake client's handler in
 * `operations/test-support.ts` a model rather than a second implementation
 * nobody checked.
 *
 * ## What is deliberately not asserted here
 *
 * That RLS confines it. The function is `SECURITY INVOKER`, so visibility is
 * decided by the same policies a direct select goes through, and
 * `cross-tenant.migration.ts` is where that class of claim is proved for the
 * billing tables as a whole. Restating it here would test the policies twice
 * and the function not at all.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let label = 0;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 300_000);

afterAll(() => db?.stop());

/** One account with one lot, and nothing allocated against it yet. */
function lot(initial: number): { accountId: string; grantId: string } {
  label += 1;
  const tag = `cap${label}`;

  const userId = db.sql(
    `with ins as (insert into auth.users (email) values ('${tag}@fixture.test') returning id) select id from ins;`,
  );
  const accountId = db.sql(
    `with ins as (insert into public.billing_credit_accounts (user_id, status, posted_credits, reserved_credits)` +
      ` values ('${userId}', 'active', ${initial}, 0) returning id) select id from ins;`,
  );
  const entryId = db.sql(
    `with ins as (insert into public.billing_credit_ledger (credit_account_id, kind, credit_delta, idempotency_key, reason)` +
      ` values ('${accountId}', 'grant', ${initial}, '${tag}-grant', 'fixture') returning id) select id from ins;`,
  );
  const grantId = db.sql(
    `with ins as (insert into public.billing_credit_grants (credit_account_id, ledger_entry_id, source_kind, initial_credit_units)` +
      ` values ('${accountId}', '${entryId}', 'welcome', ${initial}) returning id) select id from ins;`,
  );

  return { accountId, grantId };
}

/** One allocation in a given state against a lot. */
function allocate(
  ids: { accountId: string; grantId: string },
  status: "held" | "consumed" | "released",
  creditUnits: number,
  consumedUnits: number | null,
): void {
  label += 1;
  const reservationId = db.sql(
    `with ins as (insert into public.billing_credit_reservations (credit_account_id, reserved_credits, idempotency_key, status)` +
      ` values ('${ids.accountId}', ${creditUnits}, 'res${label}', 'active') returning id) select id from ins;`,
  );

  // The CHECKs are biconditionals: consumed ⟺ consumed_units, consumed ⟺
  // settled_at, released ⟺ released_at. A fixture that set only the status
  // would be rejected, which is itself worth knowing — see the last test here.
  db.sql(
    `insert into public.billing_credit_allocations` +
      ` (grant_id, credit_account_id, reservation_id, credit_units, status, consumed_units, settled_at, released_at)` +
      ` values ('${ids.grantId}', '${ids.accountId}', '${reservationId}', ${creditUnits}, '${status}',` +
      ` ${consumedUnits === null ? "null" : consumedUnits},` +
      ` ${status === "consumed" ? "now()" : "null"},` +
      ` ${status === "released" ? "now()" : "null"});`,
  );
}

function occupied(grantId: string): string {
  return db.sql(
    `select occupied_units from public.sum_lot_allocation_capacity(array['${grantId}']::uuid[]);`,
  );
}

describe("what an allocation occupies, by its state", () => {
  it("counts a held allocation at its full amount", () => {
    const ids = lot(500);
    allocate(ids, "held", 300, null);
    expect(occupied(ids.grantId)).toBe("300");
  });

  it("counts a consumed allocation at what it charged, not what it held", () => {
    // The one that matters for money: an operation that reserved 300 and spent
    // 120 must release the difference back into the lot's capacity. Summing
    // `credit_units` here would keep 180 Credits permanently unusable.
    const ids = lot(500);
    allocate(ids, "consumed", 300, 120);
    expect(occupied(ids.grantId)).toBe("120");
  });

  it("counts a released allocation at nothing", () => {
    const ids = lot(500);
    allocate(ids, "released", 300, null);
    expect(occupied(ids.grantId)).toBe("0");
  });

  it("cannot be asked about a consumed allocation with no recorded charge", () => {
    // Written as a test of the aggregate's `coalesce(consumed_units, 0)` and
    // turned into this, because the state it defends against **cannot exist**:
    // `consumed_has_amount` is a biconditional, so `status = 'consumed'` and a
    // null charge is rejected at INSERT.
    //
    // The coalesce stays — it is one function call, it mirrors the `?? ZERO`
    // this replaced, and a CASE that returns null for one row would turn the
    // whole lot's sum into null, which the caller reads as "occupies nothing"
    // for a lot that is fully allocated. But it is unreachable, and a comment
    // claiming it guards a real case would be false.
    const ids = lot(500);
    label += 1;
    const reservationId = db.sql(
      `with ins as (insert into public.billing_credit_reservations (credit_account_id, reserved_credits, idempotency_key, status)` +
        ` values ('${ids.accountId}', 300, 'res${label}', 'active') returning id) select id from ins;`,
    );

    expect(() =>
      db.sql(
        `insert into public.billing_credit_allocations (grant_id, credit_account_id, reservation_id, credit_units, status, settled_at)` +
          ` values ('${ids.grantId}', '${ids.accountId}', '${reservationId}', 300, 'consumed', now());`,
      ),
    ).toThrow(/consumed_has_amount/);
  });

  it("sums the three states together", () => {
    // The exact case that left `lots.test.ts` when the rule moved: 20 held plus
    // 30 charged of a 40 hold plus a 10 release occupies 50.
    const ids = lot(500);
    allocate(ids, "held", 20, null);
    allocate(ids, "consumed", 40, 30);
    allocate(ids, "released", 10, null);
    expect(occupied(ids.grantId)).toBe("50");
  });
});

describe("grouping and absence", () => {
  it("keeps two lots apart", () => {
    const first = lot(500);
    const second = lot(500);
    allocate(first, "held", 300, null);
    allocate(second, "held", 50, null);

    const rows = db.sql(
      `select grant_id || '=' || occupied_units from public.sum_lot_allocation_capacity(` +
        `array['${first.grantId}','${second.grantId}']::uuid[]) order by 1;`,
    );

    expect(rows).toContain(`${first.grantId}=300`);
    expect(rows).toContain(`${second.grantId}=50`);
  });

  it("returns no row at all for a lot nothing has allocated against", () => {
    // Absent, not zero. `group by` cannot emit a row for a lot with no
    // allocations, and the caller's `?? ZERO_CREDITS` is what says so — a
    // function that invented the zero would let a caller forget that.
    const ids = lot(500);
    expect(occupied(ids.grantId)).toBe("");
  });

  it("ignores allocations belonging to a lot that was not asked for", () => {
    const asked = lot(500);
    const other = lot(500);
    allocate(other, "held", 999, null);

    expect(occupied(asked.grantId)).toBe("");
  });
});
