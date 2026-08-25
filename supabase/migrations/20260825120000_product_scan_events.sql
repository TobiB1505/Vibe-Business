-- Durable Product Scan and its bounded, customer-visible discovery feed.
-- See ADR 0052. The feed contains Vibe-authored summaries of derived facts;
-- never repository contents, page bodies, prompts, model output or reasoning.

alter table public.operation_runs
  drop constraint if exists operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation',
    'change_validation', 'change_preview', 'preview_teardown', 'change_review',
    'change_merge', 'change_outcome_verification', 'business_measurement',
    'product_understanding', 'product_scan', 'action_planning', 'agent_execution'
  ));

create table public.product_scan_events (
  id uuid primary key default gen_random_uuid(),
  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  sequence smallint not null check (sequence between 1 and 24),
  event_key text not null check (char_length(event_key) between 1 and 80),
  type text not null check (type in (
    'scan_started', 'source_started', 'source_ready', 'source_unavailable',
    'finding', 'profile_ready', 'scan_completed', 'scan_failed'
  )),
  phase text not null check (phase in ('code', 'public_product', 'understanding', 'finished')),
  source text not null check (source in ('system', 'repository', 'live_product', 'product_profile')),
  finding_key text check (finding_key is null or char_length(finding_key) between 1 and 80),
  title text not null check (char_length(title) between 1 and 160),
  detail text check (detail is null or char_length(detail) between 1 and 240),
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint product_scan_events_unique_sequence unique (operation_run_id, sequence),
  constraint product_scan_events_unique_key unique (operation_run_id, event_key)
);

comment on table public.product_scan_events is
  'Bounded, ordered Product Scan discoveries. Vibe-authored derived summaries only; no raw source, model output or reasoning.';

create index product_scan_events_run_idx
  on public.product_scan_events (operation_run_id, sequence);

alter table public.product_scan_events enable row level security;

create policy "select own product_scan_events"
  on public.product_scan_events
  for select using (user_id = (select auth.uid()));

-- New tables are opt-in after ADR 0043 removed automatic Data API grants.
grant select, insert on table public.product_scan_events to service_role;
grant select on table public.product_scan_events to authenticated;
