-- ADR 0091: which steps a run absorbed, durably, so actionability can read it.
--
-- `absorbedPreparationKeys` has always gone into the spec identity — two runs
-- carrying different preparation are different execution boundaries — but it
-- reached no column, so nothing could ask "was this step covered by a run that
-- succeeded?". The plan therefore kept offering an absorbed step as the thing
-- to do next, and a founder who did it would have been redoing work the agent
-- had already performed inside the run that absorbed it.
--
-- The shape mirrors `chain_step_keys` exactly, for the reason that migration
-- gives: two parallel arrays rather than one jsonb array of objects, because
-- only this way can the constraints below exist. The projection that reads them
-- decides what a founder is asked to do, and that binding should be as
-- constrainable in SQL as the delivery binding beside it.
--
-- One constraint is the *inverse* of the chain's, and it is the point of the
-- whole distinction: a chain must contain its head, and absorbed preparation
-- must never contain it. A step does not absorb itself, and a row claiming it
-- did would let one step satisfy its own prerequisite.
--
-- Empty arrays mean exactly today's meaning, so no backfill: every existing row
-- either absorbed nothing or absorbed something no reader has ever consulted,
-- and '{}' is the honest value for a run whose preparation was never recorded
-- here. A stored row is never reinterpreted — the spec document still holds
-- what it always held.

alter table public.execution_specs
  add column if not exists absorbed_step_keys   text[]    not null default '{}'::text[],
  add column if not exists absorbed_step_orders integer[] not null default '{}'::integer[];

comment on column public.execution_specs.absorbed_step_keys is
  'Plan steps this run performs as preparation rather than delivers, in plan order. Never contains step_key. Empty for a run that absorbed nothing, and for every row written before ADR 0091. Feeds the actionability projection, never the completion projection.';

comment on column public.execution_specs.absorbed_step_orders is
  'The step orders matching absorbed_step_keys, in the same order. Strictly ascending.';

alter table public.execution_specs
  add constraint execution_specs_absorbed_arrays_agree
  check (
    array_length(absorbed_step_keys, 1) is not distinct from array_length(absorbed_step_orders, 1)
  );

-- The same two pure predicates the chain columns use. They are about the
-- elements of an array and a CHECK cannot hold a subquery, which is why they
-- exist as functions at all; reusing them keeps one definition of "these are
-- real keys" and "these ascend" rather than two that could drift.
alter table public.execution_specs
  add constraint execution_specs_absorbed_keys_non_empty
  check (public.chain_keys_are_present(absorbed_step_keys));

alter table public.execution_specs
  add constraint execution_specs_absorbed_orders_ascending
  check (public.chain_orders_ascend(absorbed_step_orders));

-- The inverse of `execution_specs_chain_contains_head`, and the reason this
-- column is separate from that one. A run absorbing its own head would satisfy
-- its own prerequisite; the application refuses the same shape in
-- `buildExecutionSpec`, and this is the half that holds when the application is
-- not the writer.
alter table public.execution_specs
  add constraint execution_specs_absorbed_excludes_head
  check (
    not (step_key = any (absorbed_step_keys))
    and not (step_order = any (absorbed_step_orders))
  );

-- Delivered or absorbed, never both. `resolveBuildChain` carries
-- `product_change` steps and `classifyExecutionDependency` absorbs `analysis`
-- ones, so the sets are disjoint by construction — this makes that a property
-- of the row rather than of the two functions agreeing forever.
alter table public.execution_specs
  add constraint execution_specs_absorbed_disjoint_from_chain
  check (not (absorbed_step_orders && chain_step_orders));
