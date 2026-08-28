-- Mark a gateway request before making it (VB-016).
--
-- ## The race
--
-- The gateway decides whether to forward by reading how much the run has
-- already spent, and that number comes from `ai_usage_events` — which is
-- written **after** the response, in `after()`, because the tokens are not
-- known until the stream ends.
--
-- So two requests arriving together both read the same "already forwarded"
-- count and both pass. Ten arriving together, ten pass. The ceiling the
-- customer approved is a check-then-act on state that lands later, which
-- means it is not a ceiling under concurrency — it is a delay.
--
-- ## What this changes
--
-- A counter incremented *before* the credential is injected, in one statement
-- Postgres serializes, returning the value it wrote. The caller compares that
-- return against the authorized maximum: the observation decides, not the read
-- that preceded it (rule 73's shape, one layer down).
--
-- Never decremented. A run that crashed mid-request has still consumed an
-- attempt, and a counter that gave attempts back on failure would be a
-- counter an unreliable network could reset. Attempts is also exactly what
-- `maxRequests` has always meant — `forwardedRequests` counts usage rows for
-- successes and failures alike.
--
-- ## Why the ledger is still read
--
-- Because it holds the *tokens*, and because a run that started before this
-- column existed has a zero in it. The state read takes the larger of the two,
-- so the counter can only ever tighten the ceiling, never loosen it.
--
-- ## Security model
--
-- `SECURITY INVOKER`, `SET search_path = ''`, no dynamic SQL. The only caller
-- is the gateway route's service-role client — the sandbox has no session at
-- all, which is why rule 53 confines this to `operations/`. Executable by
-- nobody else: a Data API caller who could increment this could exhaust
-- another run's authorization.

alter table public.agent_execution_runs
  add column if not exists gateway_requests_started integer not null default 0;

comment on column public.agent_execution_runs.gateway_requests_started is
  'Gateway requests claimed before forwarding (VB-016). Monotonic; never decremented. Counts attempts, which is what the authorized request ceiling has always meant.';

create or replace function public.claim_gateway_request(p_run_id uuid)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.agent_execution_runs
     set gateway_requests_started = gateway_requests_started + 1
   where id = p_run_id
  returning gateway_requests_started;
$$;

comment on function public.claim_gateway_request(uuid) is
  'Claims one Agent Gateway request before the credential is injected, returning the resulting count (VB-016). One serialized statement, so concurrent requests cannot both read the same total and both pass.';

revoke execute on function public.claim_gateway_request(uuid) from public, anon, authenticated;
grant execute on function public.claim_gateway_request(uuid) to service_role;
