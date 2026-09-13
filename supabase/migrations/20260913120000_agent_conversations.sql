-- ---------------------------------------------------------------------
-- agent_conversations: what Nova and the founder said to each other
-- ---------------------------------------------------------------------
--
-- ADR 0109 accepted the Business Agent as the orchestrator, and this is the
-- first vertical slice's half of it: five tables that hold a conversation, the
-- turns that answered it, and the tool calls each turn made.
--
-- ## Conversations store what was said. They never store what is true.
--
-- The distinction is the whole design. A message is a record of an exchange; a
-- Move, an Action Plan, an audit and a prepared change are canonical rows that
-- keep changing after the message that mentioned them. So a message never
-- carries a copy of one — `agent_message_artifacts` carries a *reference*, and
-- the thread renders the row as it is now, beside the message's own date. A
-- Move that was replanned therefore renders as it is, not as it was described,
-- which is the only version a founder can act on.
--
-- Nothing here is authoritative for anything except the words. Delete every row
-- in these five tables and the product still knows the same things about the
-- project.
--
-- ## There is no column a reasoning trace can occupy
--
-- Rule 43. `agent_messages.content` is a founder-visible message that has
-- already passed `checkAgentReply`, and there is no second text column beside
-- it. The tool-call table stores the arguments, the byte count and the subject
-- ids — never the rendered result, never the prompt, never the model's own
-- account of what it did. That is not an omission to be corrected later; adding
-- such a column is the thing this comment exists to make somebody argue for.
--
-- ## No client writes, on any of the five
--
-- `select` to `authenticated` through project ownership, and nothing else. Every
-- write comes from `src/modules/operations/business-agent/`, which holds the
-- service-role client (rule 53), so the founder's browser can read the thread
-- and cannot author a turn, a tool call, or a message attributed to Nova.
-- ---------------------------------------------------------------------

create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Vibe-derived from the founder's first message, never model-written.
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- The founder's own control. A conversation is never swept by age: a record
  -- of what Vibe told somebody is closer to an audit trail than to a scan event.
  archived_at timestamptz
);

comment on table public.agent_conversations is
  'One thread between a founder and the Business Agent. Holds what was said; never what is true.';

create index agent_conversations_project_recent_idx
  on public.agent_conversations (project_id, last_message_at desc);
create index agent_conversations_user_idx
  on public.agent_conversations (user_id);

alter table public.agent_conversations enable row level security;

create policy "select own agent_conversations"
  on public.agent_conversations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = agent_conversations.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.agent_conversations from anon, authenticated;
grant select on table public.agent_conversations to authenticated;
grant select, insert, update on table public.agent_conversations to service_role;

-- ---------------------------------------------------------------------

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 1-based and contiguous within a conversation. The order is the record.
  sequence integer not null check (sequence >= 1),
  role text not null check (role in ('founder', 'assistant')),
  -- A founder may write more than Nova may answer, and both are bounded here
  -- rather than only in the composer: a length limit enforced in one place is
  -- a length limit one code path can walk past.
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  -- Where the words came from. `model` is the only value that implies a paid
  -- call, and it is the only one that requires a turn to point at.
  origin text not null check (origin in ('typed', 'model', 'template')),
  turn_run_id uuid,
  created_at timestamptz not null default now(),
  constraint agent_messages_sequence_unique unique (conversation_id, sequence),
  constraint agent_messages_model_has_turn check (origin <> 'model' or turn_run_id is not null),
  constraint agent_messages_founder_is_typed check (role <> 'founder' or origin = 'typed')
);

comment on table public.agent_messages is
  'One message. Assistant content has already passed founder-visible validation. No column holds model reasoning.';

create index agent_messages_conversation_sequence_idx
  on public.agent_messages (conversation_id, sequence);
create index agent_messages_project_idx
  on public.agent_messages (project_id);
create index agent_messages_turn_run_idx
  on public.agent_messages (turn_run_id);

alter table public.agent_messages enable row level security;

create policy "select own agent_messages"
  on public.agent_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = agent_messages.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.agent_messages from anon, authenticated;
grant select on table public.agent_messages to authenticated;
grant select, insert on table public.agent_messages to service_role;

