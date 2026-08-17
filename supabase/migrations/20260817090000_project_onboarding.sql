-- ONBOARDING-1: one resumable activation lifecycle per project.
--
-- Canonical product facts remain in their existing tables. This row stores
-- only orchestration state, explicit live-site intent, and presentation
-- milestones that cannot be derived from a completed scan or audit.

create table public.project_onboarding (
  project_id uuid primary key references public.projects (id) on delete cascade,
  state text not null default 'add_live_product'
    check (state in (
      'connect_source',
      'add_live_product',
      'product_scanning',
      'product_reveal',
      'audit_preparing',
      'audit_needs_user',
      'audit_running',
      'audit_reveal',
      'first_move',
      'complete'
    )),
  live_site_status text not null default 'undecided'
    check (live_site_status in (
      'undecided',
      'provided',
      'no_live_site_yet',
      'scan_failed'
    )),
  product_revealed_at timestamptz,
  audit_revealed_at timestamptz,
  first_move_viewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_onboarding_complete_has_timestamp
    check (state <> 'complete' or completed_at is not null)
);

comment on table public.project_onboarding is
  'Project-scoped onboarding orchestration. Product, audit and opportunity truth remains in canonical domain tables.';

comment on column public.project_onboarding.live_site_status is
  'Explicit founder intent for the optional live source. no_live_site_yet is meaningful state, never an invented URL.';

create index project_onboarding_state_updated_idx
  on public.project_onboarding (state, updated_at desc);

alter table public.project_onboarding enable row level security;

create trigger set_updated_at
  before update on public.project_onboarding
  for each row execute function public.set_updated_at();

create policy "select own project_onboarding"
  on public.project_onboarding for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_onboarding.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "insert own project_onboarding"
  on public.project_onboarding for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_onboarding.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "update own project_onboarding"
  on public.project_onboarding for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_onboarding.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_onboarding.project_id
        and p.user_id = auth.uid()
    )
  );

-- Every existing project gets a row so an interrupted pre-release project is
-- also resumable. Projects that already received an Audit are mature and are
-- backfilled complete; the application reconciles every other coarse starting
-- state from its canonical profile/operation records on first load.
insert into public.project_onboarding (
  project_id,
  state,
  live_site_status,
  product_revealed_at,
  audit_revealed_at,
  first_move_viewed_at,
  completed_at
)
select
  p.id,
  case
    when a.completed_at is not null then 'complete'
    when exists (select 1 from public.repository_connections r where r.project_id = p.id)
      then 'add_live_product'
    else 'connect_source'
  end,
  case
    when p.production_url is not null then 'provided'
    when a.completed_at is not null then 'no_live_site_yet'
    else 'undecided'
  end,
  case when a.completed_at is not null then a.completed_at end,
  case when a.completed_at is not null then a.completed_at end,
  case when a.completed_at is not null then a.completed_at end,
  a.completed_at
from public.projects p
left join lateral (
  select completed_at
  from public.business_readiness_audits
  where project_id = p.id and status = 'completed'
  order by created_at desc
  limit 1
) a on true
on conflict (project_id) do nothing;
