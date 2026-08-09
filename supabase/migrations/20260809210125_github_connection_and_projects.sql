-- Sprint 1: GitHub App connection & repository selection.
-- See docs/decisions/0009-github-installation-ownership-verification.md,
-- docs/sprints/0001-github-app-connection.md, and ADR 0002/0007 for context.
--
-- Every table here is user-owned (directly or via project ownership) and
-- has Row Level Security enabled with explicit policies — see CLAUDE.md
-- rule "no giant future schema": only what Sprint 1 actually needs.

-- Shared trigger to keep `updated_at` current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- github_connections
-- One verified GitHub identity per Vibe Business user (ADR 0009). Never
-- stores a GitHub access token — only the identity confirmed during the
-- connect flow.
-- ---------------------------------------------------------------------
create table public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  github_user_id bigint not null,
  github_login text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_connections_user_id_key unique (user_id),
  constraint github_connections_github_user_id_key unique (github_user_id)
);

comment on table public.github_connections is
  'Verified GitHub identity behind a Vibe Business user, per ADR 0009. No tokens stored.';

alter table public.github_connections enable row level security;

create trigger set_updated_at
  before update on public.github_connections
  for each row execute function public.set_updated_at();

create policy "select own github_connections" on public.github_connections
  for select using (user_id = auth.uid());

create policy "insert own github_connections" on public.github_connections
  for insert with check (user_id = auth.uid());

create policy "update own github_connections" on public.github_connections
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own github_connections" on public.github_connections
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- github_installations
-- Installations verified as accessible to a user's GitHub identity (ADR
-- 0009). A GitHub org installation may legitimately be verified by more
-- than one Vibe user (shared org membership), so installation_id itself
-- is not globally unique — only per (user_id, installation_id). Never
-- stores an installation access token.
-- ---------------------------------------------------------------------
create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null,
  github_account_id bigint not null,
  github_account_login text not null,
  account_type text not null check (account_type in ('User', 'Organization')),
  repository_selection text not null check (repository_selection in ('all', 'selected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_installations_user_installation_key unique (user_id, installation_id)
);

comment on table public.github_installations is
  'GitHub App installations verified (ADR 0009) as accessible to a user. No installation tokens stored.';

create index github_installations_installation_id_idx
  on public.github_installations (installation_id);

alter table public.github_installations enable row level security;

create trigger set_updated_at
  before update on public.github_installations
  for each row execute function public.set_updated_at();

create policy "select own github_installations" on public.github_installations
  for select using (user_id = auth.uid());

create policy "insert own github_installations" on public.github_installations
  for insert with check (user_id = auth.uid());

create policy "update own github_installations" on public.github_installations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own github_installations" on public.github_installations
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- projects
-- A Vibe Business project. Sprint 1: name only, no audit/business fields
-- yet (ARCHITECTURE.md §7 item 4 — final schema is still open).
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.projects is 'A Vibe Business project. Sprint 1: name + one repository connection only.';

create index projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

create trigger set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create policy "select own projects" on public.projects
  for select using (user_id = auth.uid());

create policy "insert own projects" on public.projects
  for insert with check (user_id = auth.uid());

create policy "update own projects" on public.projects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own projects" on public.projects
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- repository_connections
-- Connects exactly one GitHub repository to exactly one project (Sprint 1
-- scope — "select exactly one repository"). A repository may be connected
-- to at most one project system-wide, so a second attempt to connect an
-- already-connected repository fails the unique constraint and is
-- reported to the user as a clean "already connected" error rather than a
-- silent duplicate.
-- ---------------------------------------------------------------------
create table public.repository_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  github_installation_id uuid not null references public.github_installations (id) on delete restrict,
  github_repository_id bigint not null,
  owner text not null,
  name text not null,
  full_name text not null,
  default_branch text not null,
  private boolean not null,
  html_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repository_connections_project_id_key unique (project_id),
  constraint repository_connections_github_repository_id_key unique (github_repository_id)
);

comment on table public.repository_connections is
  'The single GitHub repository connected to a project (Sprint 1: 1:1). Metadata captured once at connection time.';

create index repository_connections_installation_id_idx
  on public.repository_connections (github_installation_id);

alter table public.repository_connections enable row level security;

create trigger set_updated_at
  before update on public.repository_connections
  for each row execute function public.set_updated_at();

-- Ownership of repository_connections is indirect (via projects.user_id),
-- so every policy checks project ownership through an EXISTS subquery
-- rather than a direct user_id column on this table.
create policy "select own repository_connections" on public.repository_connections
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = repository_connections.project_id
        and p.user_id = auth.uid()
    )
  );

-- Insert additionally verifies that the referenced installation also
-- belongs to the same user — defense in depth against a client attaching
-- another user's verified installation to a project it does not own,
-- even though application code (src/modules/projects/connect.ts) already
-- enforces this.
create policy "insert own repository_connections" on public.repository_connections
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
    and exists (
      select 1 from public.github_installations gi
      where gi.id = github_installation_id
        and gi.user_id = auth.uid()
    )
  );

create policy "update own repository_connections" on public.repository_connections
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = repository_connections.project_id
        and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );

create policy "delete own repository_connections" on public.repository_connections
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = repository_connections.project_id
        and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- audit_events
-- Minimal Postgres append-only audit log (ADR 0007). Only the columns
-- Sprint 1's actual events need — no speculative fields. Append-only is
-- enforced by simply not defining update/delete policies: once RLS is
-- enabled, an operation with no matching policy is denied by default.
-- ---------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only application audit log (ADR 0007). Business-meaningful events only, never secrets/tokens.';

create index audit_events_user_id_created_at_idx
  on public.audit_events (user_id, created_at desc);

create index audit_events_event_type_idx on public.audit_events (event_type);

alter table public.audit_events enable row level security;

create policy "select own audit_events" on public.audit_events
  for select using (user_id = auth.uid());

create policy "insert own audit_events" on public.audit_events
  for insert with check (user_id = auth.uid());

-- No update/delete policy: append-only by omission (RLS default-denies).