-- ---------------------------------------------------------------------

create table public.agent_message_artifacts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.agent_messages (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Closed, and deliberately short: a kind with no renderer is a reference the
  -- thread would silently drop (rule 15).
  kind text not null check (kind in ('opportunity', 'audit')),
  -- The canonical row's id. Not a foreign key, because the kinds point at
  -- different tables and a row may be superseded without the record of having
  -- mentioned it becoming false. Resolution happens on render, and an
  -- unresolvable reference renders as absent rather than as invented.
  subject_id text not null check (char_length(subject_id) between 1 and 200),
  position smallint not null check (position between 1 and 20),
  created_at timestamptz not null default now(),
  constraint agent_message_artifacts_position_unique unique (message_id, position)
);

comment on table public.agent_message_artifacts is
  'A reference from a message to a canonical row. Never a copy of it.';

create index agent_message_artifacts_message_idx
  on public.agent_message_artifacts (message_id, position);
create index agent_message_artifacts_project_idx
  on public.agent_message_artifacts (project_id);

alter table public.agent_message_artifacts enable row level security;

create policy "select own agent_message_artifacts"
  on public.agent_message_artifacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = agent_message_artifacts.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.agent_message_artifacts from anon, authenticated;
grant select on table public.agent_message_artifacts to authenticated;
grant select, insert on table public.agent_message_artifacts to service_role;

-- ---------------------------------------------------------------------

