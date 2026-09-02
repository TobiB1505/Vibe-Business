-- The daily retention sweep (ADR 0069).
--
-- ## Why this is in the database at all
--
-- ADR 0068 decided four retention periods and deliberately no mechanism, so
-- until this migration nothing deleted a row on account of its age and the
-- policy was a document. GDPR Art. 5(1)(e) is not discharged by the data being
-- small, and Art. 13(2)(a) requires publishing the periods — which cannot
-- honestly happen before something honours them.
--
-- Retention needs a clock. The two options this project had were `pg_cron` and
-- a Vercel Cron hitting a route; ADR 0069 §1 chose `pg_cron`, because deleting
-- rows is a database operation and the alternative's cost is an authenticated,
-- internet-reachable endpoint whose only job is to destroy data. It also keeps
-- running while the application is paused, mid-deploy or rolled back.
--
-- The option ADR 0068 §D-2 nominated first — read-triggered sweeping, the
-- pattern `expireStaleOperation` uses — was evaluated and does not fit: nobody
-- reads a ninety-day-old event, so it would reach exactly the rows that do not
-- need deleting. Any activity-amortised variant fails harder, because it never
-- fires for an account that has stopped being active, which is the case
-- Art. 5(1)(e) is about.
--
-- ## The periods are a second copy
--
-- `src/modules/retention/periods.ts` is the statement of record (ADR 0068 §7
-- puts them in code and nowhere else). SQL cannot import it, so the intervals
-- below are duplicated and `src/modules/retention/sweep.test.ts` reads both
-- files as text and fails when they disagree — the instrument Sprint 0118 built
-- for the agent poll interval and the cost divisor derived from it.
--
-- ## What this may not touch, and why it is an allowlist
--
-- The five tables below are named explicitly and nothing else is reachable. The
-- sweep follows no `on delete` edge and relies on no cascade, which is what
-- makes the exclusions an absence rather than a rule somebody has to remember:
--
--   * `operation_runs` is the parent of six `on delete cascade` edges. Deleting
--     one row takes `prepared_changes`, `review_artifacts`, `validation_runs`,
--     `preview_sessions` and the whole `agent_execution_runs` subtree with it —
--     the artifacts a human approval binds to under CLAUDE.md rule 67. ADR 0068
--     §5's "the operational body of `operation_runs`" never meant the row, and
--     no age sweep of it is authorized at any period.
--   * `sandbox_usage_events` and `review_browser_usage` look operational and
--     are billing sources: `credits/reconciliation.ts` projects both into
--     `billing_usage_events`. Deleting them while keeping the charge makes
--     "why was this account charged N credits" unanswerable (ADR 0056 §7).
--   * the billing graph is never partially deleted. `repair_account_balance`
--     re-materializes rows where `materialized_at is null`, and a deleted row
--     is invisible rather than null-marked, so `posted_credits` would stay
--     overstated with no repair path (ADR 0056 F5).
--
-- ## The clock is `created_at`
--
-- Three of these tables also carry `occurred_at` and one carries `started_at`.
-- Those say when the event happened and are supplied by the writer; `created_at`
-- defaults to `now()` and says how long Vibe has held the row, which is the
-- question retention asks. No index is added on it: five indexes maintained on
-- every insert into the highest-write tables, to serve one delete a day with no
-- latency requirement, is the wrong trade at this volume (ADR 0069, and the
-- audit's own DEAD-015 counting 83 unused indexes already).
--
-- ## Security model
--
-- `SECURITY INVOKER`, and `EXECUTE` revoked from every Data API role.
-- `pg_cron` runs the job as the database owner, which is the only caller.
-- `SECURITY DEFINER` was considered and rejected: it would add nothing, since
-- cron is already privileged, while creating a function that deletes data and
-- can be invoked by whoever reaches it (CLAUDE.md rule 11).

create extension if not exists pg_cron;

create or replace function public.retention_sweep()
returns table (swept_table text, rows_deleted bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted bigint;
begin
  delete from public.agent_execution_events where created_at < now() - interval '90 days';
  get diagnostics deleted = row_count;
  swept_table := 'agent_execution_events'; rows_deleted := deleted; return next;

  delete from public.agent_activity_events where created_at < now() - interval '90 days';
  get diagnostics deleted = row_count;
  swept_table := 'agent_activity_events'; rows_deleted := deleted; return next;

  delete from public.agent_tool_events where created_at < now() - interval '90 days';
  get diagnostics deleted = row_count;
  swept_table := 'agent_tool_events'; rows_deleted := deleted; return next;

  delete from public.product_scan_events where created_at < now() - interval '90 days';
  get diagnostics deleted = row_count;
  swept_table := 'product_scan_events'; rows_deleted := deleted; return next;

  delete from public.audit_events where created_at < now() - interval '18 months';
  get diagnostics deleted = row_count;
  swept_table := 'audit_events'; rows_deleted := deleted; return next;
end;
$$;

comment on function public.retention_sweep() is
  'Daily retention sweep (ADR 0069). Deletes only from the five tables named in its body; '
  'never from operation_runs, any billing source, or any table reached by a cascade.';

revoke all on function public.retention_sweep() from public;
revoke all on function public.retention_sweep() from anon;
revoke all on function public.retention_sweep() from authenticated;
revoke all on function public.retention_sweep() from service_role;

-- Scheduled from the migration rather than the dashboard, so the repository
-- states the schedule and a job unscheduled out of band is a divergence that
-- can be looked for (rule 34). Daily at 03:17 UTC — off the hour deliberately,
-- because hourly boundaries are when every other scheduled thing runs.
--
-- `unschedule` first so re-applying this migration converges rather than
-- raising on the duplicate job name.
select cron.unschedule('retention_sweep')
where exists (select 1 from cron.job where jobname = 'retention_sweep');

select cron.schedule('retention_sweep', '17 3 * * *', 'select public.retention_sweep()');
