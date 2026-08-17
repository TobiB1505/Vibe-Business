-- CORE-2b FIX: canonical Move → Business Conclusion lineage.
-- See docs/sprints/0031-core2b-action-planner.md § "Canonical planner lineage".
--
-- The Opportunity Engine has always known which audit conclusion each Move
-- addresses — it reads the conclusions and decides what to do about them — and
-- it threw the answer away. The Action Planner then reconstructed it from
-- evidence overlap, which is a reasonable way to *recover* a fact and a poor
-- way to *hold* one: reconstruction can be ambiguous, and a strategic plan
-- built on a guessed root problem is the failure this product exists not to
-- have.
--
-- After this, the relationship is stated by the layer that knows it, and the
-- planner reads it. Reconstruction survives only as a compatibility path for
-- Moves written before this migration.
--
-- ## Why a key rather than a foreign key
--
-- A conclusion is not a row. It lives inside `business_readiness_audits.result`,
-- a JSONB document written once and never updated. So a conclusion's canonical
-- address is the pair `(business_audit_id, conclusion_key)` — and the audit id
-- is already a real FK on both tables below. Normalizing conclusions into their
-- own table would buy a single-column FK at the cost of rewriting how the audit
-- persists its judgment, for a relationship that is already unambiguous.
--
-- See src/modules/business-audit/conclusions.ts, which is the one place that
-- would have to learn about it if that ever changes.

-- ---------------------------------------------------------------------
-- business_opportunities — where the lineage is created
-- ---------------------------------------------------------------------
alter table public.business_opportunities
  add column source_conclusion_key text;

comment on column public.business_opportunities.source_conclusion_key is
  'The audit conclusion this Move addresses, as a key into the set''s own audit (e.g. blocker-1). Authoritative. Null on Moves created before CORE-2b FIX, and on a Move whose cited key did not exist — never a fabricated reference.';

-- Nullable, deliberately. Backfilling would mean re-deriving each historical
-- Move's source by the same evidence-overlap reconstruction this migration
-- exists to demote — writing a guess into the column that is supposed to hold a
-- fact, where nothing downstream could then tell the two apart. Legacy Moves
-- resolve at runtime instead, conservatively, and refuse when ambiguous.

-- Lineage lookup: "which Moves came from this conclusion?"
create index business_opportunities_source_conclusion_idx
  on public.business_opportunities (opportunity_set_id, source_conclusion_key)
  where source_conclusion_key is not null;

-- ---------------------------------------------------------------------
-- action_plans — where the lineage is recorded as provenance
-- ---------------------------------------------------------------------
alter table public.action_plans
  add column source_conclusion_key text;

-- Nullable, and the CHECK permits that without saying so: a comparison against NULL
-- evaluates to NULL, which a CHECK treats as satisfied. Writing the null case out
-- explicitly would read as a stricter rule than it is, and would hide the value list
-- from the test that pins this union against the migration.
alter table public.action_plans
  add column source_conclusion_lineage text
    check (source_conclusion_lineage in ('direct', 'legacy_reconciled'));

comment on column public.action_plans.source_conclusion_key is
  'The exact conclusion this plan was built to move, as a key into its own audit. Makes the full chain queryable: audit → conclusion → move → plan.';

comment on column public.action_plans.source_conclusion_lineage is
  'How that conclusion was established: stated by the Opportunity Engine (direct), or recovered by bounded reconstruction for a pre-CORE-2b-FIX Move (legacy_reconciled).';

-- A completed plan must know what problem it was solving (CORE-2b FIX §7, §24).
--
-- Safe to add as a CHECK because no plan row has ever existed: `action_plans`
-- is created by 20260817120000 and nothing has run against it. If that ever
-- stops being true, this becomes a `not valid` constraint plus a backfill.
alter table public.action_plans
  add constraint action_plans_completed_has_conclusion
    check (status <> 'completed' or source_conclusion_key is not null);

alter table public.action_plans
  add constraint action_plans_completed_has_lineage
    check (status <> 'completed' or source_conclusion_lineage is not null);

create index action_plans_source_conclusion_idx
  on public.action_plans (business_audit_id, source_conclusion_key)
  where source_conclusion_key is not null;
