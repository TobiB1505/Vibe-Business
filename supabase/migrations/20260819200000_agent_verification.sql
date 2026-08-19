-- ---------------------------------------------------------------------
-- Agent Verification: what the run was allowed to check, and what it did
-- ---------------------------------------------------------------------
-- Run #4 spent 4m58s of a 6m28s run on `pnpm typecheck`, `pnpm test` and
-- `pnpm build` — and the independent validator then ran install/typecheck/
-- test/build again against the prepared branch, taking about the same five
-- minutes. All three agent checks passed first time, so the whole 4m58s found
-- nothing. Seventy-seven per cent of a paid run went on rehearsing a verdict
-- the agent does not get to give.
--
-- Two different jobs had collapsed into one:
--
--   Agent Verification      helps the agent find and repair its own mistakes.
--                           Advisory. Bounded. Authorizes nothing.
--   Independent Validation  decides whether a Prepared Change may progress
--                           toward human approval and merge. Authoritative,
--                           isolated, and NOT touched by this migration.
--
-- These columns record the first of those so the second stays the only
-- authority — and so run #5 can be compared to run #4 on evidence.

alter table public.agent_execution_runs
  -- The compiled plan. Derived server-side from structured step facts
  -- (change kind, Vibe-minted evidence ids) and the spec's own risk class —
  -- never from a model's prose, and never from repository content.
  add column verification_mode text
    check (verification_mode is null or verification_mode in ('low', 'medium', 'high')),
  add column verification_plan_version text,

  -- What the plan actually cost. Observed from the harness's own tool stream
  -- and its result file, never from the agent's account of itself (Rule 77).
  add column verification_commands integer
    check (verification_commands is null or verification_commands >= 0),
  add column verification_refusals integer
    check (verification_refusals is null or verification_refusals >= 0),
  add column verification_ms integer
    check (verification_ms is null or verification_ms >= 0),

  -- The boundary between building and checking.
  --
  -- Named for what is actually observable. Vibe cannot see the moment an agent
  -- believes it is finished; it can see the last time the agent wrote a file,
  -- and everything after that instant was either checking or exploring. That is
  -- an approximation and the column name says so, rather than a column called
  -- `implementation_complete_ms` implying a signal nobody emits.
  add column time_to_first_edit_ms integer
    check (time_to_first_edit_ms is null or time_to_first_edit_ms >= 0),
  add column time_to_last_edit_ms integer
    check (time_to_last_edit_ms is null or time_to_last_edit_ms >= 0);

comment on column public.agent_execution_runs.verification_mode is
  'How much self-checking this task was allowed. Derived from structured step facts and risk class, never from prose. Advisory throughout: it never authorizes a merge and never substitutes for independent validation.';

comment on column public.agent_execution_runs.verification_refusals is
  'Check commands the harness refused as outside the plan. Never silent — the agent is told, and each refusal is also an event.';

comment on column public.agent_execution_runs.time_to_last_edit_ms is
  'Offset of the last observed file write. An approximation of "implementation complete" — Vibe cannot observe that moment directly, and this column is named for what it actually measures.';

comment on column public.agent_execution_runs.verification_ms is
  'Wall clock from the first permitted check command to the end of the run, as counted inside the sandbox. Not comparable to independent validation duration: different machine, different commands, different authority.';

-- ---------------------------------------------------------------------
-- Five more event types
-- ---------------------------------------------------------------------
-- `verification_command_refused` is the one that matters most. PART G is
-- explicit that commands are never silently blocked: the agent is told in its
-- tool result, and this is the other half of that promise — a person reading
-- the timeline can see that Vibe stopped a full build and why, so a plan that
-- is too tight shows up as evidence rather than as an agent that mysteriously
-- did less work.

alter table public.agent_execution_events
  drop constraint if exists agent_execution_events_type_check;

alter table public.agent_execution_events
  add constraint agent_execution_events_type_check check (type in (
    'workspace_preparing', 'workspace_ready', 'workspace_failed',
    'context_compiled', 'context_used',
    'verification_plan_compiled', 'verification_check_started',
    'verification_command_refused', 'verification_escalated',
    'verification_completed',
    'agent_started', 'turn_completed', 'agent_finished',
    'file_read', 'file_written', 'file_edited', 'file_searched',
    'command_started', 'command_completed', 'command_failed',
    'usage_updated',
    'change_discovered', 'change_verified', 'change_rejected', 'branch_prepared',
    'sandbox_stopping', 'sandbox_stopped',
    'validation_started', 'validation_completed',
    'execution_completed', 'execution_failed'
  ));
