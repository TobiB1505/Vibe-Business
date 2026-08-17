-- CORE-2 — Audit & First Move Activation, foundation half.
-- See docs/sprints/0022-core2-audit-first-move.md.
--
-- Three changes, in an order that matters:
--
--   1. project_founder_intent          replaces project_business_context
--   2. product_profile_corrections     absorbs the product half of that table
--   3. business_readiness_audits       records the Product Profile it used,
--                                      and how its first run was paid for
--
-- Step 2 runs BEFORE step 1 drops anything. No founder-authored value is
-- dropped: every field of project_business_context is either copied into the
-- new intent table or migrated into the profile corrections table, and the
-- drop happens only after both copies are complete in the same transaction.

-- ---------------------------------------------------------------------
-- 1. project_founder_intent
--
-- What is left of Business Context once the Product Profile owns product
-- understanding (CORE-2 §4). Three closed enums, all optional, no free text
-- at all — so unlike its predecessor this table cannot carry anything
-- sensitive and nothing in it can reach a model as prose.
--
-- Nothing here is an audit prerequisite. `product_summary` used to be
-- `not null`, which made "describe your own product" a gate in front of a
-- first audit; the profile answers that from evidence now.
-- ---------------------------------------------------------------------
create table public.project_founder_intent (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  stage text check (stage in ('prototype', 'launched_no_users', 'active_users', 'paid_customers')),
  monetization_model text check (
    monetization_model in ('none', 'planned', 'free', 'subscription', 'one_time', 'usage_based', 'marketplace', 'other')
  ),
  primary_goal text check (
    primary_goal in ('launch', 'get_first_users', 'monetize', 'improve_conversion', 'improve_retention', 'grow_revenue')
  ),

  -- Part of an audit's input identity (CORE-2 §7): editing intent invalidates
  -- audit reuse, re-saving it unchanged does not.
  intent_hash text not null check (char_length(intent_hash) = 64),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_founder_intent_project_key unique (project_id)
);

comment on table public.project_founder_intent is
  'The founder''s own stage, goal and intended monetization. NOT product understanding — that is the Product Profile (CORE-2 §4). Every column is a closed enum.';

comment on column public.project_founder_intent.monetization_model is
  'The founder''s *declared intention*. What is observable — pricing surfaces, payment capability — lives in the Product Profile''s business signals instead. The value that justifies this column is ''planned'': evidence cannot see an intention.';

alter table public.project_founder_intent enable row level security;

create trigger set_updated_at
  before update on public.project_founder_intent
  for each row execute function public.set_updated_at();

create policy "select own project_founder_intent"
  on public.project_founder_intent
  for select using (
    exists (select 1 from public.projects p where p.id = project_founder_intent.project_id and p.user_id = auth.uid())
  );

