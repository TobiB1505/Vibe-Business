-- Sprint 10B-2 — Temporary change preview runtime.
--
-- A preview restores the exact ValidatedArtifact captured by a passing
-- validation into a fresh, isolated microVM, starts the already-built
-- production server, exposes exactly one port, and stops itself fifteen
-- minutes later. See ADR 0016.
--
-- What a preview proves is narrow and the schema says so:
--
--   repository_write_verified     the bytes on the branch are the bytes we meant
--   sandbox_validation_passed     those bytes install, typecheck, test and build
--   validated_artifact_available  that exact filesystem was kept, briefly
--   preview_available             ← this table
--   human_approved / merged / deployed   none of these exist
--
-- Deliberately NOT stored here: the public preview URL (capability-like, and
-- fetched from the provider on an authorized read instead), the sandbox's
-- provider id or any reconnect material (the name is recomputed from `id`),
-- source, logs, secrets, or provider responses.

-- ---------------------------------------------------------------------
-- Operation type and stages
--
-- Checked against the live constraint before writing this file rather than
-- inferred from TypeScript: the deployed CHECK listed four operation types and
-- did not include 'change_preview', so every preview would have failed at
-- INSERT. `schema.test.ts` now pins the two representations together.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview'
  ));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'running_ai', 'prioritizing', 'validating', 'persisting',
    -- Change preparation (Sprint 9B §7).
    'preflight', 'generating_change', 'writing_repository', 'verifying_repository',
    -- Isolated validation (Sprint 10A §17).
    'provisioning', 'acquiring_source', 'verifying_source', 'securing_sandbox',
    'installing', 'typechecking', 'testing', 'building', 'collecting_results', 'cleaning_up',
    -- Temporary preview (Sprint 10B-2 §23). Granular for the same reason: a
    -- restore-plus-boot is tens of seconds, and one opaque stage tells a
    -- waiting user nothing that a percentage would not tell them falsely.
    'restoring_artifact', 'verifying_artifact', 'starting_server', 'checking_preview',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- preview_sessions
-- ---------------------------------------------------------------------
create table public.preview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,

  -- The passing validation whose artifact this session restored. Deleting the
  -- session never touches the run: validation history is not rewritten to tidy
  -- up a preview (§20).
  validation_run_id uuid not null references public.validation_runs (id) on delete cascade,
  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,

  -- The exact snapshot restored, recorded rather than re-derived. If a run were
  -- ever re-captured, this says which artifact was actually served.
  artifact_snapshot_id text not null check (char_length(btrim(artifact_snapshot_id)) > 0),

  preview_profile text not null check (preview_profile in ('nextjs_preview_v1')),
  preview_profile_version text not null check (char_length(btrim(preview_profile_version)) > 0),

  -- What "preview" meant when this ran: runtime, port, server command strategy,
  -- network policy, TTL, health-check behaviour, secret policy, cleanup and
  -- snapshot-deletion semantics. Part of the preview identity, so changing any
  -- of them invalidates reuse by construction (§4).
  preview_policy_version text not null check (char_length(btrim(preview_policy_version)) > 0),

  provider text not null check (provider in ('vercel_sandbox')),
  runtime text,

  -- Vibe's port, from preview-policy-v1. Recorded so a session says what it
  -- exposed; never accepted from a client (§14, §16).
  port integer not null check (port between 1 and 65535),

  status text not null default 'starting'
    check (status in ('starting', 'running', 'stopping', 'stopped', 'expired', 'failed')),
  stage text not null default 'preflight',
  failure_code text,
  cleanup_status text
    check (cleanup_status in ('stopped', 'stop_failed', 'not_provisioned', 'artifact_delete_failed')),

  -- Reuse key (§22).
  preview_identity text not null check (char_length(preview_identity) = 64),

  started_at timestamptz,
  ready_at timestamptz,

  -- Vibe's own deadline, not the provider's timeout. The provider timeout stops
  -- the VM; this is what stops Vibe offering a preview it can no longer stand
  -- behind, and the two must not be the same clock (§18, §25).
  expires_at timestamptz not null,
  stopped_at timestamptz,

  -- When this session's ValidatedArtifact snapshot was deleted. Expiry is the
  -- backstop; explicit deletion at terminal preview lifecycle is the plan (§19).
  artifact_deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A terminal session must say when it ended; a live one must not claim to.
  constraint preview_sessions_terminal_has_stopped_at
    check ((status in ('stopped', 'expired', 'failed')) = (stopped_at is not null)),

  -- A failed session must say why, so the UI never has to invent a reason.
  constraint preview_sessions_failed_has_code
    check (status <> 'failed' or failure_code is not null),

  -- `running` is the claim that the server answered a health check. It is only
  -- ever written together with the moment that happened, so the claim cannot
  -- exist without its evidence (§17).
  constraint preview_sessions_running_has_ready_at
    check (status <> 'running' or ready_at is not null)
);

