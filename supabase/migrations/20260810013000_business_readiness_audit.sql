-- Sprint 4: Business Readiness Audit.
-- See docs/sprints/0004-business-readiness-audit.md and ADR 0011.
--
-- Three tables:
--   project_business_context      what the founder tells us
--   business_readiness_audits     the diagnostic result
--   ai_usage_events               internal provider-cost accounting
--
-- Deliberately absent: no prompt text, no raw model responses, no reasoning
-- traces, no customer credit ledger, no vector/embedding tables.

-- ---------------------------------------------------------------------
-- project_business_context
-- One row per project. Minimal by design (Sprint 4 §2): five fields, four
-- of them closed enums. Nothing sensitive is collected — no revenue, no
-- financial data, no personal information.
-- ---------------------------------------------------------------------
create table public.project_business_context (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Required before a first audit. Bounded so a pasted document cannot
  -- become the prompt.
  product_summary text not null check (char_length(btrim(product_summary)) between 20 and 600),
  target_customer text check (target_customer is null or char_length(btrim(target_customer)) between 1 and 300),

  stage text check (stage in ('prototype', 'launched_no_users', 'active_users', 'paid_customers')),
  monetization_model text check (
    monetization_model in ('none', 'planned', 'free', 'subscription', 'one_time', 'usage_based', 'marketplace', 'other')
  ),
  primary_goal text check (
    primary_goal in ('launch', 'get_first_users', 'monetize', 'improve_conversion', 'improve_retention', 'grow_revenue')
  ),

  -- Content hash forming part of an audit's input identity (Sprint 4 §23):
  -- editing the context invalidates audit reuse, re-saving it unchanged
  -- does not.
  context_hash text not null check (char_length(context_hash) = 64),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_business_context_project_key unique (project_id)
);

comment on table public.project_business_context is
  'Founder-supplied business context per project. Free-text fields are untrusted DATA, never instructions.';

alter table public.project_business_context enable row level security;

create trigger set_updated_at
  before update on public.project_business_context
  for each row execute function public.set_updated_at();

create policy "select own project_business_context"
  on public.project_business_context
  for select using (
    exists (select 1 from public.projects p where p.id = project_business_context.project_id and p.user_id = auth.uid())
  );

