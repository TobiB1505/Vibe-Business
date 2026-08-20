-- ---------------------------------------------------------------------
-- agent_execution_events
-- ---------------------------------------------------------------------
-- What an agent execution did, as it did it.
--
-- Runs #1 and #2 both had to be reconstructed after the fact from four
-- different tables plus platform logs, to answer questions as basic as "which
-- command was it running when it stopped" and "why did the second run cost
-- twice the first". Neither question has a durable answer today.
--
-- This is that answer. It does not duplicate any existing state: token counts
-- stay in ai_usage_events, CPU and egress in sandbox_usage_events, the run's
-- own terminal facts in agent_execution_runs. What is recorded here is the
-- *sequence* — which nothing else holds, because a state column can only ever
-- say where a run is now.
--
-- ## Why not agent_activity_events
--
-- That table is deliberately a closed customer vocabulary with counts and no
-- message column, so "a schema that cannot express a sentence cannot leak a
-- reasoning trace". Widening it to carry commands, durations, exit codes and
-- costs would erase exactly that property. This table subsumes it instead: the
-- customer timeline is `where audience = 'customer'`, a projection rather than
-- a second write.
--
-- ## What may never be in here
--
-- Model reasoning, in any form — there is no free-text column the harness
-- controls. `summary` is composed by Vibe from a closed vocabulary; `metadata`
-- is a bounded key/value map of measurements. Repository file *contents* never
-- appear: a path and a byte count describe a file without copying it. Secrets
-- are stripped in code before the write (`redactSecrets`) and bounded again
-- here, because the repository supplying the file names is untrusted.

create table public.agent_execution_events (
  id uuid primary key default gen_random_uuid(),

  agent_execution_run_id uuid not null
    references public.agent_execution_runs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Denormalized so a service-role workflow step has a trusted owner to filter
  -- on, and RLS has one to check, without a join (ADR 0013).
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Monotonic within a run, and the idempotency key: a re-entered poll that
  -- re-reads the same progress file writes the same rows.
  sequence integer not null check (sequence > 0 and sequence <= 100000),

  type text not null check (type in (
    'workspace_preparing', 'workspace_ready', 'workspace_failed',
    'agent_started', 'turn_completed', 'agent_finished',
    'file_read', 'file_written', 'file_edited', 'file_searched',
    'command_started', 'command_completed', 'command_failed',
    'usage_updated',
    'change_discovered', 'change_verified', 'change_rejected', 'branch_prepared',
    'sandbox_stopping', 'sandbox_stopped',
    'validation_started', 'validation_completed',
    'execution_completed', 'execution_failed'
  )),

  phase text not null check (phase in (
    'preparing', 'working', 'reviewing_change', 'preparing_branch', 'validating', 'finished'
  )),

  audience text not null check (audience in ('customer', 'internal')),

  occurred_at timestamptz not null,

  -- Composed by Vibe, never by a model. Bounded here as well as in code: the
  -- code bound keeps an oversized event by trimming it, and this one stops a
  -- bypassed writer from storing a page of text.
  summary text not null check (char_length(summary) between 1 and 300),

  -- Measurements only: paths, counts, bytes, durations, exit codes, categories.
  metadata jsonb not null default '{}'::jsonb
    check (pg_column_size(metadata) <= 8192),

  created_at timestamptz not null default now(),

  constraint agent_execution_events_unique_sequence
    unique (agent_execution_run_id, sequence)
);

comment on table public.agent_execution_events is
  'Ordered technical record of one agent execution. No model narration, no repository contents, no secrets. The customer timeline is the audience = customer projection.';

comment on column public.agent_execution_events.sequence is
  'Monotonic within a run. Also the idempotency key: a re-entered poll rewrites the same rows.';

comment on column public.agent_execution_events.audience is
  'customer = the handful of outcome-level states a founder sees; internal = the per-file, per-command detail.';

create index agent_execution_events_run_idx
  on public.agent_execution_events (agent_execution_run_id, sequence);

create index agent_execution_events_audience_idx
  on public.agent_execution_events (agent_execution_run_id, audience, sequence);

alter table public.agent_execution_events enable row level security;

-- Read-only to the browser, like every other execution record. Writes happen
-- only from durable workflow steps holding the service role (ADR 0013): a
-- client that could insert here could forge a run's history.
create policy "select own agent_execution_events"
  on public.agent_execution_events
  for select using (user_id = (select auth.uid()));