comment on table public.preview_sessions is
  'One temporary preview of one validated change. Running means the validated artifact started and answered on an isolated exposed port — not that the change is approved, correct, secure, mergeable or production ready.';

comment on column public.preview_sessions.artifact_snapshot_id is
  'The provider snapshot this session restored. Deleted at terminal preview lifecycle; the artifact TTL is only the backstop.';

comment on column public.preview_sessions.expires_at is
  'Vibe''s own deadline. Authorized reads stop returning a preview domain at this moment regardless of provider state.';

comment on column public.preview_sessions.preview_policy_version is
  'The preview runtime policy in force. Part of the preview identity, so tightening it invalidates reuse by construction.';

create index preview_sessions_project_created_idx
  on public.preview_sessions (project_id, created_at desc);

create index preview_sessions_validation_idx
  on public.preview_sessions (validation_run_id, created_at desc);

create index preview_sessions_operation_idx
  on public.preview_sessions (operation_run_id);

-- Idempotency, enforced by the database rather than by the application alone
-- (§32). At most one live preview per identity: a double click loses its second
-- insert here instead of provisioning a second paid VM on a second public URL.
create unique index preview_sessions_single_active_idx
  on public.preview_sessions (project_id, preview_identity)
  where status in ('starting', 'running');

-- Finding previews that outlived their deadline, and artifacts still awaiting
-- deletion, for lazy convergence (§25).
create index preview_sessions_live_expiry_idx
  on public.preview_sessions (expires_at)
  where status in ('starting', 'running');

create index preview_sessions_undeleted_artifact_idx
  on public.preview_sessions (created_at)
  where artifact_deleted_at is null;

alter table public.preview_sessions enable row level security;

create trigger set_updated_at
  before update on public.preview_sessions
  for each row execute function public.set_updated_at();

-- Browser reads stay RLS-protected. Durable execution uses the service role and
-- re-establishes ownership in code (ADR 0013).
create policy "select own preview_sessions"
  on public.preview_sessions
  for select using (
    exists (select 1 from public.projects p where p.id = preview_sessions.project_id and p.user_id = auth.uid())
  );

create policy "insert own preview_sessions"
  on public.preview_sessions
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own preview_sessions"
  on public.preview_sessions
  for update using (
    exists (select 1 from public.projects p where p.id = preview_sessions.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own preview_sessions"
  on public.preview_sessions
  for delete using (
    exists (select 1 from public.projects p where p.id = preview_sessions.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Sandbox usage ledger
--
-- Preview spend reuses `sandbox_usage_events` rather than getting a ledger of
-- its own: it is the same provider, the same meters (Active CPU, provisioned
-- memory, creations, data transfer) and the same "measured, never estimated"
-- discipline. What it needs is to be *distinguishable*, which `operation` and
-- this column provide.
--
-- Deliberately not a foreign key, for the same reason `validation_run_id` is
-- not: the ledger must outlive the thing it paid for, because deleting a
-- preview does not undo the infrastructure spend.
-- ---------------------------------------------------------------------
alter table public.sandbox_usage_events
  add column preview_session_id uuid;

comment on column public.sandbox_usage_events.preview_session_id is
  'The preview session this spend belongs to, for operation = change_preview. Not a foreign key: the ledger outlives what it paid for.';

create index sandbox_usage_events_preview_idx
  on public.sandbox_usage_events (preview_session_id);

-- One ledger row per preview session, enforced rather than argued. A retried
-- terminal step must not double-count a sandbox that only ran once (§27).
create unique index sandbox_usage_events_preview_unique_idx
  on public.sandbox_usage_events (preview_session_id)
  where preview_session_id is not null;
