-- The write path can remove a file (ADR 0074).
--
-- `agentic_execution_v1` named a producer whose commits were additive: the
-- GitHub writer built its tree by adding blobs to the base, and a candidate
-- containing a deletion was refused before it reached one. A stored row must
-- keep meaning what it meant, so the wider scope is a second capability value
-- rather than a redefinition of the first — a change stored as v1 is still a
-- change nothing was removed by, and that stays readable off the row alone.
--
-- `EXECUTION_POLICY_VERSION` is deliberately unbumped, for the reason
-- `execution/schema.ts` records: the compiled policy versions what the agent's
-- *workspace* may do, and `workspace_delete_file` has been granted there since
-- CORE-4. What changed is what Vibe is willing to write to GitHub, which is the
-- question `execution_capability` answers.
--
-- Widening only. Nothing is rewritten and no row changes capability.

alter table public.prepared_changes
  drop constraint if exists prepared_changes_execution_capability_check;

alter table public.prepared_changes
  add constraint prepared_changes_execution_capability_check
  check (execution_capability in (
    'nextjs_seo_foundations_v1',
    'nextjs_seo_foundations_v2',
    'agentic_execution_v1',
    'agentic_execution_v2'
  ));

-- Restated with the new value, and this one matters more than it looks: an
-- agentic change traces to a plan step rather than to an opportunity set, so a
-- v2 row carries nulls in both columns. Left as it was, the constraint that
-- exempts only v1 would have refused every change this capability prepares.
alter table public.prepared_changes
  drop constraint if exists prepared_changes_opportunity_required_for_generators;

alter table public.prepared_changes
  add constraint prepared_changes_opportunity_required_for_generators
--
-- Written as two equality tests rather than an `in (…)` list on purpose: the
-- migration-reading helper finds a capability's permitted values by taking the
-- newest `check (execution_capability in (…))` for this table, and an `in` here
-- would be read as the enumeration and shrink it to two.
  check (
    execution_capability = 'agentic_execution_v1'
    or execution_capability = 'agentic_execution_v2'
    or (opportunity_set_id is not null and opportunity_id is not null)
  );
