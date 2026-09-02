# modules/retention

How long each class of data is kept — [ADR 0068](../../../docs/decisions/0068-retention-periods.md) — and what deletes it — [ADR 0069](../../../docs/decisions/0069-retention-sweep-trigger.md).

This module is one file of constants and their reasoning. **It contains no sweep**, because the sweep is a `pg_cron` job inside Postgres: retention needs a clock, and neither a Vercel Workflow nor any read-triggered pattern provides one. Nobody reads a ninety-day-old event, so a read-triggered sweep would reach exactly the rows that do not need deleting; and an activity-amortised sweep never fires for an account that has stopped being active, which is the case GDPR Art. 5(1)(e) is about.

| Class | Period | Enforced |
|---|---|---|
| Operational events | 90 days | yes — `retention_sweep`, daily 03:17 UTC |
| Audit trail | 18 months | yes — same job |
| Financial records | 10 years | **no** — cannot delete anything before 2036 (ADR 0069 §7) |
| Derived intelligence | latest 3 per project | **no** — a count rule, not a clock |

## The duplication this module is one half of

`periods.ts` is the statement of record. `supabase/migrations/*_retention_sweep.sql` carries a second copy of every interval, because SQL cannot import TypeScript. [`sweep.test.ts`](sweep.test.ts) reads both files as text and fails when they disagree — the instrument [Sprint 0118](../../../docs/sprints/0118-what-two-tools-can-hold.md) built for the agent poll interval and the cost divisor that derives from it.

A shared module is not available for the same reason it was not there: one side is SQL.

## What the sweep may not touch

`NEVER_SWEPT_BY_AGE` names eight tables and why each is on the list. It is **not consulted at runtime** — the sweep is an allowlist, so it is already unable to reach them. The list exists so the argument is findable before somebody widens `SWEPT_TABLES`, and so a test can assert the migration never names one.

The two that would be easiest to get wrong:

- **`operation_runs`** is the parent of six `on delete cascade` edges. One deleted row takes `prepared_changes`, `review_artifacts`, `validation_runs`, `preview_sessions` and the whole `agent_execution_runs` subtree with it — the artifacts a human approval binds to under [CLAUDE.md](../../../CLAUDE.md) rule 67. ADR 0068 §5's phrase "the operational body of `operation_runs`" never meant the row.
- **`sandbox_usage_events`** and **`review_browser_usage`** look operational and are billing sources: [`credits/reconciliation.ts`](../credits) projects both into `billing_usage_events`. Deleting them while keeping the charge makes "why was this account charged N credits" unanswerable — [ADR 0056](../../../docs/decisions/0056-lifecycle-erasure-and-retention.md) §7.

## What this does not do

- **It does not make retained audit history readable.** Once `user_id` is null the surviving rows match no RLS policy and are invisible to every application path (ADR 0056 §Deferred P-6). The sweep now deletes them on schedule without changing that.
- **It does not discharge the disclosure obligation.** GDPR Art. 13(2)(a) requires the privacy page to state the periods; two of four classes are enforced, so publishing all four would be a false statement rather than the gap it replaces.
