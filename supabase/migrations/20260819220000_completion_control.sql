-- ---------------------------------------------------------------------
-- Post-implementation completion control
-- ---------------------------------------------------------------------
-- Run #5 halved the wall clock and did not reduce cost. Its implementation was
-- complete at 59.3s; the run lasted 191.8s. Of the 132.5 seconds after the last
-- edit — 69% of the run — eight of fifteen provider calls and $0.1496 of
-- $0.3199 were spent, on nine tool actions of which four were the job:
--
--   read layout.tsx, read app/layout.tsx        the required diff review
--   grep src                                    exploration
--   read .../nextjs-seo-foundations.ts          outside the brief, unrelated
--   node -e "…dependencies.next"                re-derived a brief fact
--   grep src/app, glob                          exploration
--   grep landing-contract.test.ts               locating a test
--   vitest run …contract.test.ts                the permitted targeted test
--
-- Nothing failed. Nothing in the evidence justified the widening.
--
-- These columns record where a run's time and money actually went, so run #6
-- can be compared to run #5 on the tail specifically rather than on a total
-- that hides it.

alter table public.agent_execution_runs
  add column completion_budget_version text,
  add column post_edit_tool_calls integer
    check (post_edit_tool_calls is null or post_edit_tool_calls >= 0),
  add column post_edit_reads integer
    check (post_edit_reads is null or post_edit_reads >= 0),
  add column post_edit_reads_beyond_brief integer
    check (post_edit_reads_beyond_brief is null or post_edit_reads_beyond_brief >= 0),
  add column post_edit_commands integer
    check (post_edit_commands is null or post_edit_commands >= 0),
  add column post_edit_provider_calls integer
    check (post_edit_provider_calls is null or post_edit_provider_calls >= 0),
  -- Numeric, and separate from provider_cost_usd, which stays exactly as it is.
  add column post_edit_provider_cost_usd numeric(12, 6)
    check (post_edit_provider_cost_usd is null or post_edit_provider_cost_usd >= 0),
  add column completion_refusals integer
    check (completion_refusals is null or completion_refusals >= 0),
  add column repair_cycles integer
    check (repair_cycles is null or repair_cycles >= 0),
  -- Every tool call the policy hook saw.
  --
  -- The column that would have caught run #5 in one glance: many tool calls
  -- and zero decisions is a policy that is not running, which otherwise reads
  -- exactly like a policy with nothing to refuse.
  add column policy_decisions integer
    check (policy_decisions is null or policy_decisions >= 0);

comment on column public.agent_execution_runs.policy_decisions is
  'Tool calls the PreToolUse policy hook saw. Zero beside a run with tool calls means the policy never ran — the failure mode that made run #5 execute a governed command while recording nothing.';

comment on column public.agent_execution_runs.post_edit_provider_cost_usd is
  'Provider cost recorded after the last observed file write. Derived by comparing usage-row timestamps against that one boundary; null whenever the boundary is unknown. Never a substitute for provider_cost_usd, which is unchanged.';

comment on column public.agent_execution_runs.repair_cycles is
  'File mutations after the first. Each one bought back a completion window, which is what keeps the edit-check-fix-recheck loop possible without an exemption a model could ask for.';

comment on column public.agent_execution_runs.completion_refusals is
  'Post-implementation actions the runtime refused. Advisory resource control over model behaviour — never a security boundary, and never a statement about whether the change is safe.';

-- ---------------------------------------------------------------------
-- Completion event types
-- ---------------------------------------------------------------------

alter table public.agent_execution_events
  drop constraint if exists agent_execution_events_type_check;

alter table public.agent_execution_events
  add constraint agent_execution_events_type_check check (type in (
    'workspace_preparing', 'workspace_ready', 'workspace_failed',
    'context_compiled', 'context_used',
    'verification_plan_compiled', 'verification_check_started',
    'verification_command_refused', 'verification_escalated',
    'verification_completed',
    'completion_budget_compiled', 'completion_window_started',
    'completion_action_refused', 'completion_repair_started',
    'agent_started', 'turn_completed', 'agent_finished',
    'file_read', 'file_written', 'file_edited', 'file_searched',
    'command_started', 'command_completed', 'command_failed',
    'usage_updated',
    'change_discovered', 'change_verified', 'change_rejected', 'branch_prepared',
    'sandbox_stopping', 'sandbox_stopped',
    'validation_started', 'validation_completed',
    'execution_completed', 'execution_failed'
  ));
