-- Sprint 10B-3, after the first real preview dogfood.
--
-- ADR 0016 recorded that preview teardown runs inline, on the reasoning that it
-- is two provider calls and two writes, well under ADR 0013's durability
-- threshold. The first real stop disproved it — not on latency, on authority.
--
-- `sandbox_usage_events` is deliberately non-client-writable: RLS grants SELECT
-- only, because "a ledger the client can write is not a ledger". An inline stop
-- runs in the request with the cookie-scoped client, so its ledger insert was
-- refused by RLS and swallowed. The preview stopped correctly, the snapshot was
-- deleted correctly, and the provider spend was recorded nowhere.
--
-- The threshold that matters was never duration. It is whether a step needs the
-- privileged writer. Teardown does, so teardown is durable execution.

alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview',
    -- Manual stop and expiry converge on one idempotent teardown.
    'preview_teardown'
  ));

-- Why a preview is ending, decided by whoever initiated it.
--
-- Persisted rather than passed as a workflow argument, for the same reason
-- every other step re-derives its world from the database: what crosses a
-- durable step boundary is an operation id, and nothing else (CLAUDE.md rule
-- 52). Deriving it later from `expires_at` would have been free and wrong — a
-- manual stop seconds before the deadline would converge, after queue latency,
-- as an expiry.
alter table public.preview_sessions
  add column teardown_reason text
    check (teardown_reason is null or teardown_reason in ('stopped', 'expired'));

comment on column public.preview_sessions.teardown_reason is
  'Why teardown was requested. Set when it is initiated; becomes the terminal status.';
