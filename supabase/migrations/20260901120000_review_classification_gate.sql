-- Sprint 0055 — The review classification becomes a gate.
--
-- `classifyReview` has existed since Sprint 0048 and decided nothing: ADR 0037
-- called it "deterministic and advisory". The cost of that was concrete —
-- `change_approvals.review_artifact_id` was `not null`, so a change that alters
-- no rendered page could only be approved after the user paid for a preview
-- sandbox and a browser session to produce two identical screenshots.
--
-- This migration gives an approval a second, equally strong evidence form. See
-- ADR 0040.

alter table public.change_approvals
  -- Still required for a visual review, and still `on delete restrict` — an
  -- approval that cannot say what evidence it rested on is not an audit record.
  -- Nullable now only so the *other* form can be the one that is present.
  alter column review_artifact_id drop not null;

alter table public.change_approvals
  -- What kind of review this change deserved, as decided when it was approved.
  -- Pinned onto the row rather than recomputed later: the classification is
  -- derived partly from the repository analyzer's route table, which moves, and
  -- a human's decision must not be reinterpreted under a table they never saw.
  add column if not exists review_classification text
    check (review_classification in ('visual', 'code', 'visual_and_code')),
  add column if not exists review_classification_policy_version text
    check (
      review_classification_policy_version is null
      or char_length(btrim(review_classification_policy_version)) > 0
    ),
  -- sha256 over project, change, base, commit, the sorted changed paths and the
  -- diff policy version.
  --
  -- The property that makes this admissible as approval evidence at all: two
  -- immutable commits under fixed rules produce the same diff every time, so
  -- what a person looked at can be reproduced byte for byte. A screenshot
  -- cannot be — which is why review artifacts expire and this does not.
  add column if not exists code_review_digest text
    check (code_review_digest is null or char_length(code_review_digest) = 64);

-- Exactly one evidence form, never both and never neither. Modelled rather than
-- trusted: an approval row carrying neither would be a human's yes to nothing,
-- and one carrying both would leave a merge preflight two answers to the
-- question of what was reviewed.
alter table public.change_approvals
  add constraint change_approvals_has_exactly_one_evidence
    check ((review_artifact_id is not null) <> (code_review_digest is not null));

-- And the evidence form has to be the one the classification called for. A
-- code-diff approval on a change that alters a rendered page is precisely the
-- shortcut this sprint must not create while removing the opposite one.
alter table public.change_approvals
  add constraint change_approvals_evidence_matches_classification
    check (
      code_review_digest is null
      or review_classification = 'code'
    );

-- A newly recorded approval names its classification. Historical rows predate
-- the column and are left as they are: they are records of decisions made under
-- the previous rules, and back-filling a value nobody decided would be
-- inventing history rather than preserving it (CLAUDE.md rule 83).
alter table public.change_approvals
  add constraint change_approvals_code_evidence_states_policy
    check (
      code_review_digest is null
      or review_classification_policy_version is not null
    );

-- Why an approval stopped applying gains a fourth reason.
--
-- When the analyzer's route table moves, a change that needed only a diff can
-- come to need a visual review. The approval genuinely no longer describes what
-- is being asked for — but calling that `review_superseded` would tell the user
-- their comparison was replaced, which is not what happened.
alter table public.change_approvals
  drop constraint if exists change_approvals_invalidation_reason_check;

alter table public.change_approvals
  add constraint change_approvals_invalidation_reason_check
    check (invalidation_reason in (
      'prepared_change_modified', 'validation_superseded', 'review_superseded',
      'review_requirement_changed'
    ));
