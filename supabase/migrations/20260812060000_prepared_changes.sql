-- Sprint 9B: durable change preparation.
-- See docs/sprints/0009-first-execution.md and ADR 0014.
--
-- One table. `prepared_changes` records that Vibe prepared a specific change
-- on a specific isolated branch, and nothing about what the change contains:
-- the GitHub branch is the canonical artifact (§2, §23). Supabase stores
-- references, not a source-code mirror.
--
-- Deliberately absent: installation tokens, auth headers, GitHub API
-- responses, repository files, diffs, generated source, opportunity prose.

-- ---------------------------------------------------------------------
-- operation_runs gains the third operation type and its stages.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in ('business_audit', 'opportunity_generation', 'change_preparation'));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'running_ai', 'prioritizing', 'validating', 'persisting',
    -- Change preparation (Sprint 9B §7).
    'preflight', 'generating_change', 'writing_repository', 'verifying_repository',
    'completed'
  ));

-- The domain object an operation acts on, when it has one. An audit acts on a
-- project; a change preparation acts on one specific opportunity, and the
-- workflow must be able to re-resolve exactly which — not "the current top
-- opportunity", which could be a different one by the time the step runs.
alter table public.operation_runs add column subject_id uuid;

comment on column public.operation_runs.subject_id is
  'The domain object this operation acts on (e.g. the opportunity being prepared). Set at creation from server state.';

-- ---------------------------------------------------------------------
-- prepared_changes
-- ---------------------------------------------------------------------
create table public.prepared_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Denormalized from projects so a workflow step, which runs with no user
  -- session, has a trusted owner to filter on (ADR 0013).
  user_id uuid not null references auth.users (id) on delete cascade,

  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,

  -- What this change was prepared for. Restricted rather than cascaded: losing
  -- the opportunity must not silently orphan a branch that exists on GitHub.
  opportunity_set_id uuid not null references public.opportunity_sets (id) on delete restrict,
  opportunity_id uuid not null references public.business_opportunities (id) on delete restrict,

  execution_capability text not null check (execution_capability in ('nextjs_seo_foundations_v1')),
  execution_version text not null check (char_length(btrim(execution_version)) > 0),

  -- The analyzed state this change was built from.
  repository_snapshot_id uuid not null
    references public.repository_intelligence_snapshots (id) on delete restrict,

  base_branch text not null check (char_length(btrim(base_branch)) > 0),
  -- A prepared change is a commit on top of a specific parent, so the base is
  -- part of what it *is* — not metadata about it.
  base_sha text not null check (char_length(base_sha) between 7 and 64),

  branch_name text not null check (branch_name like 'vibe/%'),
  commit_sha text check (commit_sha is null or char_length(commit_sha) between 7 and 64),

  -- Which files were written. Paths and hashes only — never content (§23).
  files jsonb not null default '[]'::jsonb,

  -- Digest of project + opportunity set + opportunity + capability + version +
  -- snapshot + base sha. The reuse key (§5).
  execution_identity text not null check (char_length(execution_identity) = 64),

  status text not null default 'preparing'
    check (status in ('preparing', 'prepared', 'failed')),

  -- Typed code only, never an exception message (§21).
  failure_code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  -- A prepared change must point at the commit it prepared.
  constraint prepared_changes_prepared_has_commit
    check (status <> 'prepared' or commit_sha is not null),

  -- A failed one must say why, so the UI never invents a reason.
  constraint prepared_changes_failed_has_code
    check (status <> 'failed' or failure_code is not null),

  -- Terminal states record when they ended; a live one must not claim to.
  constraint prepared_changes_terminal_has_completed_at
    check ((status in ('prepared', 'failed')) = (completed_at is not null))
);

comment on table public.prepared_changes is
  'A change Vibe prepared on an isolated branch. References only — the GitHub branch is the canonical artifact.';

comment on column public.prepared_changes.base_sha is
  'The commit this change was prepared on top of. Part of the execution identity: if HEAD moves, it is a different change.';

-- Project page lookup.
create index prepared_changes_project_created_idx
  on public.prepared_changes (project_id, created_at desc);

-- Reuse lookup by identity (§5).
create index prepared_changes_identity_idx
  on public.prepared_changes (project_id, execution_identity, status);

create index prepared_changes_operation_idx
  on public.prepared_changes (operation_run_id);

-- Idempotency guarantee (§4, §14). At most one live-or-successful preparation
-- per execution identity, enforced by the database rather than by the
-- application alone. A double submission loses its second insert here instead
-- of creating a second branch on someone's repository.
create unique index prepared_changes_single_active_idx
  on public.prepared_changes (project_id, execution_identity)
  where status in ('preparing', 'prepared');

alter table public.prepared_changes enable row level security;

create trigger set_updated_at
  before update on public.prepared_changes
  for each row execute function public.set_updated_at();

-- The browser read path stays RLS-protected. Durable execution uses the
-- service role and re-establishes ownership in code (ADR 0013).
create policy "select own prepared_changes"
  on public.prepared_changes
  for select using (
    exists (select 1 from public.projects p where p.id = prepared_changes.project_id and p.user_id = auth.uid())
  );

create policy "insert own prepared_changes"
  on public.prepared_changes
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own prepared_changes"
  on public.prepared_changes
  for update using (
    exists (select 1 from public.projects p where p.id = prepared_changes.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own prepared_changes"
  on public.prepared_changes
  for delete using (
    exists (select 1 from public.projects p where p.id = prepared_changes.project_id and p.user_id = auth.uid())
  );
