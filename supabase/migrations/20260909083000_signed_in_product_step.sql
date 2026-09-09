-- The founder was offered the signed-in read of their product, and said not now.
--
-- Setup gains one step between confirming what Vibe understood and the audit:
-- Vibe has read the code and the public site, and everything behind the
-- product's login is still unread. `evidence-v3.ts` already writes that gap
-- into every audit that runs without it — "Nothing behind the product's login
-- has been inspected, so anything only visible to signed-in users is
-- unobserved" — and until now nothing in setup offered to close it.
--
-- ## Why one column, and why a timestamp this time
--
-- Two of the three answers are already canonical rows elsewhere, and copying
-- them here would create a second place to disagree with:
--
--   done          a completed authenticated_product_intelligence_snapshots row
--   not offerable no production_url on the project
--   not now       nothing anywhere — this column
--
-- `nova_workflow_status` next door is a text status rather than an `_at` for a
-- reason that does not apply here: it had to record two different presses, one
-- of which explained nothing, so a column named `..._explained_at` would have
-- been false half the time. This column records one event that either happened
-- or did not, and "has not been asked yet" is legible as null precisely
-- because "already scanned" lives in the snapshot table rather than here.
--
-- Declining is not permanent and is not meant to be. My Product carries the
-- Deep Scan spotlight for exactly this founder, and clearing this column is
-- how a later offer would be made — it is a record of an answer, never a
-- setting that closes a door.

alter table public.project_onboarding
  add column signed_in_product_declined_at timestamptz;

comment on column public.project_onboarding.signed_in_product_declined_at is
  'When the founder declined the signed-in read during setup. Null means not asked or not answered; whether a scan happened is the snapshot table''s fact, not this one.';

-- The lifecycle gains a step, so the constraint that guards it has to learn it.
--
-- `contract.test.ts` compares ONBOARDING_STATES against whatever the migration
-- history's newest CHECK permits, and a union that a database rejects is a
-- deploy where every write of the new state fails while the suite stays green.
-- Dropped and re-added rather than edited in place: the original migration is
-- applied history and is not rewritten (rule 34).

alter table public.project_onboarding
  drop constraint if exists project_onboarding_state_check;

alter table public.project_onboarding
  add constraint project_onboarding_state_check
    check (state in (
      'connect_source',
      'add_live_product',
      'product_scanning',
      'product_reveal',
      'add_signed_in_product',
      'audit_preparing',
      'audit_needs_user',
      'audit_running',
      'audit_reveal',
      'first_move',
      'complete'
    ));
