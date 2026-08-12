-- Sprint 7: durable operation execution.
-- See docs/sprints/0007-durable-operation-execution.md and ADR 0013.
--
-- One table. `operation_runs` records *execution* — what is happening, how far
-- it got, and which provider run is carrying it. It deliberately does not
-- record results: `business_readiness_audits` remains the canonical audit
-- store and this table points at it (Sprint 7 §6).
--
-- Deliberately absent: prompt text, model responses, reasoning, evidence,
-- provider credentials, workflow step payloads.

create table public.operation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Denormalized from projects so a workflow step, which runs with no user
  -- session, has a trusted owner to filter every one of its queries on
  -- (ADR 0013). It is set from the project row at creation, never from input.
  user_id uuid not null references auth.users (id) on delete cascade,

  operation_type text not null check (operation_type in ('business_audit')),

  -- Lifecycle. `stage` is progress and is meaningless once terminal, except
  -- for 'completed' which both agree on.
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  stage text not null default 'preparing'
    check (stage in ('preparing', 'counting_tokens', 'running_ai', 'validating', 'persisting', 'completed')),

  -- The Business Audit's existing input identity, reused verbatim (§7). A new
  -- identity system would immediately disagree with audit reuse.
  input_identity text not null check (char_length(input_identity) = 64),

  -- Opaque reference to the durable run in the execution provider. Kept for
  -- support and tracing only; the application never reads product state from
  -- it (§15).
  workflow_run_id text,
  execution_provider text,

  -- The audit this operation produced, or claimed before inference. Set as
  -- soon as the audit row is claimed, which is what makes re-entry into the
  -- paid step detectable rather than merely unlikely (§12).
  audit_id uuid references public.business_readiness_audits (id) on delete set null,

  -- Set immediately before the paid provider call and never cleared.
  --
  -- This is the marker that makes double billing detectable rather than
  -- merely improbable (§11): a step that re-enters and finds this set, with
  -- no completed audit to show for it, knows the provider may already have
  -- been charged and refuses to call again.
  inference_started_at timestamptz,

  -- Typed failure code only, e.g. 'provider_refusal'. Never provider prose.
  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A terminal operation must say when it ended; a live one must not claim to.
  constraint operation_runs_terminal_has_completed_at
    check ((status in ('completed', 'failed', 'cancelled')) = (completed_at is not null)),

  -- A completed operation must point at what it produced.
  constraint operation_runs_completed_has_result
    check (status <> 'completed' or audit_id is not null),

  -- A failed operation must say why, so the UI never has to invent a reason.
  constraint operation_runs_failed_has_code
    check (status <> 'failed' or failure_code is not null)
);

comment on table public.operation_runs is
  'Durable execution state for long-running operations. Execution only — results live in their own domain tables.';

comment on column public.operation_runs.user_id is
  'Trusted owner for workflow steps, which run without a user session and therefore without RLS.';

comment on column public.operation_runs.audit_id is
  'The business_readiness_audits row this operation claimed. Set before inference so a replay can detect it.';

-- Project page lookup: is anything running right now?
create index operation_runs_project_status_idx
  on public.operation_runs (project_id, status, created_at desc);

-- Reuse lookup by identity (§9).
create index operation_runs_identity_idx
  on public.operation_runs (project_id, operation_type, input_identity, status);

-- Double-spend guard (§8). At most one live operation per project + type +
-- input identity. A double-clicked "Run business audit" therefore loses its
-- second insert at the database rather than starting a second workflow and
-- buying a second inference call. The application layer checks first and
-- returns the existing operation; this index is what makes that check a
-- guarantee rather than a race.
create unique index operation_runs_single_active_idx
  on public.operation_runs (project_id, operation_type, input_identity)
  where status in ('queued', 'running');

alter table public.operation_runs enable row level security;

create trigger set_updated_at
  before update on public.operation_runs
  for each row execute function public.set_updated_at();

-- The browser read path stays RLS-protected. Durable execution uses the
-- service role and re-establishes ownership in code (ADR 0013); these
-- policies are what protect every other caller.
create policy "select own operation_runs"
  on public.operation_runs
  for select using (
    exists (select 1 from public.projects p where p.id = operation_runs.project_id and p.user_id = auth.uid())
  );

create policy "insert own operation_runs"
  on public.operation_runs
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own operation_runs"
  on public.operation_runs
  for update using (
    exists (select 1 from public.projects p where p.id = operation_runs.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own operation_runs"
  on public.operation_runs
  for delete using (
    exists (select 1 from public.projects p where p.id = operation_runs.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Usage-ledger idempotency (§12, §13).
--
-- One provider call per audit means one usage event per audit. Under durable
-- execution a step can in principle be entered twice, so "we only call this
-- once" stops being an argument and has to become a constraint. Partial so
-- that rows without a job reference are unaffected.
-- ---------------------------------------------------------------------
create unique index ai_usage_events_job_idx
  on public.ai_usage_events (job_id)
  where job_id is not null;
