-- Sprint 8: Opportunity Engine.
-- See docs/sprints/0008-opportunity-engine.md.
--
-- Two tables plus two constraint widenings on operation_runs.
--
-- Normalized rather than one JSONB blob: an opportunity is a row users will
-- eventually act on individually (Sprint 9 executes one), so it gets an
-- identity now. The set owns the lifecycle and the reproducibility metadata;
-- the opportunities are its immutable contents.
--
-- Deliberately absent: prompt text, model responses, reasoning, raw evidence.

-- ---------------------------------------------------------------------
-- operation_runs gains a second operation type and a prioritizing stage.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in ('business_audit', 'opportunity_generation'));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'running_ai', 'prioritizing', 'validating', 'persisting', 'completed'
  ));

-- `audit_id` was named when only one operation type existed. A generation run
-- produces an opportunity set, not an audit, so the reference is generalized
-- rather than a second nullable column being bolted alongside it — two columns
-- meaning "the thing this produced" is how they drift apart.
--
-- The old column's foreign key is what makes this a rename rather than a
-- widening: `result_id` points into whichever table the operation's type
-- writes to, so it cannot carry one. Ownership and lifecycle are already
-- enforced through project_id and the type's own table.
alter table public.operation_runs add column result_id uuid;

update public.operation_runs set result_id = audit_id where audit_id is not null;

alter table public.operation_runs drop constraint operation_runs_completed_has_result;

alter table public.operation_runs
  add constraint operation_runs_completed_has_result
  check (status <> 'completed' or result_id is not null);

alter table public.operation_runs drop column audit_id;

comment on column public.operation_runs.result_id is
  'The row this operation produced, in whichever table its type writes to. Set when the result is claimed, before inference, so a replay can detect it.';

-- ---------------------------------------------------------------------
-- opportunity_sets
-- One prioritization run. Points at the audit it reasoned from, so a set can
-- always be traced to the diagnosis behind it (Sprint 8 §22, §35).
-- ---------------------------------------------------------------------
create table public.opportunity_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- The audit this set prioritized. Restricted rather than cascaded: losing
  -- the diagnosis must not silently orphan the priorities derived from it.
  business_audit_id uuid not null references public.business_readiness_audits (id) on delete restrict,

  -- Reproducibility set. A set is only comparable to another if every one of
  -- these matches.
  schema_version text not null check (char_length(btrim(schema_version)) > 0),
  engine_version text not null check (char_length(btrim(engine_version)) > 0),
  prompt_version text not null check (char_length(btrim(prompt_version)) > 0),
  rubric_version text not null check (char_length(btrim(rubric_version)) > 0),
  evidence_pack_version text not null check (char_length(btrim(evidence_pack_version)) > 0),
  provider text not null check (char_length(btrim(provider)) > 0),
  model text not null check (char_length(btrim(model)) > 0),

  -- Digest of everything above plus the audit's own input identity. This is
  -- the reuse key: identical inputs mean identical priorities, and paying
  -- twice for them is waste (§23).
  input_hash text not null check (char_length(input_hash) = 64),

  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'completed', 'failed')),

  -- How many opportunities the completed set holds. Null until it completes.
  opportunity_count smallint check (opportunity_count is null or opportunity_count between 1 and 5),

  -- Integrity notes from validation: dropped evidence ids, merged duplicates.
  validation_notes jsonb not null default '[]'::jsonb,

  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint opportunity_sets_completed_has_count
    check (status <> 'completed' or opportunity_count is not null)
);

comment on table public.opportunity_sets is
  'One prioritization run. Validated conclusions only — never prompts, raw responses, or model reasoning.';

-- Latest-set lookup for the project page.
create index opportunity_sets_project_created_idx
  on public.opportunity_sets (project_id, created_at desc);

-- Reuse lookup (§23).
create index opportunity_sets_reuse_idx
  on public.opportunity_sets (project_id, input_hash, status);

-- Staleness lookup: which audit was this set built from?
create index opportunity_sets_audit_idx
  on public.opportunity_sets (business_audit_id);

