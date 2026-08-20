-- ---------------------------------------------------------------------
-- Execution Context Intelligence: what a run was told, and what it read
-- ---------------------------------------------------------------------
-- Run #3 spent eight minutes forty-four, twenty-one provider calls and $0.3465
-- to change two files by sixteen lines. Fourteen file reads and ten commands of
-- that went on establishing a repository layout Vibe had already analysed,
-- stored and pinned to that exact commit before the run started.
--
-- The agent now starts from an Execution Brief compiled from that stored
-- intelligence. These columns record what it was given and what it did with it,
-- so the next run can be compared to the last one on evidence rather than on
-- an impression that it "felt faster".
--
-- ## Why columns rather than one jsonb blob
--
-- Because the question these exist to answer is comparative — "did briefed runs
-- read fewer files than unbriefed ones on the same step?" — and that is a query
-- across runs, not a document per run. The brief itself is not stored here at
-- all: it is derived, reproducible from the spec and the snapshot it names, and
-- persisting a copy would be a second source of truth for something already
-- stored cleanly.
--
-- ## Why every one of them is nullable
--
-- A brief is an optimisation and it may legitimately be absent — no snapshot,
-- a snapshot at a different commit, a project analysed before the analyzer
-- existed. Null means "this run had no brief", and zero would claim it had one
-- that offered nothing. Every historical row is null for exactly that reason:
-- they ran under agent-prompt-v1, and no back-fill can invent what they were
-- never given.

alter table public.agent_execution_runs
  -- What was compiled and sent.
  add column context_brief_version text,
  add column context_freshness text
    check (context_freshness is null or context_freshness in ('fresh', 'stale', 'unknown')),
  add column context_bytes integer
    check (context_bytes is null or context_bytes >= 0),
  add column context_facts_sent integer
    check (context_facts_sent is null or context_facts_sent >= 0),
  add column context_candidates_sent integer
    check (context_candidates_sent is null or context_candidates_sent >= 0),

  -- What the run then read. Observed from the harness's own tool stream, never
  -- from the agent's account of itself (Rule 77).
  add column context_candidates_read integer
    check (context_candidates_read is null or context_candidates_read >= 0),
  add column unique_files_read integer
    check (unique_files_read is null or unique_files_read >= 0),
  add column repeated_file_reads integer
    check (repeated_file_reads is null or repeated_file_reads >= 0),
  add column files_read_outside_context integer
    check (files_read_outside_context is null or files_read_outside_context >= 0);

comment on column public.agent_execution_runs.context_freshness is
  'Whether the repository intelligence described the commit this run worked against. Only ''fresh'' means repository-derived facts and paths were sent; ''stale'' and ''unknown'' mean Vibe had intelligence and deliberately withheld it — a different fact from having none, which is null.';

comment on column public.agent_execution_runs.context_bytes is
  'Rendered prompt bytes the brief occupied. The number the provider billed for, not the size of what was known.';

comment on column public.agent_execution_runs.context_candidates_read is
  'File candidates the agent opened at least once. Evidence the brief was used — never evidence the change is correct.';

comment on column public.agent_execution_runs.files_read_outside_context is
  'Distinct files read that the brief did not name. Not a failure: the instruction tells the agent to look wider when the briefing does not cover what it needs.';

comment on column public.agent_execution_runs.repeated_file_reads is
  'Reads landing on an already-read path. Re-reading is paid for twice, so it is counted separately rather than folded into a total.';

-- ---------------------------------------------------------------------
-- Two more event types
-- ---------------------------------------------------------------------
-- The closed vocabulary gains exactly two members, and both are Vibe's own
-- observations rather than anything the harness reports:
--
--   context_compiled   what was selected, and what it cost to send
--   context_used       what the run then read, counted against it
--
-- Deliberately not one event per briefed file read. Those counts are already
-- derivable from the `file_read` events plus the candidate list, and doubling
-- the log to restate something it already contains is how a telemetry table
-- becomes the largest table in the database.

alter table public.agent_execution_events
  drop constraint if exists agent_execution_events_type_check;

alter table public.agent_execution_events
  add constraint agent_execution_events_type_check check (type in (
    'workspace_preparing', 'workspace_ready', 'workspace_failed',
    'context_compiled', 'context_used',
    'agent_started', 'turn_completed', 'agent_finished',
    'file_read', 'file_written', 'file_edited', 'file_searched',
    'command_started', 'command_completed', 'command_failed',
    'usage_updated',
    'change_discovered', 'change_verified', 'change_rejected', 'branch_prepared',
    'sandbox_stopping', 'sandbox_stopped',
    'validation_started', 'validation_completed',
    'execution_completed', 'execution_failed'
  ));
