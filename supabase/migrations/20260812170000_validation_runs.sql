-- Sprint 10A — Isolated change validation.
--
-- Vibe's first execution of code it did not write. A prepared change is checked
-- out at its exact commit inside an ephemeral Firecracker microVM, installed,
-- typechecked, tested and built, and the sandbox is destroyed. See ADR 0015.
--
-- What is deliberately NOT stored here: repository source, node_modules, full
-- build logs, provider raw responses, sandbox credentials, GitHub credentials.
-- Only bounded, sanitized step results and the metadata needed to explain and
-- bill the run.

-- ---------------------------------------------------------------------
-- Operation types and stages
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation'
  ));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'running_ai', 'prioritizing', 'validating', 'persisting',
    -- Change preparation (Sprint 9B §7).
    'preflight', 'generating_change', 'writing_repository', 'verifying_repository',
    -- Isolated validation (Sprint 10A §17). Granular because a five-minute
    -- sandbox run with one opaque "validating" stage tells a waiting user
    -- nothing, and inventing a percentage would tell them something false.
    'provisioning', 'acquiring_source', 'verifying_source', 'securing_sandbox',
    'installing', 'typechecking', 'testing', 'building', 'collecting_results', 'cleaning_up',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- validation_runs
-- ---------------------------------------------------------------------
create table public.validation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,
  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,

  validation_profile text not null check (validation_profile in ('nextjs_node_v1')),
  validation_profile_version text not null check (char_length(btrim(validation_profile_version)) > 0),
  -- What "validated" meant when this ran. Network policy, command sequence,
  -- timeouts and secret handling are all folded into this string, so a stored
  -- pass can never be reinterpreted under rules it was not checked against.
  sandbox_policy_version text not null check (char_length(btrim(sandbox_policy_version)) > 0),

  sandbox_provider text not null check (sandbox_provider in ('vercel_sandbox')),
  sandbox_runtime text,
  package_manager text not null check (package_manager in ('pnpm', 'npm')),

  -- The artifact under test. Validation is artifact-centric: this is the exact
  -- commit that was checked out and verified, never "whatever HEAD was".
  prepared_commit_sha text not null check (char_length(prepared_commit_sha) between 7 and 64),

  status text not null check (status in ('queued', 'running', 'passed', 'failed', 'cancelled')),
  stage text not null,

  -- Bounded, sanitized per-step results. Never complete logs (§15).
  steps jsonb not null default '{}'::jsonb,

  failure_code text,
  sandbox_duration_ms integer check (sandbox_duration_ms is null or sandbox_duration_ms >= 0),
  -- Whether the paid VM was actually torn down. Recorded for observability and
  -- never allowed to change the verdict (§23).
  cleanup_status text check (cleanup_status in ('stopped', 'stop_failed', 'not_provisioned')),

  -- Reuse key (§21).
  validation_identity text not null check (char_length(validation_identity) = 64),

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint validation_runs_failed_has_code
    check (status <> 'failed' or failure_code is not null),
  constraint validation_runs_terminal_has_completed_at
    check ((status in ('passed', 'failed', 'cancelled')) = (completed_at is not null))
);

comment on table public.validation_runs is
  'One isolated sandbox validation of one prepared change. Passing means the profile''s commands succeeded in an ephemeral VM — not that the change is approved, safe, or production ready.';

comment on column public.validation_runs.sandbox_policy_version is
  'The sandbox execution policy in force. Part of the validation identity, so tightening the policy invalidates earlier results by construction.';

comment on column public.validation_runs.steps is
  'Bounded, ANSI-stripped, secret-redacted tails of each step''s output. Never complete build logs.';

create index validation_runs_prepared_change_idx
  on public.validation_runs (prepared_change_id, created_at desc);

create index validation_runs_project_created_idx
  on public.validation_runs (project_id, created_at desc);

create index validation_runs_operation_idx
  on public.validation_runs (operation_run_id);

-- Idempotency, enforced by the database rather than by the application alone
-- (§21, §35). At most one live-or-passed validation per identity: a double
-- click loses its second insert here instead of provisioning a second paid VM.
create unique index validation_runs_single_active_idx
  on public.validation_runs (project_id, validation_identity)
  where status in ('queued', 'running', 'passed');

alter table public.validation_runs enable row level security;

create trigger set_updated_at
  before update on public.validation_runs
  for each row execute function public.set_updated_at();

-- Browser reads stay RLS-protected. Durable execution uses the service role and
-- re-establishes ownership in code (ADR 0013).
create policy "select own validation_runs"
  on public.validation_runs
  for select using (
    exists (select 1 from public.projects p where p.id = validation_runs.project_id and p.user_id = auth.uid())
  );

create policy "insert own validation_runs"
  on public.validation_runs
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own validation_runs"
  on public.validation_runs
  for update using (
    exists (select 1 from public.projects p where p.id = validation_runs.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own validation_runs"
  on public.validation_runs
  for delete using (
    exists (select 1 from public.projects p where p.id = validation_runs.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- sandbox_usage_events
-- ---------------------------------------------------------------------
-- Sandbox execution is infrastructure spend, not AI inference. It is metered
-- differently (Active CPU, provisioned memory, creations, egress), has no
-- token concept, and mixing it into ai_usage_events would corrupt every
-- cost-per-audit figure Sprint 4 built. Separate ledger, same discipline.
create table public.sandbox_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  operation text not null check (char_length(btrim(operation)) > 0),
  provider text not null check (char_length(btrim(provider)) > 0),
  runtime text,
  -- Deliberately not a foreign key: the ledger must outlive the run it paid
  -- for, because deleting a validation does not undo the infrastructure spend.
  validation_run_id uuid,

  status text not null check (status in ('passed', 'failed')),

  -- Measured, never estimated. Null where the provider did not report it.
  sandbox_duration_ms integer check (sandbox_duration_ms is null or sandbox_duration_ms >= 0),
  active_cpu_ms integer check (active_cpu_ms is null or active_cpu_ms >= 0),
  network_ingress_bytes bigint check (network_ingress_bytes is null or network_ingress_bytes >= 0),
  network_egress_bytes bigint check (network_egress_bytes is null or network_egress_bytes >= 0),

  -- Null unless the provider exposes an attributable billed amount. Vercel
  -- currently does not, and a figure derived from public rate cards would be
  -- an estimate wearing an accounting figure's clothes (§25).
  provider_cost_usd numeric(18, 9) check (provider_cost_usd is null or provider_cost_usd >= 0),

  cleanup_status text,
  failure_code text,

  created_at timestamptz not null default now()
);

comment on table public.sandbox_usage_events is
  'Infrastructure usage ledger for sandbox execution. Separate from ai_usage_events: this is compute, not inference.';

comment on column public.sandbox_usage_events.provider_cost_usd is
  'Null unless the provider reports attributable cost. Never derived from a public rate card.';

create index sandbox_usage_events_project_created_idx
  on public.sandbox_usage_events (project_id, created_at desc);

create index sandbox_usage_events_validation_idx
  on public.sandbox_usage_events (validation_run_id);

alter table public.sandbox_usage_events enable row level security;

-- Read-only to the owner. Rows are written by durable execution through the
-- service role; a ledger the client can write is not a ledger.
create policy "select own sandbox_usage_events"
  on public.sandbox_usage_events
  for select using (
    exists (select 1 from public.projects p where p.id = sandbox_usage_events.project_id and p.user_id = auth.uid())
  );
