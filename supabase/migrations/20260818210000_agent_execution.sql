-- EXECUTION CORE-4: the first sandbox coding agent.
--
-- See docs/sprints/0040-execution-core4-first-coding-agent.md and ADR 0027.
--
-- Three durable concepts, and no more (§22). An agentic execution is carried by
-- the existing `operation_runs` machinery; what it needs beyond that is a
-- record binding one run to its spec, its policy, its model and its result —
-- plus the tool trail a security review reads, and the question a run may stop
-- on. Everything else already exists: PreparedChange, ValidationRun,
-- ReviewArtifact, ChangeApproval, the credit reservation, the two usage ledgers.
--
-- Deliberately absent: prompts, model output, reasoning, source files, diffs,
-- command output containing anything unbounded, and any credential. There is no
-- column any of those could occupy.

-- ---------------------------------------------------------------------
-- operation_runs gains the agentic execution type and its stages.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint if exists operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation',
    'change_validation', 'change_preview', 'preview_teardown', 'change_review',
    'change_merge', 'change_outcome_verification', 'business_measurement',
    'product_understanding', 'action_planning',
    -- EXECUTION CORE-4.
    'agent_execution'
  ));

alter table public.operation_runs
  drop constraint if exists operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'asking_founder', 'running_ai', 'prioritizing',
    'planning', 'preflight', 'generating_change', 'writing_repository',
    'verifying_repository', 'validating', 'persisting',
    'provisioning', 'acquiring_source', 'verifying_source', 'securing_sandbox',
    'installing', 'typechecking', 'testing', 'building', 'collecting_results',
    'cleaning_up',
    'restoring_artifact', 'verifying_artifact', 'starting_server', 'checking_preview',
    'capturing_before', 'capturing_after', 'persisting_artifacts',
    'authorizing', 'writing_default_ref', 'verifying_default_ref', 'converging',
    'observing', 'evaluating',
    'collecting_baseline', 'collecting_post', 'comparing',
    'reading_code', 'reading_public_product', 'understanding_product',
    -- EXECUTION CORE-4. `running_agent` is the paid stage; the rest are the
    -- durable steps around it, named for what a waiting user is told.
    'preparing_workspace', 'running_agent', 'extracting_change', 'verifying_change',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- prepared_changes accepts agent-produced changes.
-- ---------------------------------------------------------------------
-- One new capability value, not a taxonomy (§3). It names the *producer* —
-- "these bytes came from the bounded coding agent" — which is the only thing a
-- stored row needs in order to stay interpretable. The task it implemented is
-- recoverable through the ExecutionSpec the run is bound to.
alter table public.prepared_changes
  drop constraint if exists prepared_changes_execution_capability_check;

alter table public.prepared_changes
  add constraint prepared_changes_execution_capability_check
  check (execution_capability in (
    'nextjs_seo_foundations_v1', 'nextjs_seo_foundations_v2', 'agentic_execution_v1'
  ));

-- An agentic change traces to an Action Plan step, not to an opportunity set.
-- The opportunity is still known — the plan hangs off a Move — but the *set* it
-- belonged to may have been regenerated since, and a NOT NULL reference to it
-- would make an artifact that exists on GitHub unrepresentable.
alter table public.prepared_changes
  alter column opportunity_set_id drop not null;

alter table public.prepared_changes
  alter column opportunity_id drop not null;

-- Restated rather than assumed: a deterministic preparation must still name
-- both. Only an agentic one may omit them.
alter table public.prepared_changes
  add constraint prepared_changes_opportunity_required_for_generators
  check (
    execution_capability = 'agentic_execution_v1'
    or (opportunity_set_id is not null and opportunity_id is not null)
  );

-- The branch prefix constraint already reads `branch_name like 'vibe/%'`, which
-- `vibe/agent-…` satisfies. Recorded here so a reader does not go looking.

