-- ---------------------------------------------------------------------
-- agent_execution_runs.observed_path_count
-- ---------------------------------------------------------------------
-- Run #3 stored `changed_file_count: 14` for a change of two files.
--
-- Both numbers were correct and the column held the wrong one. The agent's
-- build wrote twelve generated artifacts into the workspace; Vibe observed
-- fourteen paths, compared them against the pinned base, withheld the twelve
-- the repository ignores, and prepared a change of two. The collect step wrote
-- the number it had — the observation — into a column named for the other one.
--
-- A column named `changed_file_count` that holds an observation is the same
-- class of defect as `turns` against `maxAgentTurns`: two real quantities, one
-- name, and a reader who cannot tell which they are looking at. Run #2 is what
-- happens when that confusion reaches a decision — eighteen touched paths read
-- as eighteen changes.
--
-- So the observation gets its own column and `changed_file_count` goes back to
-- meaning what it says: the size of the candidate Vibe verified and would
-- write. It is written by the extract step, which is the only step that knows
-- it, and stays 0 for a run that never got that far.

alter table public.agent_execution_runs
  add column observed_path_count integer not null default 0
    check (observed_path_count >= 0);

comment on column public.agent_execution_runs.observed_path_count is
  'Workspace paths Vibe observed as touched, before comparison against the pinned base. Always >= changed_file_count. Written by the collect step.';

comment on column public.agent_execution_runs.changed_file_count is
  'Files in the verified candidate change — what Vibe would write. NOT what the runtime touched; see observed_path_count. Written by the extract step.';

-- Historical rows carried the observation in `changed_file_count`, so move it
-- to the column that now means that.
update public.agent_execution_runs
set observed_path_count = changed_file_count
where changed_file_count > 0;

-- Then restore the real candidate count where one was ever established.
--
-- Derived rather than guessed: `change_verified` records what Vibe actually
-- verified, so a run that reached that point has its true number in the event
-- log. Run #3 becomes 14 observed / 2 changed, which is what happened. A run
-- that never got that far keeps 0 — it prepared nothing, and 0 is the honest
-- value rather than the observation standing in for it.
update public.agent_execution_runs r
set changed_file_count = coalesce((
  select (e.metadata->>'candidateFiles')::integer
  from public.agent_execution_events e
  where e.agent_execution_run_id = r.id
    and e.type = 'change_verified'
    and e.metadata ? 'candidateFiles'
  order by e.sequence desc
  limit 1
), 0)
where r.observed_path_count > 0;
