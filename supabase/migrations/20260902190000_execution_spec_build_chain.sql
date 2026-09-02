-- A run may deliver more than one plan step (build-chain-v1).
--
-- A Move's build is not one step. Measured over every completed plan in this
-- product: six runs of contiguous vibe/product_change steps — four of length
-- two, two of length three, and never one. The Planner splits engineering work
-- for a founder's readability, not for an execution boundary, and a run that
-- can carry the whole contiguous run of it delivers one commit, one approval
-- and one fast-forward instead of two or three.
--
-- `step_key` and `step_order` stay singular and not null: the head is still the
-- delivery target. It is what `loadPlanStep` finds, what the commit-message
-- compiler anchors its subject to, and what provenance is derived from. The two
-- arrays below are every step the run delivers *including* that head.
--
-- Two parallel arrays rather than one jsonb array of objects, and that is the
-- whole reason for the shape: only this way can the constraints below exist.
-- The completion projection is about to decide, from this row, whether several
-- plan steps are finished — ADR 0054's first authority is "an immutable
-- execution_specs row binds this plan and this step", and extending that
-- binding to several steps should be as constrainable in SQL as the single one.
--
-- Empty arrays mean exactly today's meaning, which is why this needs no
-- backfill: every existing row *was* a single-step run, and '{}' is the true
-- value for it rather than a placeholder.

alter table public.execution_specs
  add column if not exists chain_step_keys   text[]    not null default '{}'::text[],
  add column if not exists chain_step_orders integer[] not null default '{}'::integer[];

comment on column public.execution_specs.chain_step_keys is
  'Every plan step this one run delivers, head first, including step_key. Empty for a run that delivers a single step, which is every run before build-chain-v1. Feeds the completion projection and the spec identity.';

comment on column public.execution_specs.chain_step_orders is
  'The step orders matching chain_step_keys, in the same order. Strictly ascending.';

-- Both or neither, and always the same length. A row with keys and no orders
-- would complete steps the projection could not name.
alter table public.execution_specs
  add constraint execution_specs_chain_arrays_agree
  check (
    array_length(chain_step_keys, 1) is not distinct from array_length(chain_step_orders, 1)
  );

-- Two helpers, because PostgreSQL refuses a subquery inside a CHECK and both
-- properties below are about the *elements* of an array. `immutable` so they
-- may be used in a constraint at all, `set search_path = ''` for the same
-- reason every function in this schema has it, and neither reads a table — they
-- are pure predicates over their argument.

create or replace function public.chain_keys_are_present(p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_keys = '{}'::text[]
      or (select bool_and(btrim(key) <> '') from unnest(p_keys) as key);
$$;

comment on function public.chain_keys_are_present(text[]) is
  'True when every element is a non-blank step key. Exists because a CHECK constraint cannot contain a subquery.';

create or replace function public.chain_orders_ascend(p_orders integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_orders = '{}'::integer[]
      or (
        select bool_and(p_orders[i] > p_orders[i - 1])
        from generate_subscripts(p_orders, 1) as i
        where i > 1
      ) is not false;
$$;

comment on function public.chain_orders_ascend(integer[]) is
  'True when the orders strictly ascend, which also makes them distinct. Exists because a CHECK constraint cannot contain a subquery.';

-- No blank key. `step_key` carries the same check on its own column, and a
-- chain member is the same kind of value.
alter table public.execution_specs
  add constraint execution_specs_chain_keys_non_empty
  check (public.chain_keys_are_present(chain_step_keys));

-- Strictly ascending, which makes the orders distinct and makes "head first,
-- then the successors in plan order" a property of the row rather than of the
-- writer.
alter table public.execution_specs
  add constraint execution_specs_chain_orders_ascending
  check (public.chain_orders_ascend(chain_step_orders));

-- The one that matters: a spec's head is always a member of its own chain.
--
-- Without it a row could claim to deliver steps 3 and 4 while being the spec
-- for step 2 — an artifact whose completion, price and provenance disagree
-- about what it is. The application refuses the same shape in
-- `buildExecutionSpec`; this is the half that holds when the application is
-- not the writer.
alter table public.execution_specs
  add constraint execution_specs_chain_contains_head
  check (
    chain_step_keys = '{}'::text[]
    or (step_key = any (chain_step_keys) and step_order = any (chain_step_orders))
  );