create policy "insert own project_business_context"
  on public.project_business_context
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own project_business_context"
  on public.project_business_context
  for update using (
    exists (select 1 from public.projects p where p.id = project_business_context.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own project_business_context"
  on public.project_business_context
  for delete using (
    exists (select 1 from public.projects p where p.id = project_business_context.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- business_readiness_audits
-- The diagnostic result. Stores the validated structured conclusion only —
-- never the prompt, the raw model response, or any reasoning (Sprint 4 §21,
-- §22).
-- ---------------------------------------------------------------------
create table public.business_readiness_audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Exactly which evidence produced this audit. Restrict rather than
  -- cascade: deleting a snapshot that an audit was derived from would make
  -- the audit unexplainable.
  repository_snapshot_id uuid not null
    references public.repository_intelligence_snapshots (id) on delete restrict,
  live_snapshot_id uuid not null
    references public.live_product_intelligence_snapshots (id) on delete restrict,
  business_context_hash text not null check (char_length(business_context_hash) = 64),

  -- Reproducibility set (Sprint 4 §18). An audit is only comparable to
  -- another if every one of these matches.
  schema_version text not null check (char_length(btrim(schema_version)) > 0),
  audit_version text not null check (char_length(btrim(audit_version)) > 0),
  evidence_pack_version text not null check (char_length(btrim(evidence_pack_version)) > 0),
  prompt_version text not null check (char_length(btrim(prompt_version)) > 0),
  rubric_version text not null check (char_length(btrim(rubric_version)) > 0),
  provider text not null check (char_length(btrim(provider)) > 0),
  model text not null check (char_length(btrim(model)) > 0),

  -- Digest of everything above plus the snapshot ids. This is the reuse
  -- key: an identical input hash means an identical audit, and paying for
  -- it twice is pure waste (Sprint 4 §23).
  input_hash text not null check (char_length(input_hash) = 64),

  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'completed', 'failed')),

  -- Validated structured result only. Null until the run completes.
  result jsonb,

  -- Deterministically computed by the application, never by the model.
  -- Null is a legitimate value: it means coverage was too thin for a
  -- headline figure, which is not the same as a score of zero
  -- (Sprint 4 §6, §7).
  overall_score smallint check (overall_score is null or overall_score between 0 and 100),
  assessed_dimensions smallint check (assessed_dimensions is null or assessed_dimensions between 0 and 5),
  total_dimensions smallint check (total_dimensions is null or total_dimensions between 0 and 5),

  -- Typed failure code only (e.g. 'provider_refusal'). Never a raw
  -- provider error (Sprint 4 §27).
  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed audit must carry its result and its coverage verdict.
  constraint business_readiness_audits_completed_has_result
    check (status <> 'completed' or (result is not null and assessed_dimensions is not null))
);

comment on table public.business_readiness_audits is
  'Diagnostic Business Readiness Audit. Validated structured conclusions only — never prompts, raw responses, or model reasoning.';

comment on column public.business_readiness_audits.overall_score is
  'Computed deterministically by the application from scored dimensions. Null means coverage was insufficient, NOT a score of zero.';

-- Latest-audit lookup for the project page.
create index business_readiness_audits_project_created_idx
  on public.business_readiness_audits (project_id, created_at desc);

-- Reuse lookup (Sprint 4 §23): identical input means an identical audit.
create index business_readiness_audits_reuse_idx
  on public.business_readiness_audits (project_id, input_hash, status);

-- Concurrency guard (Sprint 4 §24): at most one in-flight audit per
-- project + input. A double-clicked "Run audit" therefore fails the second
-- insert at the database rather than buying a second identical inference
-- call. No queue or lock service involved.
create unique index business_readiness_audits_single_in_flight_idx
  on public.business_readiness_audits (project_id, input_hash)
  where status in ('pending', 'analyzing');

alter table public.business_readiness_audits enable row level security;

create trigger set_updated_at
  before update on public.business_readiness_audits
  for each row execute function public.set_updated_at();

create policy "select own business_readiness_audits"
  on public.business_readiness_audits
  for select using (
    exists (select 1 from public.projects p where p.id = business_readiness_audits.project_id and p.user_id = auth.uid())
  );

create policy "insert own business_readiness_audits"
  on public.business_readiness_audits
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own business_readiness_audits"
  on public.business_readiness_audits
  for update using (
    exists (select 1 from public.projects p where p.id = business_readiness_audits.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own business_readiness_audits"
  on public.business_readiness_audits
  for delete using (
    exists (select 1 from public.projects p where p.id = business_readiness_audits.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- ai_usage_events
-- Internal provider-cost accounting (Sprint 4 §25). This is NOT the
-- customer Vibe Credit ledger — no margin, no credits, no billing.
--
-- Least privilege, deliberately asymmetric (Sprint 4 §33): the owning user
-- may INSERT (the application writes through their request-scoped client,
-- so there is no service-role path), but there is intentionally NO select,
-- update, or delete policy. Provider billing detail is therefore
-- write-only from any client's perspective and unreadable through the
-- public API — internal analysis happens through direct database access,
-- not through the app.
-- ---------------------------------------------------------------------
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  operation text not null check (char_length(btrim(operation)) > 0),
  provider text not null check (char_length(btrim(provider)) > 0),
  model text not null check (char_length(btrim(model)) > 0),
  -- The audit (or future job) this call belongs to. Deliberately not a
  -- foreign key: the ledger must outlive the job it paid for, because a
  -- deleted audit does not undo a charge.
  job_id uuid,

  status text not null check (status in ('succeeded', 'failed')),

  -- Null when the call failed before any tokens were billed. Recording
  -- zero as if it were charged would corrupt the ledger (Sprint 4 §27).
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  thinking_tokens integer check (thinking_tokens is null or thinking_tokens >= 0),
  -- Pre-call estimate, kept alongside the actual count to measure drift.
  estimated_input_tokens integer check (estimated_input_tokens is null or estimated_input_tokens >= 0),

  -- Nine decimal places because a single audit costs a small fraction of a
  -- cent; rounding to cents would record every call as $0.00.
  provider_cost_usd numeric(18, 9) check (provider_cost_usd is null or provider_cost_usd >= 0),
  pricing_version text,

  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  failure_code text,

  created_at timestamptz not null default now()
);

comment on table public.ai_usage_events is
  'Internal AI provider-cost accounting. Never contains prompts, responses, reasoning, or secrets. Insert-only via RLS; not readable through the public API.';

create index ai_usage_events_project_created_idx
  on public.ai_usage_events (project_id, created_at desc);

create index ai_usage_events_operation_created_idx
  on public.ai_usage_events (operation, created_at desc);

alter table public.ai_usage_events enable row level security;

-- Insert only. The absence of a select policy is the access control: with
-- RLS enabled and no policy for a command, that command is denied.
create policy "insert own ai_usage_events"
  on public.ai_usage_events
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );
