-- Backfill the Move an agentic change descends from.
--
-- Why
-- ---
-- `prepared_changes.opportunity_set_id` and `.opportunity_id` are what the card
-- builder turns into the block that says *what this change was for*. The
-- agent's branch step wrote both as null, on a reading of 20260818210000's own
-- comment that went one step too far: that migration said an agentic change
-- traces to a plan step rather than to an opportunity set, and it also said the
-- opportunity **is still known** — the plan hangs off a Move. Only the set was
-- in doubt, and only because a NOT NULL reference to a regenerated set would
-- make an artifact that exists on GitHub unrepresentable. Nullable was the
-- right answer to that. Always-null was not.
--
-- The cost was on a founder's phone: every change the product has ever made
-- named nothing it was for. The branch step stores the lineage from now on;
-- this is the same value for the changes already written.
--
-- What it does not do
-- -------------------
-- It invents nothing. Every value comes from rows that already exist — the
-- run's spec names the Move it was authorized against, and the plan that spec
-- names carries the set. A change whose run, spec, plan or set is missing is
-- left exactly as it is: null is a legitimate state here and the constraint
-- below has always permitted it for an agentic capability.
--
-- It touches no idempotency. The single-active index is on
-- `(project_id, execution_identity)`, and an agent's identity is computed from
-- the run and the candidate digest, not from an opportunity.

--
-- The two columns are not the same kind of identifier, which is the thing this
-- join exists to handle. `execution_specs.opportunity_id` is **text** and may
-- name no stored Move at all — an internal benchmark's is a fixture key.
-- `prepared_changes.opportunity_id` is a **uuid with a foreign key**. So the
-- Move is matched through `business_opportunities` rather than cast: a cast
-- would abort the whole migration on the first fixture key, while a join
-- simply does not match it. It also checks the condition that actually
-- matters — that the Move belongs to the plan's own set.

update public.prepared_changes as pc
set
  opportunity_set_id = lineage.opportunity_set_id,
  opportunity_id = lineage.opportunity_id
from (
  select distinct on (aer.operation_run_id)
    aer.operation_run_id,
    ap.opportunity_set_id,
    bo.id as opportunity_id
  from public.agent_execution_runs as aer
  join public.execution_specs as es on es.id = aer.execution_spec_id
  join public.action_plans as ap on ap.id = es.action_plan_id
  -- Compared as text on the uuid side, never cast on the text side: a value
  -- that is not a uuid must fail to match, not raise.
  join public.business_opportunities as bo
    on bo.opportunity_set_id = ap.opportunity_set_id
   and bo.id::text = es.opportunity_id
  -- Newest first, so a re-run that produced a second agent run for the same
  -- operation resolves deterministically rather than arbitrarily.
  order by aer.operation_run_id, aer.created_at desc
) as lineage
where pc.operation_run_id = lineage.operation_run_id
  and pc.opportunity_set_id is null
  and pc.opportunity_id is null
  -- No capability filter, and its absence is the stronger statement: the join
  -- above is to `agent_execution_runs`, so a row only reaches here because an
  -- agent produced it. A deterministic preparation has no agent run, and the
  -- `is null` guards would exclude it regardless — the constraint requires it
  -- to carry both ids.
  --
  -- It was written as a capability filter first, which cost two failing tests.
  -- `execution/schema.test.ts` finds the permitted capabilities by scanning
  -- this directory for the newest constraint on that column, matching either an
  -- IN list or an equality against a literal. Any mention of the column in
  -- either shape is read as the enumeration and shrinks it — a comment quoting
  -- the pattern does it too, which is why this paragraph describes it in words.
  -- 20260902160000 had recorded half of the hazard already.
  ;