-- ---------------------------------------------------------------------
-- agent_execution_runs
-- ---------------------------------------------------------------------
-- The one new durable concept (§22). It binds an ExecutionSpec to the run that
-- implemented it: which provider, which model, under which policy, with which
-- reservation, against which commit, and what came out.
create table public.agent_execution_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Denormalized from projects so a workflow step, which runs with no user
  -- session, has a trusted owner to filter on (ADR 0013).
  user_id uuid not null references auth.users (id) on delete cascade,

  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,

  -- Restricted rather than cascaded: losing the spec must not orphan a run that
  -- produced a branch on someone's repository.
  execution_spec_id uuid not null references public.execution_specs (id) on delete restrict,

  -- What made this run "the same job" as a duplicate click (§56).
  run_identity text not null check (char_length(run_identity) = 64),

  -- Who did the work, and under what rules. Every one of these is part of what
  -- "the agent was bounded" meant, so a stored run stays interpretable when the
  -- rules move (§65 of the validation-identity discipline).
  provider text not null check (char_length(btrim(provider)) > 0),
  harness text not null check (char_length(btrim(harness)) > 0),
  model text not null check (char_length(btrim(model)) > 0),
  coding_agent_policy_version text not null,
  prompt_compiler_version text not null,
  budget_policy_version text not null,
  execution_policy_version text not null,

  -- Explicitly marked, never inferred (§18). True for every CORE-4 dogfood run.
  non_production_economics boolean not null default true,

  -- The exact commit the work was defined against. No "latest main" anywhere.
  base_sha text not null check (char_length(base_sha) between 7 and 64),

  -- The Billing hold this run spent against, when it had one. Not a foreign key
  -- for the reason the usage ledgers are not: the record must outlive the hold.
  credit_reservation_id uuid,

  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_user_input', 'succeeded', 'failed', 'cancelled')),

  -- Typed code only, never an exception message (§34).
  failure_code text,

  -- What Vibe observed. Counts and durations — never content.
  turns integer not null default 0 check (turns >= 0),
  tool_calls_allowed integer not null default 0 check (tool_calls_allowed >= 0),
  tool_calls_denied integer not null default 0 check (tool_calls_denied >= 0),
  files_read integer not null default 0 check (files_read >= 0),
  check_runs integer not null default 0 check (check_runs >= 0),
  repair_attempts integer not null default 0 check (repair_attempts >= 0),
  changed_file_count integer not null default 0 check (changed_file_count >= 0),
  changed_bytes integer not null default 0 check (changed_bytes >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),

  -- The provider's own session identifier, when it exposes one that is an id
  -- rather than a bearer credential (§38). Never a reconnect token.
  provider_session_id text,

  -- What this run produced, once it produced something. The bridge into the
  -- existing pipeline (§29) — after this point every downstream concept is the
  -- one that already existed.
  prepared_change_id uuid references public.prepared_changes (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  -- A failed run must say why, so nothing downstream invents a reason.
  constraint agent_execution_runs_failed_has_code
    check (status <> 'failed' or failure_code is not null),

  -- A successful run must point at the change it produced. "Succeeded" with no
  -- prepared change is the state that would let a report claim work that has no
  -- artifact behind it (§33, §34).
  constraint agent_execution_runs_succeeded_has_change
    check (status <> 'succeeded' or prepared_change_id is not null),

  constraint agent_execution_runs_terminal_has_completed_at
    check ((status in ('succeeded', 'failed', 'cancelled')) = (completed_at is not null))
);

comment on table public.agent_execution_runs is
  'One bounded coding-agent execution. Counts, versions and references only — never prompts, model output, reasoning or source.';

comment on column public.agent_execution_runs.non_production_economics is
  'True when the run was authorized by the internal CORE-4 dogfood budget. No production Agent Credit price exists.';

comment on column public.agent_execution_runs.provider_session_id is
  'Opaque provider identifier for support correlation. Never a bearer credential and never exposed to a browser.';

-- Idempotency (§56). At most one live-or-successful run per identity, enforced
-- by the database rather than by the application alone: a double submission
-- loses its second insert here instead of buying a second coding agent.
create unique index agent_execution_runs_single_active_idx
  on public.agent_execution_runs (project_id, run_identity)
  where status in ('queued', 'running', 'needs_user_input', 'succeeded');

