/**
 * How long each class of data is kept, and what the sweep may never touch.
 *
 * [ADR 0068](../../../docs/decisions/0068-retention-periods.md) §7 requires the
 * periods to live as named constants in one module — **not environment
 * variables, not a dashboard setting, not a database table** — because a period
 * that can change without a diff makes ADR 0056 §6's rule against silent policy
 * changes unenforceable by construction. This is that module.
 *
 * ## The numbers below are duplicated in SQL, on purpose
 *
 * The sweep runs as a `pg_cron` job inside Postgres
 * ([ADR 0069](../../../docs/decisions/0069-retention-sweep-trigger.md)), and SQL
 * cannot import TypeScript. So `20260902103614_retention_sweep.sql` carries a
 * second copy of every period here, and `sweep.test.ts` reads both files as text
 * and fails when they disagree — the instrument Sprint 0118 built for the agent
 * poll interval and its cost divisor, for the same reason: two constants that
 * must agree, in two places nothing forces to agree.
 *
 * **This file is the statement of record.** The migration follows it.
 */

/**
 * Operational event streams — the highest write rate, the lowest retained
 * value. Nobody opens a ninety-day-old agent event feed (ADR 0068 §5).
 */
export const OPERATIONAL_EVENT_RETENTION_DAYS = 90;

/**
 * The audit trail. No statute sets a floor; eighteen months is chosen so an
 * incident noticed late still has a full year of prior activity behind it,
 * which is the shape of the question actually asked (ADR 0068 §4).
 */
export const AUDIT_TRAIL_RETENTION_MONTHS = 18;

/**
 * Financial records. **Not a product choice** — HGB §257 and AO §147 require
 * ten years for `Buchungsbelege`, and GDPR Art. 17(3)(b) does not shorten it,
 * which is why an erasure tombstones the billing graph rather than deleting it.
 *
 * Whether a Credit ledger row *is* a `Buchungsbeleg` is open (ADR 0068 §D-1).
 * Ten years is the safe direction to be wrong in: keeping a commercial letter
 * for ten years is lawful, destroying a booking voucher after six is not.
 *
 * **Nothing enforces this yet**, and it cannot delete anything before 2036 —
 * the oldest financial row in this database is dated 2026-08-17. ADR 0069 §7
 * says why writing it now would be worse than not writing it.
 */
export const FINANCIAL_RECORD_RETENTION_YEARS = 10;

/**
 * Derived intelligence — audits, snapshots, plans. **Not an age at all.**
 *
 * An age rule would delete a quiet project's only audit and leave its founder
 * reading "not analysed yet" for work they paid for. Three is the smallest
 * number that shows a change and its predecessor (ADR 0068 §6).
 *
 * **Nothing enforces this yet**: `pg_cron` schedules a clock, and a count rule
 * is not a clock. It also has to respect the RESTRICT edges that keep a cited
 * snapshot alive, which is a per-table analysis rather than one predicate.
 */
export const DERIVED_INTELLIGENCE_RETAINED_PER_PROJECT = 3;

/** The `pg_cron` job name, set by the migration and stable across deploys. */
export const RETENTION_SWEEP_JOB_NAME = "retention_sweep";

/**
 * Daily at 03:17 UTC. Off the hour deliberately — hourly boundaries are when
 * every other scheduled thing in the world runs.
 */
export const RETENTION_SWEEP_SCHEDULE = "17 3 * * *";

/**
 * The tables the sweep deletes from, and nothing else.
 *
 * The sweep never relies on a cascade and never follows an `on delete` edge: a
 * table absent from this list is a table the sweep cannot reach, which is what
 * makes {@link NEVER_SWEPT_BY_AGE} an absence rather than a rule somebody has
 * to remember (ADR 0069 §5).
 *
 * ## Why the clock is `created_at` on every one of them
 *
 * Three of these also carry `occurred_at` and one carries `started_at`, and
 * none of those is the right column. They say when the *event* happened, and
 * they are supplied by the writer — an agent harness reporting its own
 * timeline. `created_at` defaults to `now()` and says how long **Vibe** has
 * held the row, which is the question a retention period asks. It is also the
 * one column all five share, so the sweep is one statement shape rather than
 * four.
 *
 * ## Why none of them is indexed on it, deliberately
 *
 * A `created_at` index on each would be five indexes maintained on every insert
 * into the highest-write tables in the schema, to serve one delete a day that
 * has no latency requirement and currently matches nothing. The audit's own
 * DEAD-015 counted 83 unused-index advisor hits against this database; adding
 * five more to avoid a nightly sequential scan of a few thousand rows is the
 * wrong trade. **Revisit when a swept table passes roughly a million rows**, at
 * which point the scan starts costing more than the writes would.
 *
 * The `interval` strings appear verbatim in the migration and are compared
 * against it by `sweep.test.ts`.
 */
export const SWEPT_TABLES = [
  { table: "agent_execution_events", interval: "90 days" },
  { table: "agent_activity_events", interval: "90 days" },
  { table: "agent_tool_events", interval: "90 days" },
  { table: "product_scan_events", interval: "90 days" },
  { table: "audit_events", interval: "18 months" },
] as const;

/**
 * Tables an age sweep must never delete from, with the reason each one is here.
 *
 * This list is not consulted at runtime — the sweep is an allowlist, so it is
 * already unable to reach any of these. It exists so the next person to widen
 * {@link SWEPT_TABLES} finds the argument before the incident, and so a test
 * can assert the migration never names one.
 */
export const NEVER_SWEPT_BY_AGE = [
  {
    table: "operation_runs",
    reason:
      "Parent of six `on delete cascade` edges. Deleting one row takes prepared_changes, " +
      "review_artifacts, validation_runs, preview_sessions and the agent_execution_runs " +
      "subtree with it — the artifacts a human approval binds to under rule 67.",
  },
  {
    table: "agent_execution_runs",
    reason: "Same cascade, one level down: its own events, tool events and interrupts.",
  },
  {
    table: "sandbox_usage_events",
    reason:
      "A billing source. credits/reconciliation.ts projects it into billing_usage_events, " +
      "so deleting it while keeping the charge makes the charge unexplainable (ADR 0056 §7).",
  },
  {
    table: "review_browser_usage",
    reason: "The same, for visual review browser seconds.",
  },
  {
    table: "ai_usage_events",
    reason: "The same, and the one ADR 0068 §5 already excluded by name.",
  },
  {
    table: "billing_credit_ledger",
    reason:
      "Partial deletion of the billing graph has no repair path: repair_account_balance " +
      "re-materializes rows where materialized_at is null, and a deleted row is invisible " +
      "rather than null-marked, so posted_credits stays overstated forever (ADR 0056 F5). " +
      "The financial sweep, when it exists, acts on a whole tombstoned account at once.",
  },
  {
    table: "billing_usage_events",
    reason: "Financial class, and the same whole-graph constraint.",
  },
  {
    table: "billing_credit_reservations",
    reason: "Financial class, and the same whole-graph constraint.",
  },
] as const;