create table public.agent_turn_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Cascade rather than restrict, deliberately.
  --
  -- A turn is meaningless without the operation that carried it, and the only
  -- thing that deletes an operation row is the project going away — which
  -- deletes this row too, by its own `project_id` edge. A RESTRICT here would
  -- buy nothing and would put a second, order-dependent edge across a delete
  -- that has to complete: account erasure walks roughly forty tables, and the
  -- one failure mode nobody can recover from is a person who asked to be
  -- deleted and could not be.
  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,
  founder_message_id uuid not null references public.agent_messages (id) on delete cascade,
  assistant_message_id uuid references public.agent_messages (id) on delete set null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  stop_reason text check (char_length(stop_reason) <= 60),
  failure_code text check (char_length(failure_code) <= 80),
  -- Whether the founder read Nova's words or Vibe's. A turn that fell back is
  -- not a failed turn: the founder got an answer, and this is how often that
  -- answer was a template.
  reply_source text check (reply_source in ('model', 'template')),
  fallback_reason text check (char_length(fallback_reason) <= 40),
  model text check (char_length(model) <= 80),
  -- Four versions, as agent_execution_runs carries four, so any stored reply can
  -- be read against the instructions, tools, skills and policy that produced it.
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  tool_registry_version text not null check (char_length(tool_registry_version) between 1 and 80),
  skill_registry_version text not null check (char_length(skill_registry_version) between 1 and 80),
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  model_calls integer not null default 0 check (model_calls >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  duration_ms integer check (duration_ms >= 0),
  -- Written before the first paid call and never cleared, so an ambiguous
  -- outcome resolves to a failed turn rather than to a second charge (rule 50).
  inference_started_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.agent_turn_runs is
  'One turn: what it was given, what it did, what it cost. The operation row points at this.';

-- One live turn per conversation, in the database rather than in the
-- application: two requests can both pass an application check and only one
-- can win an index.
create unique index agent_turn_runs_single_live_idx
  on public.agent_turn_runs (conversation_id)
  where status in ('queued', 'running');

create index agent_turn_runs_conversation_idx
  on public.agent_turn_runs (conversation_id, started_at desc);
create index agent_turn_runs_project_idx
  on public.agent_turn_runs (project_id);
create index agent_turn_runs_user_idx
  on public.agent_turn_runs (user_id);
create index agent_turn_runs_operation_idx
  on public.agent_turn_runs (operation_run_id);
create index agent_turn_runs_founder_message_idx
  on public.agent_turn_runs (founder_message_id);
create index agent_turn_runs_assistant_message_idx
  on public.agent_turn_runs (assistant_message_id);

alter table public.agent_turn_runs enable row level security;

create policy "select own agent_turn_runs"
  on public.agent_turn_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = agent_turn_runs.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.agent_turn_runs from anon, authenticated;
grant select on table public.agent_turn_runs to authenticated;
grant select, insert, update on table public.agent_turn_runs to service_role;

-- ---------------------------------------------------------------------

create table public.agent_turn_tool_calls (
  id uuid primary key default gen_random_uuid(),
  turn_run_id uuid not null references public.agent_turn_runs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  tool text not null check (char_length(tool) between 1 and 80),
  classification text check (classification in ('read_only', 'prepare')),
  -- Every refusal is a named one. `allowed` means Vibe ran it; the other four
  -- are the ways a request is answered without being run.
  decision text not null check (
    decision in ('allowed', 'unknown_tool', 'invalid_arguments', 'duplicate_call', 'tool_budget_exhausted')
  ),
  denial_reason text check (char_length(denial_reason) <= 400),
  -- The arguments as given. Small by construction: every tool in the registry
  -- takes at most one short identifier.
  input jsonb not null default '{}'::jsonb,
  result_kind text check (result_kind in ('ok', 'error', 'empty')),
  result_bytes integer check (result_bytes >= 0),
  subject_ids jsonb not null default '[]'::jsonb,
  duration_ms integer check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  constraint agent_turn_tool_calls_sequence_unique unique (turn_run_id, sequence),
  constraint agent_turn_tool_calls_denial_has_reason check (
    decision = 'allowed' or denial_reason is not null
  )
);

comment on table public.agent_turn_tool_calls is
  'One tool call and what Vibe decided about it. Holds arguments and sizes; never the rendered result.';

create index agent_turn_tool_calls_turn_idx
  on public.agent_turn_tool_calls (turn_run_id, sequence);
create index agent_turn_tool_calls_project_idx
  on public.agent_turn_tool_calls (project_id);

alter table public.agent_turn_tool_calls enable row level security;

create policy "select own agent_turn_tool_calls"
  on public.agent_turn_tool_calls
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = agent_turn_tool_calls.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.agent_turn_tool_calls from anon, authenticated;
grant select on table public.agent_turn_tool_calls to authenticated;
grant select, insert on table public.agent_turn_tool_calls to service_role;

-- ---------------------------------------------------------------------
-- operation_runs: one new type, three new stages
-- ---------------------------------------------------------------------
--
-- A CHECK cannot be extended in place, so both lists are restated in full.
-- Every value below the marked line is the list already in force.

alter table public.operation_runs
  drop constraint operation_runs_operation_type_check,
  add constraint operation_runs_operation_type_check check (
    operation_type in (
      'business_audit', 'opportunity_generation', 'change_preparation',
      'change_validation', 'change_preview', 'preview_teardown', 'change_review',
      'change_merge', 'change_outcome_verification', 'business_measurement',
      'product_understanding', 'product_scan', 'action_planning', 'agent_execution',
      'account_erasure',
      -- ADR 0109, vertical slice 1.
      'agent_turn'
    )
  );

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
    'preparing_workspace', 'running_agent', 'extracting_change', 'verifying_change',
    'starting_dev_server',
    -- ADR 0109. Three stages a founder waits through while Nova answers, each
    -- one a thing that actually happens rather than a fraction of anything.
    'understanding_request', 'consulting_evidence', 'composing_reply',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- ai_usage_events: a turn is many calls under one job id
-- ---------------------------------------------------------------------
--
-- The same lesson `20260819010000_agent_usage_cardinality.sql` learned from the
-- first real agent run, arriving here before the first real turn instead of
-- after it: one turn makes up to eight sampling calls, the unique index would
-- accept the first and reject the other seven, and the ledger would under-count
-- exactly the operation whose cost nobody has measured yet.
--
-- Uniqueness is lifted for `agent_turn` alone, by name, in the predicate — not
-- weakened for anything else.

drop index if exists public.ai_usage_events_job_idx;

create unique index ai_usage_events_job_idx
  on public.ai_usage_events (job_id)
  where job_id is not null
    and operation <> 'agentic_execution'
    and operation <> 'agent_turn';