create index agent_execution_runs_project_created_idx
  on public.agent_execution_runs (project_id, created_at desc);

create index agent_execution_runs_operation_idx
  on public.agent_execution_runs (operation_run_id);

create index agent_execution_runs_spec_idx
  on public.agent_execution_runs (execution_spec_id, created_at desc);

alter table public.agent_execution_runs enable row level security;

create trigger set_updated_at
  before update on public.agent_execution_runs
  for each row execute function public.set_updated_at();

-- Read-only to the owner. Rows are written by durable execution through the
-- service role; a record the client can write is not a record.
create policy "select own agent_execution_runs"
  on public.agent_execution_runs
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = agent_execution_runs.project_id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- agent_tool_events
-- ---------------------------------------------------------------------
-- The tool trail (§24). Bounded facts about brokered calls: what was asked for,
-- what was decided, which path, which Vibe-constructed command, how long, and
-- whether it worked.
--
-- Deliberately absent: file contents, command output, model reasoning,
-- credentials, and any free-text field a sentence could occupy.
create table public.agent_tool_events (
  id uuid primary key default gen_random_uuid(),
  agent_execution_run_id uuid not null
    references public.agent_execution_runs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  sequence integer not null check (sequence > 0),

  tool text not null check (char_length(tool) between 1 and 80),
  capability text,

  decision text not null check (decision in ('allowed', 'denied')),
  denial_reason text,

  -- Repository-relative and normalized. A path is a fact about the change, not
  -- a statement about it.
  path text check (path is null or char_length(path) <= 400),
  -- Vibe-constructed. Never a repository-supplied or model-supplied string.
  command text check (command is null or char_length(command) <= 200),

  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),

  success boolean,
  exit_code integer,
  bytes integer check (bytes is null or bytes >= 0),

  created_at timestamptz not null default now(),

  constraint agent_tool_events_denied_has_reason
    check (decision <> 'denied' or denial_reason is not null),

  constraint agent_tool_events_unique_sequence
    unique (agent_execution_run_id, sequence)
);

comment on table public.agent_tool_events is
  'Bounded audit of every tool call the gateway brokered. No content, no output, no reasoning.';

create index agent_tool_events_run_idx
  on public.agent_tool_events (agent_execution_run_id, sequence);

alter table public.agent_tool_events enable row level security;

create policy "select own agent_tool_events"
  on public.agent_tool_events
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = agent_tool_events.project_id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- agent_activity_events
-- ---------------------------------------------------------------------
-- The customer-safe surface (§23). A closed vocabulary, derived from what Vibe
-- observed — a tool call it brokered, a command it ran. None of these is a
-- model self-report, and the table has no field one could be written into.
create table public.agent_activity_events (
  id uuid primary key default gen_random_uuid(),
  agent_execution_run_id uuid not null
    references public.agent_execution_runs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  sequence integer not null check (sequence > 0),

  event text not null check (event in (
    'inspecting_repository', 'searching_code', 'found_existing_pattern', 'editing_files',
    'running_typecheck', 'running_tests', 'running_build', 'repairing', 'validating',
    'needs_user_input', 'waiting_for_budget', 'ready_for_review', 'failed_safely'
  )),

  occurred_at timestamptz not null,

  -- Counts and paths only. There is no message column, deliberately: a schema
  -- that cannot express a sentence cannot leak a reasoning trace (§23, Rule 43).
  files_read integer check (files_read is null or files_read >= 0),
  changed_paths jsonb,
  command text check (command is null or char_length(command) <= 200),

  created_at timestamptz not null default now(),

  constraint agent_activity_events_unique_sequence
    unique (agent_execution_run_id, sequence)
);

comment on table public.agent_activity_events is
  'Customer-safe activity states derived from observed tool calls. Never model narration; no message column exists.';

create index agent_activity_events_run_idx
  on public.agent_activity_events (agent_execution_run_id, sequence);

alter table public.agent_activity_events enable row level security;

