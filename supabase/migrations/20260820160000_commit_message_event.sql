-- ---------------------------------------------------------------------
-- commit_message_compiled event type (Sprint 0046)
-- ---------------------------------------------------------------------
-- Agentic commits read "vibe: implement plan step 4" — traceable to Vibe's
-- own state, useless to a human reading GitHub or Vercel afterwards. The
-- commit message compiler (src/modules/execution/commit-message.ts) replaces
-- that with a Conventional-Commits message derived from the trusted Action
-- Step and Vibe-minted evidence ids, never from the coding agent's own output.
--
-- This one new event type is the only schema change the sprint needs: no new
-- table, no new columns on prepared_changes or agent_execution_runs. Full
-- commit text is never persisted here — Git is already the source of truth
-- for that — only the small structured fields (type, scope, subject,
-- fallback, fallbackReason) that make "how often does Vibe generate feat vs
-- fix vs a fallback" a queryable question over agent_execution_events.

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
    'change_discovered', 'change_verified', 'change_rejected',
    'commit_message_compiled', 'branch_prepared',
    'sandbox_stopping', 'sandbox_stopped',
    'validation_started', 'validation_completed',
    'execution_completed', 'execution_failed'
  ));
