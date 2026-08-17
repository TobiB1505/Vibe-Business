-- CORE-2b: Action Planner Intelligence.
-- See docs/sprints/0031-core2b-action-planner.md.
--
-- Two tables plus two constraint widenings on operation_runs.
--
-- Normalized rather than one JSONB blob, for the reason the Opportunity Engine
-- was: a plan step is something a user will eventually act on individually, so
-- it gets an identity now rather than after something depends on it.
--
-- Deliberately absent from both tables: prompt text, model responses, model
-- reasoning, raw evidence, repository paths, git refs, branch names, commit
-- messages and generated code. There is no column any of them could occupy —
-- CLAUDE.md Rule 57 held at the schema, not only in application code.

-- ---------------------------------------------------------------------
-- operation_runs gains a twelfth operation type and a planning stage.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview', 'preview_teardown', 'change_review', 'change_merge',
    'change_outcome_verification', 'business_measurement', 'product_understanding',
    -- Turning one Move into an ordered, concrete plan (CORE-2b §45).
    'action_planning'
  ));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing',
    'counting_tokens',
    'asking_founder',
    'running_ai',
    'prioritizing',
    -- The Action Planner's paid step (CORE-2b §45).
    'planning',
    'validating',
    'persisting',
    'preflight',
    'generating_change',
    'writing_repository',
    'verifying_repository',
    'provisioning',
    'acquiring_source',
    'verifying_source',
    'securing_sandbox',
    'installing',
    'typechecking',
    'testing',
    'building',
    'collecting_results',
    'cleaning_up',
    'restoring_artifact',
    'verifying_artifact',
    'starting_server',
    'checking_preview',
    'capturing_before',
    'capturing_after',
    'persisting_artifacts',
    'authorizing',
    'writing_default_ref',
    'verifying_default_ref',
    'converging',
    'observing',
    'evaluating',
    'collecting_baseline',
    'collecting_post',
    'comparing',
    'reading_code',
    'reading_public_product',
    'understanding_product',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- action_plans
-- One planning run for one Move. Points at the audit, the opportunity set and
-- the Move it carries through, so a plan can always be traced to the judgment
-- behind it (CORE-2b §5, §37).
-- ---------------------------------------------------------------------
create table public.action_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- The audit this plan works within. Restricted rather than cascaded: losing
  -- the diagnosis must not silently orphan the plan derived from it.
  business_audit_id uuid not null references public.business_readiness_audits (id) on delete restrict,
  opportunity_set_id uuid not null references public.opportunity_sets (id) on delete restrict,

  -- The Move within that set. The engine's own deterministic id, not a row id:
  -- it is what the set's contents are keyed by everywhere else in the product.
  opportunity_id text not null check (char_length(btrim(opportunity_id)) > 0),

  -- The understanding and stated intent this plan reasoned from. Read back to
  -- decide whether the plan still describes the current business (§42).
  product_profile_id uuid not null references public.product_profiles (id) on delete restrict,
  founder_intent_hash text not null check (char_length(btrim(founder_intent_hash)) > 0),

  -- The internal root business problem the plan exists to move (§37). Never
  -- rendered to a customer; kept so plan-to-problem fidelity stays checkable
  -- after the fact. Null when no audit conclusion could be matched to the Move.
  root_problem text,
  lenses jsonb not null default '[]'::jsonb,

  -- Reproducibility set. Two plans are comparable only if all of these match.
  schema_version text not null check (char_length(btrim(schema_version)) > 0),
  contract_version text not null check (char_length(btrim(contract_version)) > 0),
  planner_version text not null check (char_length(btrim(planner_version)) > 0),
  prompt_version text not null check (char_length(btrim(prompt_version)) > 0),
  rubric_version text not null check (char_length(btrim(rubric_version)) > 0),
  evidence_pack_version text not null check (char_length(btrim(evidence_pack_version)) > 0),
  provider text not null check (char_length(btrim(provider)) > 0),
  model text not null check (char_length(btrim(model)) > 0),

  -- Digest of everything above plus the audit's own input identity. This is the
  -- reuse key: identical inputs mean an identical plan, and paying twice for it
  -- is waste (§53).
  input_hash text not null check (char_length(input_hash) = 64),

  -- Run lifecycle, not progress. Where a plan has *got to* is derived from its
  -- steps at read time, so a stored answer can never disagree with the steps
  -- that define it (§40).
  status text not null default 'planning'
    check (status in ('planning', 'completed', 'failed', 'superseded')),

  goal text,
  why_now text,
  expected_outcome text,
  addresses_root_problem text,
  assumptions jsonb not null default '[]'::jsonb,

  step_count smallint check (step_count is null or step_count between 2 and 9),

  -- Prose for a human reading the plan, and the closed finding codes behind it.
  -- Both, because "was this plan a consulting checklist?" should be answerable
  -- without matching on English.
  validation_notes jsonb not null default '[]'::jsonb,
  validation_findings jsonb not null default '[]'::jsonb,

  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed plan without steps would be a lie the UI cannot detect.
  constraint action_plans_completed_has_steps
    check (status <> 'completed' or step_count is not null),
  constraint action_plans_completed_has_goal
    check (status <> 'completed' or goal is not null)
);

comment on table public.action_plans is
  'One Action Plan for one Move. Validated conclusions only — never prompts, raw responses, model reasoning, repository paths, refs or code.';

comment on column public.action_plans.root_problem is
  'Internal. The business problem the plan exists to move (CORE-2b §37). Never shown to a customer.';

-- Latest-plan lookup for the project page and the onboarding first move.
create index action_plans_project_created_idx
  on public.action_plans (project_id, created_at desc);

