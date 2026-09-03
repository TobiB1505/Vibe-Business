-- NOVA-3: the two first-run facts that cannot be derived.
--
-- Nova's positions are otherwise read from canonical rows on every render —
-- a snapshot, a profile, an audit, a prepared change. These two are not
-- derivable from anything: whether Nova has introduced herself to this
-- project, and whether the founder has been shown how the loop works. Both
-- are presentation milestones, which is exactly what this table already
-- exists to hold (ADR 0023), so they are columns here rather than a
-- `nova_state` table of fields that are mostly derivable.
--
-- ## Why a status rather than a second `_at`
--
-- The first draft of this had `nova_workflow_explained_at`, to be written both
-- when the founder pressed "Show me" and when they pressed "Start now". In the
-- second case nothing was explained, so the column would have recorded
-- something that did not happen. A long-lived domain column does not get a
-- name that is false half the time.
--
-- `skipped` is therefore a value and not an absence — the same reasoning that
-- made `no_live_site_yet` a `live_site_status` rather than a null on this very
-- table. "The founder chose to get on with it" and "the founder has not been
-- asked yet" are different facts, and a nullable timestamp cannot tell them
-- apart.
--
-- ## What is deliberately not here
--
-- `deferred_recommendation_key` + `deferred_at`, proposed alongside these and
-- withdrawn before they were written. One column holds one deferral, and Nova
-- outlives onboarding — "pricing later" is not a fact about how a founder got
-- through setup. If deferral is wanted it is its own table with one active row
-- per subject, not a column here.

alter table public.project_onboarding
  add column nova_introduced_at timestamptz,
  add column nova_workflow_status text not null default 'unseen';

alter table public.project_onboarding
  add constraint project_onboarding_nova_workflow_status_check
    check (nova_workflow_status in ('unseen', 'explained', 'skipped'));

-- The workflow cannot have been answered before Nova has said anything: both
-- writes are Nova's own, in order, and a row claiming otherwise is a bug in
-- the write path rather than a state a founder can reach.
alter table public.project_onboarding
  add constraint project_onboarding_nova_workflow_needs_introduction
    check (nova_workflow_status = 'unseen' or nova_introduced_at is not null);

comment on column public.project_onboarding.nova_introduced_at is
  'When Nova first introduced herself for this project. Null means she has not; set once and never rewritten.';

comment on column public.project_onboarding.nova_workflow_status is
  'Whether the founder was shown how the loop works. skipped is a real answer, not an absence.';
