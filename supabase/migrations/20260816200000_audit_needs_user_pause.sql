-- CORE-2a.4 — the audit can pause and wait for the founder.
--
-- A `needs_user` audit has claimed its slot, prepared its evidence, and stopped
-- *before* spending any inference, because the gate that decides whether a
-- question is worth asking is deterministic and runs first. So this state costs
-- nothing while it waits, and it may wait for hours.
--
-- The two partial indexes below must both learn about it, and for different
-- reasons:
--
--   `single_in_flight` — a paused audit is still in flight. Without this, a
--   second audit for the same inputs could start while the first is waiting for
--   an answer, and both would then race to spend a paid call.
--
--   `one_included` — a paused audit that is consuming the free entitlement is
--   still consuming it. Without this, a project could pause its included audit
--   and start a second included one, which is exactly the hole CORE-2 closed.
--
-- Widening is safe here in a way that CORE-2a.2's index change was not: no row
-- can already hold the new status, so there is nothing to collide with. The
-- ordering lesson from that migration still applies and is simply not tested by
-- this one.

alter table public.business_readiness_audits
  drop constraint business_readiness_audits_status_check;

alter table public.business_readiness_audits
  add constraint business_readiness_audits_status_check
  check (status in ('pending', 'analyzing', 'needs_user', 'completed', 'failed'));

drop index if exists public.business_readiness_audits_single_in_flight_idx;
create unique index business_readiness_audits_single_in_flight_idx
  on public.business_readiness_audits (project_id, input_hash)
  where status in ('pending', 'analyzing', 'needs_user');

drop index if exists public.business_readiness_audits_one_included_idx;
create unique index business_readiness_audits_one_included_idx
  on public.business_readiness_audits (project_id)
  where access_mode = 'included_first_audit'
    and status in ('pending', 'analyzing', 'needs_user', 'completed');

-- The question currently in front of the founder, or null when none is.
--
-- Stored on the audit rather than in a table of its own because it is run
-- state, not a record: exactly one question can be pending per audit, it is
-- replaced rather than accumulated, and it dies with the run. A separate table
-- would invite it to outlive the audit it belongs to.
--
-- Never holds an answer. Answers go to `project_founder_intent` or
-- `product_profile_corrections`, which are the canonical stores — a copy here
-- would be the second source of truth CORE-2 spent a sprint deleting.
alter table public.business_readiness_audits
  add column pending_question jsonb;

-- Which question intents this run has already put to the founder, including
-- those answered "not sure yet".
--
-- The record of *asking*, which is what stops a loop. An honest "I haven't
-- decided" leaves the underlying field empty, so without this the gate would
-- see an unresolved fact and ask again, forever.
alter table public.business_readiness_audits
  add column asked_intents text[] not null default '{}'::text[];

comment on column public.business_readiness_audits.status is
  'Lifecycle of one audit run. ''needs_user'' means the run has paused before inference and is waiting for a founder-only answer; it holds its in-flight and entitlement claims while waiting, and has spent nothing (CORE-2a.4).';

comment on column public.business_readiness_audits.pending_question is
  'The single question currently in front of the founder, or null. Run state, never an answer — answers belong to project_founder_intent or product_profile_corrections (CORE-2a.4 §18, §20).';

comment on column public.business_readiness_audits.asked_intents is
  'Question intents already put to the founder in this run, including ones answered "not sure yet". What stops the gate re-asking a question the founder has honestly answered with an unknown (CORE-2a.4 §17, §45).';
