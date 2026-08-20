-- ---------------------------------------------------------------------
-- completion_windows: separate a window reset from a repair
-- ---------------------------------------------------------------------
-- Run #6 recorded `repair_cycles: 1` and nothing had failed. It wrote
-- src/app/layout.tsx, then src/app/app/layout.tsx — two ordinary
-- implementation edits — and one counter was being asked to mean both "the
-- completion window reset" and "the agent fixed something it got wrong".
--
-- The budget semantics were right: any mutation resets the window, because an
-- agent still changing files has not finished. Only the name was wrong, and a
-- name that overstates convergence trouble is one a reader acts on.
--
--   completion_windows   mutations after the first. Each bought back a window.
--   repair_cycles        of those, the ones that answered an observed failure.
--
-- Historical rows keep whatever `repair_cycles` held, which for run #6 is the
-- window count. Null here rather than a back-fill: the two numbers only
-- diverge when a failure was observed, and no stored row records that.

alter table public.agent_execution_runs
  add column completion_windows integer
    check (completion_windows is null or completion_windows >= 0);

comment on column public.agent_execution_runs.completion_windows is
  'Mutations after the first. Each one reset the post-implementation budget, which is what keeps the edit-check-fix-recheck loop alive. Always >= repair_cycles.';

comment on column public.agent_execution_runs.repair_cycles is
  'Mutations that answered a failure the harness observed. A strict subset of completion_windows — an ordinary second edit is a window reset, not a repair. Rows before 20260819230000 hold the window count under this name.';