-- Reuse lookup (§53).
create index action_plans_reuse_idx
  on public.action_plans (project_id, input_hash, status);

-- Staleness lookups: which audit and which Move was this plan built from?
create index action_plans_audit_idx on public.action_plans (business_audit_id);
create index action_plans_opportunity_set_idx on public.action_plans (opportunity_set_id);

-- Concurrency guard: at most one in-flight plan per project + input. A double
-- submission fails the second insert at the database rather than buying a
-- second identical inference call (§54, §87).
create unique index action_plans_single_in_flight_idx
  on public.action_plans (project_id, input_hash)
  where status = 'planning';

alter table public.action_plans enable row level security;

create trigger set_updated_at
  before update on public.action_plans
  for each row execute function public.set_updated_at();

create policy "select own action_plans"
  on public.action_plans
  for select using (
    exists (select 1 from public.projects p where p.id = action_plans.project_id and p.user_id = auth.uid())
  );

create policy "insert own action_plans"
  on public.action_plans
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own action_plans"
  on public.action_plans
  for update using (
    exists (select 1 from public.projects p where p.id = action_plans.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own action_plans"
  on public.action_plans
  for delete using (
    exists (select 1 from public.projects p where p.id = action_plans.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- action_plan_steps
-- The contents of a completed plan. Written once, never updated.
-- ---------------------------------------------------------------------
create table public.action_plan_steps (
  id uuid primary key default gen_random_uuid(),
  action_plan_id uuid not null references public.action_plans (id) on delete cascade,

  -- The application's own deterministic step id, stable within a plan.
  step_key text not null check (char_length(btrim(step_key)) > 0),

  -- 1-based. Unique within the plan; contiguity is enforced by the application,
  -- which reassigns orders after validation. Nothing infers sequence from row
  -- order (§21).
  step_order smallint not null check (step_order between 1 and 9),

  title text not null check (char_length(btrim(title)) > 0),
  description text not null check (char_length(btrim(description)) > 0),
  purpose text not null check (char_length(btrim(purpose)) > 0),

  -- Who has to act. Model output, from a closed vocabulary (§9).
  actor text not null check (
    actor in ('vibe', 'founder_decision', 'founder_action', 'external_party')
  ),

  -- What kind of changed state this produces. Model output, closed vocabulary.
  change_kind text not null check (change_kind in (
    'decision', 'analysis', 'product_change', 'external_setup', 'measurement', 'research'
  )),

  -- How we know it is done. Required: a step without one cannot be executed,
  -- measured, or told apart from a consulting checklist item (§20).
  completion_criteria text not null check (char_length(btrim(completion_criteria)) > 0),

  -- Orders of steps that must finish first. Explicit, never inferred (§21).
  depends_on jsonb not null default '[]'::jsonb,

  -- Evidence ids, already validated against the pack before insert. May be
  -- empty: a strategic decision does not rest on an observation (§35).
  evidence_ids jsonb not null default '[]'::jsonb,

  -- Server-derived, never model output (§10, §46). There is no wire field for
  -- either of these — see src/modules/action-plans/wire-schema.ts.
  execution_support text not null check (execution_support in (
    'vibe_executes_now', 'vibe_prepares', 'founder_decides',
    'founder_acts', 'external_dependency', 'not_yet_supported'
  )),

  -- The registry capability backing an executable step. Only ever written from
  -- the server-owned registry, and only for `vibe_executes_now` — the
  -- constraint below is what stops an execution claim existing without one.
  capability text check (capability in ('nextjs_seo_foundations_v1', 'nextjs_seo_foundations_v2')),

  requires_approval boolean not null default false,

  created_at timestamptz not null default now(),

  constraint action_plan_steps_unique_order unique (action_plan_id, step_order),
  constraint action_plan_steps_unique_key unique (action_plan_id, step_key),

  -- The database half of "supported execution requires a real capability" (§67).
  -- The application enforces it too; this makes a bug there fail loudly rather
  -- than persisting a step that claims Vibe can act with nothing behind it.
  constraint action_plan_steps_capability_matches_support check (
    (execution_support = 'vibe_executes_now' and capability is not null)
    or (execution_support <> 'vibe_executes_now' and capability is null)
  )
);

comment on table public.action_plan_steps is
  'The ordered steps of a plan. Planning only — nothing here is executed (CORE-2b §100).';

comment on column public.action_plan_steps.execution_support is
  'Server-derived. The model has no field for this; only the capability registry can produce vibe_executes_now (CORE-2b §10, §46).';

create index action_plan_steps_plan_order_idx
  on public.action_plan_steps (action_plan_id, step_order);

alter table public.action_plan_steps enable row level security;

-- Ownership runs through the plan, which runs through the project.
create policy "select own action_plan_steps"
  on public.action_plan_steps
  for select using (
    exists (
      select 1
      from public.action_plans a
      join public.projects p on p.id = a.project_id
      where a.id = action_plan_steps.action_plan_id and p.user_id = auth.uid()
    )
  );

create policy "insert own action_plan_steps"
  on public.action_plan_steps
  for insert with check (
    exists (
      select 1
      from public.action_plans a
      join public.projects p on p.id = a.project_id
      where a.id = action_plan_id and p.user_id = auth.uid()
    )
  );

create policy "delete own action_plan_steps"
  on public.action_plan_steps
  for delete using (
    exists (
      select 1
      from public.action_plans a
      join public.projects p on p.id = a.project_id
      where a.id = action_plan_steps.action_plan_id and p.user_id = auth.uid()
    )
  );

-- No update policy, deliberately. A completed plan is immutable: replanning
-- creates a new plan and supersedes the old one rather than editing it, so a
-- plan a founder read yesterday still says what it said (§43).
