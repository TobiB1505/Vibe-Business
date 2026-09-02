-- One agent run's gateway spend, summed in the database (PERF-002).
--
-- ## The read this exists to bound
--
-- `readAgentRunGatewayState` runs on **every** sampling request the Agent
-- Gateway forwards, and it read every `ai_usage_events` row the run had
-- written so far in order to answer two questions about them: how many output
-- tokens the run has spent, and how many requests it has forwarded. Both are
-- aggregates; neither needs a row.
--
-- The cost is quadratic in the length of a run. A run is allowed
-- `maxAgentTurns * 4 + 20` requests — 140, 180 or 260 by tier — so request *n*
-- transferred *n-1* rows and the run transferred roughly n²/2 in total:
-- about 9,800 rows for a small run and 34,000 for a large one, to compute two
-- numbers. `ai_usage_events_job_lookup_idx` makes each read cheap to find; what
-- it cannot do is stop the answer growing.
--
-- There is a second, sharper reason. `supabase/config.toml` sets
-- `max_rows = 1000`, so past a thousand rows PostgREST would have truncated
-- the read **silently** — and a truncated sum is not a slow answer, it is a
-- wrong one, in the direction that under-reports spend against a ceiling.
--
-- ## Why one function rather than two
--
-- Because the caller asks both questions of the same rows in the same breath,
-- and two RPCs would be two round trips from a route that already makes three
-- before it forwards anything.
--
-- ## Why a function rather than a PostgREST aggregate
--
-- Same measured reason as `sum_ledger_deltas`: this project's PostgREST
-- refuses them with `PGRST123, Use of aggregate functions is not allowed`.
--
-- ## Security model
--
-- `SECURITY INVOKER`, following `sum_ledger_deltas` and the precedent
-- `execution_spec_guard_security_invoker.sql` set. This function moves an
-- aggregation to the database; it must not move an authority there. Its only
-- caller is the gateway, which holds a service-role client because a sandbox
-- has no session — and `ai_usage_events` is deliberately unreachable through
-- the Data API at all since the Wave 1 privilege work, so there is no lower
-- privileged caller to grant anything to. `authenticated` is revoked
-- explicitly rather than left to the default, and the grant is as load-bearing
-- as the revoke: sprint 0106 shipped a revoke without one and the caller
-- failed open in silence.
--
-- `SET search_path = ''` with every reference qualified. No dynamic SQL.

create or replace function public.sum_agent_run_usage(p_run_id uuid)
returns table (spent_output_tokens bigint, forwarded_requests bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(usage.output_tokens), 0)::bigint,
         count(*)::bigint
    from public.ai_usage_events usage
   where usage.job_id = p_run_id;
$$;

comment on function public.sum_agent_run_usage(uuid) is
  'One agent run''s spent output tokens and forwarded request count, aggregated in the database rather than by transferring every usage row on every gateway request (PERF-002). Counts every row the run wrote, succeeded or failed: a stream that dies after the provider emitted tokens was still billed for them (VB-016). SECURITY INVOKER.';

revoke execute on function public.sum_agent_run_usage(uuid) from public, anon, authenticated;
grant execute on function public.sum_agent_run_usage(uuid) to service_role;
