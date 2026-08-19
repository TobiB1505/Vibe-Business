-- ---------------------------------------------------------------------
-- Execution surface + lifecycle metrics (Sprint 0044)
-- ---------------------------------------------------------------------
-- Run #7 changed eight files that all legitimately needed the same edit, and
-- the runtime recorded that as "7 completion windows against a max of 4" and
-- refused the eight reads that were its own required diff review.
--
-- One counter was being asked to mean three different things:
--
--   implementation_mutations   files the task legitimately needed. Breadth.
--   convergence_mutations      files written after the run had already settled.
--   repair_cycles              mutations that answered an observed failure.
--
-- `completion_windows` is left in place and stops being written. Rows before
-- this migration hold "mutations after the first" under that name, which is not
-- the same quantity as convergence_mutations and must not be read as though it
-- were. No back-fill: the two only agree when a run never converged and
-- reopened, and nothing stored records that distinction.

alter table public.agent_execution_runs
  add column implementation_mutations integer
    check (implementation_mutations is null or implementation_mutations >= 0),
  add column convergence_mutations integer
    check (convergence_mutations is null or convergence_mutations >= 0),
  add column required_verification_actions integer
    check (required_verification_actions is null or required_verification_actions >= 0),
  add column required_verification_overrides integer
    check (required_verification_overrides is null or required_verification_overrides >= 0),
  -- What the step's own cited evidence said its execution surface was.
  add column context_surface_scopes text[],
  add column context_surface_pages integer
    check (context_surface_pages is null or context_surface_pages >= 0);

comment on column public.agent_execution_runs.implementation_mutations is
  'Files written while the change was still being implemented. Breadth, never charged against any budget — eight files that need the same edit is eight of these and nothing else.';

comment on column public.agent_execution_runs.convergence_mutations is
  'Files written after the run had already converged (a run of tool calls with no mutation in it). Each one consumed a convergence window. Churn, not breadth.';

comment on column public.agent_execution_runs.required_verification_actions is
  'Diff reviews and required checks the runtime allowed. A Vibe policy marked these required, so no Vibe resource budget may refuse them.';

comment on column public.agent_execution_runs.required_verification_overrides is
  'Of required_verification_actions, how many a completion budget alone would have refused. Zero on a healthy run; run #7''s shape is eight.';

comment on column public.agent_execution_runs.context_surface_scopes is
  'Execution surface scopes derived from the step''s Vibe-minted evidence ids — public_pages, authenticated_pages, named_surface. Never derived from the step''s prose.';

comment on column public.agent_execution_runs.context_surface_pages is
  'Route source files the surface requirement resolved to, before the candidate cap. Compare with context_candidates_sent to see what the byte budget left out.';

comment on column public.agent_execution_runs.completion_windows is
  'DEPRECATED as of 20260820100000. Held "mutations after the first", which conflated implementation breadth with convergence churn. Superseded by implementation_mutations and convergence_mutations; no longer written.';

-- ---------------------------------------------------------------------
-- Lifecycle event types
-- ---------------------------------------------------------------------

alter table public.agent_execution_events
  drop constraint if exists agent_execution_events_type_check;

alter table public.agent_execution_events
  add constraint agent_execution_events_type_check check (type in (
    'workspace_preparing', 'workspace_ready', 'workspace_failed',
    'context_compiled', 'context_used', 'execution_surface_resolved',
    'verification_plan_compiled', 'verification_check_started',
    'verification_command_refused', 'verification_escalated',
    'verification_completed', 'required_verification_allowed',
    'completion_budget_compiled', 'completion_window_started',
    'convergence_started',
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