create policy "insert own project_founder_intent"
  on public.project_founder_intent
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own project_founder_intent"
  on public.project_founder_intent
  for update using (
    exists (select 1 from public.projects p where p.id = project_founder_intent.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own project_founder_intent"
  on public.project_founder_intent
  for delete using (
    exists (select 1 from public.projects p where p.id = project_founder_intent.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2a. Carry the intent half across.
--
-- `intent_hash` cannot be derived correctly here: it is a sha256 over a
-- fixed-order JSON array built in TypeScript, and Postgres' own JSON text
-- output spaces its separators differently, so any SQL reconstruction would
-- produce a *plausible but wrong* digest — the worst possible outcome, since
-- it would silently match nothing while looking valid.
--
-- A padded literal is written instead. It satisfies the 64-character bound
-- and provably cannot collide with any real hash, because it contains
-- characters that are not hex digits. The application recomputes the true
-- hash on the next save.
--
-- Its only effect is that the first audit after this migration does not reuse
-- an audit produced before it. That is correct regardless: the audit contract
-- changed here, so a pre-CORE-2 audit is not a valid answer to a CORE-2 run.
-- ---------------------------------------------------------------------
insert into public.project_founder_intent (project_id, stage, monetization_model, primary_goal, intent_hash)
select
  bc.project_id,
  bc.stage,
  bc.monetization_model,
  bc.primary_goal,
  rpad('migrated-core2-founder-intent', 64, '-')
from public.project_business_context bc
on conflict (project_id) do nothing;

-- ---------------------------------------------------------------------
-- 2b. Migrate the product half into the Product Profile.
--
--   product_summary  ->  corrections.shortDescription
--   target_customer  ->  corrections.primaryAudience
--
-- This is the whole point of CORE-2 §4/§5. These two fields are statements
-- about the *product*, and a correction is the strongest form a claim can
-- take in the profile: `applyCorrections` renders one as
-- confidence `confirmed`, source `user_confirmed`, outranking every derived
-- value and surviving every re-scan.
--
-- `||` puts the migrated keys on the LEFT so an existing correction wins.
-- If a founder has already told the Product Profile directly what their
-- product is, that is newer and more considered than the summary they typed
-- into the old audit form, and it must not be overwritten by this migration.
--
-- Values are trimmed to the profile's own 600-character correction bound.
-- `product_summary` is already constrained to 20..600 and `target_customer`
-- to 1..300, so nothing is actually truncated today; the bound is applied
-- anyway so this statement cannot become the way an over-long correction
-- enters the table.
-- ---------------------------------------------------------------------
insert into public.product_profile_corrections (project_id, corrections)
select
  bc.project_id,
  jsonb_strip_nulls(
    jsonb_build_object(
      'shortDescription', left(btrim(bc.product_summary), 600),
      'primaryAudience', case
        when bc.target_customer is null then null
        else left(btrim(bc.target_customer), 600)
      end
    )
  )
from public.project_business_context bc
where btrim(bc.product_summary) <> ''
on conflict (project_id) do update
  set corrections = excluded.corrections || product_profile_corrections.corrections;

-- ---------------------------------------------------------------------
-- 2c. Retire the old model.
--
-- Dropped rather than left in place. CORE-2 §4 requires that no second
-- product-understanding model survives, and a table that still exists is a
-- table something can still be written to.
-- ---------------------------------------------------------------------
drop table public.project_business_context;

-- ---------------------------------------------------------------------
-- 3. Audit traceability (CORE-2 §7)
--
-- An audit must be able to answer, later: which understanding of the product
-- was this built on? Recording the profile id alone is not enough — the
-- profile row is replaced wholesale whenever evidence moves — so the version
-- set that produced it is recorded alongside.
--
-- `restrict` rather than `cascade`, matching the snapshot references above it:
-- deleting a profile an audit was derived from would make the audit
-- unexplainable, which is precisely what this section exists to prevent.
-- ---------------------------------------------------------------------
alter table public.business_readiness_audits
  add column product_profile_id uuid references public.product_profiles (id) on delete restrict,
  add column product_profile_schema_version text,
  add column product_profile_builder_version text,
  add column founder_intent_hash text check (
    founder_intent_hash is null or char_length(founder_intent_hash) = 64
  );

comment on column public.business_readiness_audits.product_profile_id is
  'The exact Product Profile this audit reasoned from (CORE-2 §7). Null only on rows written before CORE-2, which were built from the retired business context instead.';

-- Nullable, and deliberately so: rows written before CORE-2 have no profile,
-- and back-filling one would be inventing a fact. A stored audit must keep
-- meaning what it meant when it was written.
--
-- New rows are required to carry one. The check is expressed against the
-- audit's own evidence pack version rather than a timestamp, so it stays true
-- regardless of when the migration is applied.
alter table public.business_readiness_audits
  add constraint business_readiness_audits_v3_has_profile
  check (
    evidence_pack_version <> 'business-evidence.v3'
    or (
      product_profile_id is not null
      and product_profile_schema_version is not null
      and product_profile_builder_version is not null
      and founder_intent_hash is not null
    )
  );

-- `business_context_hash` is kept, and kept `not null`, for exactly one
-- reason: existing rows have one and it is part of what they were. New rows
-- write the founder-intent hash into it as well, so the column stays
-- satisfiable without a default that would pretend a context existed.
comment on column public.business_readiness_audits.business_context_hash is
  'Historical (Sprint 4). Since CORE-2 this carries the founder-intent hash; the business context model it was named for no longer exists. Kept rather than renamed so pre-CORE-2 rows keep meaning what they meant.';

-- ---------------------------------------------------------------------
-- 4. Free audit entitlement (CORE-2 §16, §17)
--
-- The same derivation-based design as the Deep Scan's included scan
-- (20260811190000), for the same reason: there is deliberately no boolean
-- that could claim the free audit was used while no usable audit exists.
--
-- The proof of consumption IS a completed row with access_mode
-- 'included_first_audit'. A partial unique index makes a second one
-- impossible, so the entitlement cannot be spent twice even by a race.
--
-- A failed or abandoned run therefore costs the user nothing, without any
-- refund path having to exist (CORE-2 §17).
-- ---------------------------------------------------------------------
-- ## Why there is no DEFAULT, and why a third value exists
--
-- This project already has 20 audits, and one of its projects has **10
-- completed** ones — they were run while the audit was ungated and nothing
-- limited how often it could be repeated.
--
-- A `default 'included_first_audit'` would therefore have written that value
-- onto all ten, and the partial unique index below would have failed on
-- creation with a unique violation, aborting this migration partway. Checked
-- against the live database rather than assumed (CLAUDE.md rule 30).
--
-- The fix is not to weaken the index. It is that neither existing enum value
-- is *true* of those rows: they did not consume a one-per-project entitlement,
-- because no entitlement existed, and they certainly did not spend credits.
-- Writing either would put a false statement in the database, which is the one
-- thing this column exists to prevent.
--
-- So `legacy_pre_entitlement` is the honest description of a row written before
-- the rule it would otherwise be claiming to have followed. Nothing writes it
-- going forward.
alter table public.business_readiness_audits
  add column access_mode text;

-- The earliest completed audit per project genuinely *was* that project's
-- first, and these projects have in fact already had a free audit — so
-- recording that is accurate, and it correctly leaves them without a second.
update public.business_readiness_audits a
set access_mode = 'included_first_audit'
where a.id in (
  select distinct on (project_id) id
  from public.business_readiness_audits
  where status = 'completed'
  order by project_id, created_at asc, id asc
);

-- Everything else: later repeats, and every failed run. None consumed anything.
update public.business_readiness_audits
set access_mode = 'legacy_pre_entitlement'
where access_mode is null;

-- No default: the application always supplies this explicitly, and a default is
-- precisely how ten rows would have quietly acquired an entitlement claim.
alter table public.business_readiness_audits
  alter column access_mode set not null,
  add constraint business_readiness_audits_access_mode_check
    check (access_mode in ('included_first_audit', 'credits', 'legacy_pre_entitlement'));

comment on column public.business_readiness_audits.access_mode is
  'Entitlement that funded the audit. A completed row with ''included_first_audit'' IS the proof that the project''s free audit was consumed (CORE-2 §16). Never a flag anyone can flip. ''legacy_pre_entitlement'' marks rows written before the entitlement existed, which consumed nothing.';

create unique index business_readiness_audits_one_included_idx
  on public.business_readiness_audits (project_id)
  where status = 'completed' and access_mode = 'included_first_audit';

-- ---------------------------------------------------------------------
-- 5. Making the free audit survive disconnect (CORE-2 §16)
--
-- The index above is scoped to a project, and a project is deletable. So on
-- its own it grants a fresh free audit to anyone who disconnects and
-- reconnects the same repository — which is precisely the "trivial reset"
-- CORE-2 §16 forbids.
--
-- This table is the durable half. It is keyed on the **GitHub repository
-- id**, not on a project: that id is stable across disconnect/reconnect,
-- while a project row is not. It deliberately does not reference
-- public.projects at all, so a project deletion cannot cascade it away.
--
-- What it is not: a flag. A row is written only as a consequence of an audit
-- actually completing, in the same step that completes it. Nothing else
-- writes here, there is no update path, and an internal failure produces no
-- row — so CORE-2 §17 ("a provider outage must not cost the user their free
-- audit") holds by construction rather than by a refund path.
--
-- Scoping to (user, repository) rather than to the account as a whole is
-- deliberate. A founder with three genuinely different products should get
-- three first audits; what they should not get is an unlimited supply of
-- first audits for one product.
-- ---------------------------------------------------------------------
create table public.free_audit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Stable across disconnect/reconnect. Not a foreign key: the connection row
  -- it came from is cascade-deleted with the project, and outliving that is
  -- this table's entire purpose.
  github_repository_id bigint not null,

  -- The audit that consumed it, for support and explainability. Nulled rather
  -- than cascaded when the audit goes away with its project: losing the
  -- pointer is acceptable, losing the fact of consumption is not.
  audit_id uuid references public.business_readiness_audits (id) on delete set null,

  consumed_at timestamptz not null default now(),

  constraint free_audit_grants_user_repository_key unique (user_id, github_repository_id)
);

comment on table public.free_audit_grants is
  'Durable record that a user consumed their free audit for one GitHub repository (CORE-2 §16). Survives project deletion on purpose, so disconnect/reconnect cannot mint a second free audit.';

alter table public.free_audit_grants enable row level security;

-- Readable by its owner so the UI can explain why the free audit is gone.
create policy "select own free_audit_grants"
  on public.free_audit_grants
  for select using (user_id = auth.uid());

-- No insert, update or delete policy. Consumption is recorded by durable
-- execution through the service-role client (ADR 0013), which bypasses RLS.
-- A user therefore cannot clear, forge, or replay their own entitlement
-- through the API at all — the absence of a policy is the enforcement.

-- ---------------------------------------------------------------------
-- 6. Backfill the durable half for audits that already happened.
--
-- Without this the two halves disagree for existing data: the audit rows say
-- the free audit was consumed, and the grant table says nothing — so the very
-- first disconnect/reconnect would hand those projects a fresh free audit,
-- which is the reset CORE-2 §16 exists to prevent.
--
-- An inner join, deliberately. A project with no repository connection
-- produces no grant rather than a row with an invented repository id: the
-- grant is keyed on the repository precisely because that is what survives a
-- project, and a grant that cannot name one would be meaningless.
-- ---------------------------------------------------------------------
insert into public.free_audit_grants (user_id, github_repository_id, audit_id, consumed_at)
-- `consumed_at` is `not null`; `completed_at` is not guaranteed to be set on
-- every historical completed row, so it falls back rather than failing.
select p.user_id, rc.github_repository_id, a.id, coalesce(a.completed_at, a.created_at)
from public.business_readiness_audits a
join public.projects p on p.id = a.project_id
join public.repository_connections rc on rc.project_id = a.project_id
where a.status = 'completed'
  and a.access_mode = 'included_first_audit'
on conflict (user_id, github_repository_id) do nothing;
