-- A row-level read of one agent run's AI usage events, for the execution-cost
-- inspector on the agent page (VIBE-BUSINESS-PROJECT-1 / -3).
--
-- ## The bug this closes
--
-- `readExecutionEconomics` selected directly from `ai_usage_events` with the
-- caller's session-scoped client. `authenticated` was never granted `select`
-- on that table — only a since-revoked `insert` (`wave2_database_hygiene`) —
-- so every render of the cost inspector for a run that had spent anything
-- failed with `42501`, and Next.js's Server Component boundary reported it as
-- a digest-only render error on top.
--
-- ## Security model
--
-- `SECURITY INVOKER`, matching `sum_agent_run_usage`: this function moves a
-- read to the database, not an authority. `ai_usage_events` has been
-- deliberately unreachable through the Data API since the Wave 1 privilege
-- work, and stays that way here — `authenticated` is revoked explicitly, the
-- same as the table's other function. The only caller is
-- `readExecutionEconomics`, invoked with the service-role client from a
-- reviewed site (`src/modules/coding-agent/economics/store.ts`, entered in
-- `service-boundary.test.ts`'s `REVIEWED_SITES`); ownership of `p_project_id`
-- was already established a moment earlier by the caller's own RLS-scoped
-- read of the operation row, filtered by both the project id and the
-- session's user id together.
--
-- `SET search_path = ''` with every reference qualified. No dynamic SQL.

create or replace function public.list_ai_usage_events_for_run(p_run_id uuid, p_project_id uuid)
returns table (
  status text,
  input_tokens integer,
  output_tokens integer,
  cache_read_input_tokens integer,
  cache_creation_input_tokens integer,
  thinking_tokens integer,
  provider_cost_usd numeric(18, 9),
  latency_ms integer,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select usage.status,
         usage.input_tokens,
         usage.output_tokens,
         usage.cache_read_input_tokens,
         usage.cache_creation_input_tokens,
         usage.thinking_tokens,
         usage.provider_cost_usd,
         usage.latency_ms,
         usage.created_at
    from public.ai_usage_events usage
   where usage.job_id = p_run_id
     and usage.project_id = p_project_id;
$$;

comment on function public.list_ai_usage_events_for_run(uuid, uuid) is
  'One agent run''s AI usage events, row-level, for the execution-cost inspector. SECURITY INVOKER — see sum_agent_run_usage for the model this follows.';

revoke execute on function public.list_ai_usage_events_for_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_ai_usage_events_for_run(uuid, uuid) to service_role;
