-- ---------------------------------------------------------------------
-- agent_execution_runs: assistant_messages, sdk_loop_iterations
-- ---------------------------------------------------------------------
-- `turns` counted one thing and `budget.maxAgentTurns` bounded another, and
-- run b33635a1 recorded 66 against a ceiling of 40 while overrunning nothing.
--
--   assistant_messages    one per model response
--   sdk_loop_iterations   the harness's own loop, which advances on tool
--                         results as well — the unit the ceiling is in
--
-- Neither is derivable from the other and their ratio is not a number anybody
-- should read. A single column called `turns` meant the run row could not say
-- which one it held, and in fact it held both at different moments: every
-- progress write during a run stored the message count, and the terminal write
-- replaced it with the SDK's `num_turns`. A row's meaning changed depending on
-- whether the run had finished.
--
-- This is the last instance of the naming family that also produced
-- `changed_file_count` holding an observation (20260819140000).
--
-- ## Why `turns` is renamed rather than kept as an alias
--
-- Because an alias would leave the ambiguous name reachable, and the whole
-- defect is that somebody read the ambiguous name and believed it. A rename
-- fails loudly at every call site instead.

alter table public.agent_execution_runs
  rename column turns to assistant_messages;

comment on column public.agent_execution_runs.assistant_messages is
  'Model responses this run produced — one per assistant message. NOT comparable to budget.maxAgentTurns, which bounds the harness loop; see sdk_loop_iterations.';

-- Nullable, and that is the point: the SDK reports this only in its terminal
-- message, so a run that died before one has no honest value here. Zero would
-- claim the harness looped zero times, and the message count is not a stand-in.
alter table public.agent_execution_runs
  add column sdk_loop_iterations integer
    check (sdk_loop_iterations is null or sdk_loop_iterations >= 0);

comment on column public.agent_execution_runs.sdk_loop_iterations is
  'The harness''s own loop count, in the unit budget.maxAgentTurns bounds. Null when the harness never reported one — never the message count standing in.';

-- Historical rows are left as message counts, which is what they mostly are:
-- every intermediate write stored one, and only a run that reached its terminal
-- message had it replaced. `sdk_loop_iterations` stays null for all of them
-- rather than being back-filled from a column whose unit is not knowable per
-- row. An unknown recorded as unknown beats a plausible number nobody can check.