create policy "select own agent_activity_events"
  on public.agent_activity_events
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = agent_activity_events.project_id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- execution_interrupts
-- ---------------------------------------------------------------------
-- Core-3 defined the contract and refused to create the table, because nothing
-- raised an interrupt. Core-4 supplies the writer, so the table arrives with it.
--
-- The question is Vibe-authored from a closed situation vocabulary; the answer
-- is structured data. There is no `thinking`, no `rationale`, no transcript and
-- no free-form message from the model — §34 and Rule 43 forbid persisting
-- reasoning, and the way to enforce that is to have nowhere to put it.
create table public.execution_interrupts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  execution_spec_id uuid not null references public.execution_specs (id) on delete restrict,
  agent_execution_run_id uuid not null
    references public.agent_execution_runs (id) on delete cascade,

  interrupt_type text not null check (interrupt_type in (
    'business_decision_required', 'materially_different_outcomes',
    'permission_semantics_unknown', 'external_paid_service_required',
    'destructive_migration_required', 'scope_expansion_required',
    'additional_credits_required', 'consequential_action_approval_required'
  )),

  -- Vibe-authored copy for the situation above. Stored so a historical
  -- interrupt keeps meaning what it meant when the customer read it.
  question text not null check (char_length(btrim(question)) > 0),

  -- The shape of a valid answer: single_choice with options, confirmation, or
  -- bounded text. Validated in code against the same contract.
  response_schema jsonb not null,

  status text not null default 'open'
    check (status in ('open', 'answered', 'cancelled', 'expired')),

  -- Structured, matching response_schema. Never a reasoning trace.
  answer jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  answered_at timestamptz,

  constraint execution_interrupts_answered_has_answer
    check (status <> 'answered' or (answer is not null and answered_at is not null)),

  constraint execution_interrupts_open_has_no_answer
    check (status <> 'open' or answer is null)
);

comment on table public.execution_interrupts is
  'One structured question an execution stopped on. Vibe-authored question, structured answer, no reasoning.';

-- One open question per run. A run that could accumulate open questions would
-- be a chat, which §21 of CORE-3 explicitly refuses.
create unique index execution_interrupts_one_open_per_run_idx
  on public.execution_interrupts (agent_execution_run_id)
  where status = 'open';

create index execution_interrupts_project_created_idx
  on public.execution_interrupts (project_id, created_at desc);

alter table public.execution_interrupts enable row level security;

create trigger set_updated_at
  before update on public.execution_interrupts
  for each row execute function public.set_updated_at();

create policy "select own execution_interrupts"
  on public.execution_interrupts
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = execution_interrupts.project_id and p.user_id = auth.uid()
    )
  );

-- Answering is the one thing a signed-in owner may write, and the policy is the
-- boundary §49 asks for: a browser can only answer a question attached to a
-- project it owns, so no client can forge another user's interrupt answer.
-- Which *fields* may change is enforced in code, through a status-scoped update.
create policy "answer own execution_interrupts"
  on public.execution_interrupts
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = execution_interrupts.project_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = execution_interrupts.project_id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- ai_usage_events gains cache accounting.
-- ---------------------------------------------------------------------
-- An agent loop is cache-heavy by construction: the same system prompt and the
-- same growing transcript are re-sent every turn. Cache reads and cache writes
-- are billed at different rates from ordinary input, so a ledger without them
-- would understate a cached run and overstate an uncached one — and the first
-- real Agent cost baseline is the whole point of this sprint (§46).
--
-- Nullable, because every existing row predates the concept and no backfill can
-- honestly invent a value for it.
alter table public.ai_usage_events
  add column if not exists cache_read_input_tokens integer
    check (cache_read_input_tokens is null or cache_read_input_tokens >= 0);

alter table public.ai_usage_events
  add column if not exists cache_creation_input_tokens integer
    check (cache_creation_input_tokens is null or cache_creation_input_tokens >= 0);

comment on column public.ai_usage_events.cache_read_input_tokens is
  'Input tokens served from the provider prompt cache, billed at a reduced rate. Null for calls made before cache accounting existed.';

comment on column public.ai_usage_events.cache_creation_input_tokens is
  'Input tokens written to the provider prompt cache, billed at a premium. Null for calls made before cache accounting existed.';
