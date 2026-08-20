-- ---------------------------------------------------------------------
-- Risk-adaptive validation depth (Sprint 0047)
-- ---------------------------------------------------------------------
-- Every successful validation so far ran the same four steps — install,
-- typecheck, test, build — whether it was checking an SEO metadata edit or a
-- change to the billing ledger. `resolveValidationProfile` reads the
-- repository's *shape* (framework, package manager, workspace layout) and has
-- never had any opinion about the change itself.
--
-- Depth is a second, orthogonal axis:
--
--   validation_profile   which commands does this repository understand?
--   validation_depth     how many of them does this change deserve?
--
-- A depth only ever selects a SUBSET of the profile's own steps. It cannot
-- introduce a command the profile does not already define, and it changes
-- nothing about what validation proves: the exact prepared SHA, the fresh
-- sandbox, changed-file verification and build-identity verification all run
-- identically at every depth, in `verifySource`, before any depth-selected
-- step is reached.
--
-- `validation_depth` is also part of `validation_identity` (see
-- validation/identity.ts), so a stored `fast` pass can never be reused to
-- answer a later request for a `deep` one. That is why no backfill is
-- attempted here: historical rows ran under a policy that had no depth, and
-- labelling them retroactively would assert they answered a question nobody
-- asked them. They keep NULL, and the UI reads NULL as "validated before depth
-- existed" — which is exactly what happened.

alter table public.validation_runs
  add column validation_depth text
    check (validation_depth is null or validation_depth in ('fast', 'standard', 'deep')),
  add column validation_depth_policy_version text
    check (
      validation_depth_policy_version is null
      or char_length(btrim(validation_depth_policy_version)) > 0
    ),
  add column validation_depth_reason text
    check (validation_depth_reason is null or char_length(btrim(validation_depth_reason)) > 0);

-- A depth and the policy that chose it are meaningful only together: a depth
-- with no policy version cannot be re-interpreted later, and a policy version
-- with no depth describes nothing.
alter table public.validation_runs
  add constraint validation_runs_depth_policy_check
    check (
      (validation_depth is null and validation_depth_policy_version is null)
      or (validation_depth is not null and validation_depth_policy_version is not null)
    );

comment on column public.validation_runs.validation_depth is
  'How much of the profile ran: fast | standard | deep. Selects a subset of the profile''s own steps and never adds one. Null for runs validated before Sprint 0047, which always ran the full set.';

comment on column public.validation_runs.validation_depth_policy_version is
  'The depth-policy version that chose validation_depth. Part of validation_identity, so a fast pass is never reused to answer a deep question.';

comment on column public.validation_runs.validation_depth_reason is
  'Closed-vocabulary reason the depth was chosen, e.g. sensitive_domain_changed. Server-derived from riskClass, changeKind, evidence ids and the paths Vibe verified as changed — never from a commit message or agent output.';

create index if not exists validation_runs_depth_idx
  on public.validation_runs (validation_depth, created_at desc);