-- Concurrency guard: at most one in-flight set per project + input. A double
-- submission fails the second insert at the database rather than buying a
-- second identical inference call (§26).
create unique index opportunity_sets_single_in_flight_idx
  on public.opportunity_sets (project_id, input_hash)
  where status in ('pending', 'analyzing');

alter table public.opportunity_sets enable row level security;

create trigger set_updated_at
  before update on public.opportunity_sets
  for each row execute function public.set_updated_at();

create policy "select own opportunity_sets"
  on public.opportunity_sets
  for select using (
    exists (select 1 from public.projects p where p.id = opportunity_sets.project_id and p.user_id = auth.uid())
  );

create policy "insert own opportunity_sets"
  on public.opportunity_sets
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own opportunity_sets"
  on public.opportunity_sets
  for update using (
    exists (select 1 from public.projects p where p.id = opportunity_sets.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own opportunity_sets"
  on public.opportunity_sets
  for delete using (
    exists (select 1 from public.projects p where p.id = opportunity_sets.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- business_opportunities
-- The contents of a completed set. Written once, never updated (§29).
-- ---------------------------------------------------------------------
create table public.business_opportunities (
  id uuid primary key default gen_random_uuid(),
  opportunity_set_id uuid not null references public.opportunity_sets (id) on delete cascade,

  -- 1-based. Unique within the set, and the application checks contiguity —
  -- the UI must never infer priority from row order (§12).
  rank smallint not null check (rank between 1 and 5),

  title text not null check (char_length(btrim(title)) > 0),
  problem text not null check (char_length(btrim(problem)) > 0),
  why_now text not null check (char_length(btrim(why_now)) > 0),

  impact text not null check (impact in ('high', 'medium', 'low')),
  effort text not null check (effort in ('high', 'medium', 'low')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),

  category text not null check (category in (
    'positioning', 'monetization', 'acquisition', 'conversion',
    'onboarding', 'retention', 'analytics', 'trust', 'seo', 'product'
  )),

  -- Exactly one of the five readiness dimensions. No new dimensions (§8).
  primary_dimension text not null check (
    primary_dimension in ('product', 'monetization', 'distribution', 'conversion', 'retention')
  ),
  secondary_dimensions jsonb not null default '[]'::jsonb,

  -- Evidence ids, already validated against the pack before insert.
  evidence_ids jsonb not null default '[]'::jsonb,

  execution_type text not null check (execution_type in (
    'code_change', 'content_change', 'configuration_change',
    'business_decision', 'research', 'manual_external_action', 'measurement'
  )),
  execution_readiness text not null check (
    execution_readiness in ('ready', 'needs_user_input', 'not_supported_yet')
  ),
  dependencies jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  -- No two opportunities in a set may claim the same position.
  constraint business_opportunities_unique_rank unique (opportunity_set_id, rank)
);

comment on table public.business_opportunities is
  'The prioritized opportunities of a set. Advisory only — nothing here is executed (Sprint 8 §46).';

create index business_opportunities_set_rank_idx
  on public.business_opportunities (opportunity_set_id, rank);

alter table public.business_opportunities enable row level security;

-- Ownership runs through the set, which runs through the project.
create policy "select own business_opportunities"
  on public.business_opportunities
  for select using (
    exists (
      select 1
      from public.opportunity_sets s
      join public.projects p on p.id = s.project_id
      where s.id = business_opportunities.opportunity_set_id and p.user_id = auth.uid()
    )
  );

create policy "insert own business_opportunities"
  on public.business_opportunities
  for insert with check (
    exists (
      select 1
      from public.opportunity_sets s
      join public.projects p on p.id = s.project_id
      where s.id = opportunity_set_id and p.user_id = auth.uid()
    )
  );

create policy "delete own business_opportunities"
  on public.business_opportunities
  for delete using (
    exists (
      select 1
      from public.opportunity_sets s
      join public.projects p on p.id = s.project_id
      where s.id = business_opportunities.opportunity_set_id and p.user_id = auth.uid()
    )
  );

-- No update policy, deliberately. A completed set is immutable: re-running
-- prioritization creates a new set rather than editing an old one, so an
-- opportunity a founder read yesterday still says what it said (§29).
