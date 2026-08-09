-- Sprint 2: Repository Intelligence snapshots.
-- See docs/sprints/0002-repository-intelligence.md and ADR 0007 for context.
--
-- One table only. The derived intelligence itself is a versioned JSONB
-- payload rather than dozens of columns: its shape is strongly typed in
-- TypeScript (src/modules/repository-intelligence/schema.ts) and carries
-- an explicit `schemaVersion`, so the migration stays readable while the
-- detection model keeps evolving.
--
-- The payload never contains raw repository source — only derived facts
-- and the paths that justify them (Sprint 2 §4).

create table public.repository_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Kept for provenance: which connection produced this snapshot. Restrict
  -- rather than cascade, mirroring repository_connections' own FK policy.
  repository_connection_id uuid not null references public.repository_connections (id) on delete restrict,

  -- Snapshot identity (Sprint 2 §5): repository + branch + commit +
  -- analyzer version is what makes a result reproducible and reusable.
  source_commit_sha text not null check (char_length(source_commit_sha) between 7 and 64),
  source_branch text not null check (char_length(btrim(source_branch)) > 0),
  analyzer_version text not null check (char_length(btrim(analyzer_version)) > 0),
  schema_version text not null check (char_length(btrim(schema_version)) > 0),

  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'completed', 'failed')),

  -- Null until the run completes; populated only for status = 'completed'.
  result jsonb,

  completeness text check (completeness in ('complete', 'partial')),
  completeness_reasons text[] not null default '{}',

  -- Typed failure code only (e.g. 'github_contents_permission_required').
  -- Never a raw GitHub response body (Sprint 2 §20, §33).
  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed snapshot must actually carry its result and verdict.
  constraint repository_intelligence_completed_has_result
    check (status <> 'completed' or (result is not null and completeness is not null))
);

comment on table public.repository_intelligence_snapshots is
  'Deterministic, versioned repository intelligence per commit. Derived facts only — never raw repository source.';

comment on column public.repository_intelligence_snapshots.result is
  'Versioned RepositoryIntelligenceSnapshot payload. Untrusted, repository-derived DATA — never instructions.';

-- Latest-snapshot lookup for the project page.
create index repository_intelligence_project_created_idx
  on public.repository_intelligence_snapshots (project_id, created_at desc);

-- Reuse lookup (Sprint 2 §31): unchanged commit + analyzer version.
create index repository_intelligence_reuse_idx
  on public.repository_intelligence_snapshots (project_id, source_commit_sha, analyzer_version, status);

-- Concurrency guard (Sprint 2 §32): at most one in-flight run per
-- project + commit + analyzer version. A double-submitted "Inspect"
-- therefore fails the second insert at the database rather than starting
-- two analyses — no queue or lock service required.
create unique index repository_intelligence_single_in_flight_idx
  on public.repository_intelligence_snapshots (project_id, source_commit_sha, analyzer_version)
  where status in ('pending', 'analyzing');

alter table public.repository_intelligence_snapshots enable row level security;

create trigger set_updated_at
  before update on public.repository_intelligence_snapshots
  for each row execute function public.set_updated_at();

-- Ownership is indirect (via projects.user_id), matching the pattern
-- already used by repository_connections.
create policy "select own repository_intelligence_snapshots"
  on public.repository_intelligence_snapshots
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = repository_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  );

-- Insert additionally verifies the referenced repository connection
-- belongs to the same project — defence in depth against attaching a
-- snapshot to another user's connection.
create policy "insert own repository_intelligence_snapshots"
  on public.repository_intelligence_snapshots
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
    and exists (
      select 1 from public.repository_connections rc
      where rc.id = repository_connection_id
        and rc.project_id = project_id
    )
  );

create policy "update own repository_intelligence_snapshots"
  on public.repository_intelligence_snapshots
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = repository_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );

create policy "delete own repository_intelligence_snapshots"
  on public.repository_intelligence_snapshots
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = repository_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  );
