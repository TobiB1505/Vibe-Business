-- Sprint 0114 — a preview no longer waits for a validation.
--
-- A preview used to restore the filesystem snapshot a *passing* validation
-- captured. That made it strictly later than validation, whose last step is the
-- build — so a person waited roughly five minutes to look at code that had been
-- written before the wait began.
--
-- It now clones the prepared commit and runs a development server, which needs
-- no build and can therefore run *alongside* validation. See ADR 0064.

alter table public.preview_sessions
  -- What was actually served. Under v1 this was implied by a snapshot id, which
  -- meant reading it required a join to a validation run that no longer has to
  -- exist.
  add column if not exists prepared_commit_sha text
    check (prepared_commit_sha is null or char_length(prepared_commit_sha) between 7 and 64);

-- Historical rows get the commit their validation run recorded. This is not
-- inventing history: `validation_runs.prepared_commit_sha` is what that session
-- restored, so the column is being filled with the fact it already implied.
update public.preview_sessions s
set prepared_commit_sha = v.prepared_commit_sha
from public.validation_runs v
where s.validation_run_id = v.id
  and s.prepared_commit_sha is null;

-- Any row the backfill could not reach has no validation run to ask, which
-- cannot happen while `validation_run_id` is still `not null` below. Stated as
-- a constraint rather than assumed: a session that cannot say what it served is
-- not a record of anything.
alter table public.preview_sessions
  alter column prepared_commit_sha set not null;

alter table public.preview_sessions
  -- Null whenever a preview is started before validation — the normal case
  -- under `preview-policy-v2`, and the point of the sprint. Still recorded when
  -- it is known.
  alter column validation_run_id drop not null,
  -- Always null under v2, which captures no snapshot.
  alter column artifact_snapshot_id drop not null;

-- The development-server profile.
alter table public.preview_sessions
  drop constraint if exists preview_sessions_preview_profile_check;

alter table public.preview_sessions
  add constraint preview_sessions_preview_profile_check
    check (preview_profile in ('nextjs_preview_v1', 'nextjs_dev_preview_v1'));

-- Stages. The three v1 names stay: no new session reaches one, and the rows
-- that recorded them are not rewritten to match the present (CLAUDE.md rule 83).
alter table public.operation_runs
  drop constraint if exists operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'asking_founder', 'running_ai', 'prioritizing',
    'planning', 'preflight', 'generating_change', 'writing_repository',
    'verifying_repository', 'validating', 'persisting',
    'provisioning', 'acquiring_source', 'verifying_source', 'securing_sandbox',
    'installing', 'typechecking', 'testing', 'building', 'collecting_results',
    'cleaning_up',
    'restoring_artifact', 'verifying_artifact', 'starting_server', 'checking_preview',
    'capturing_before', 'capturing_after', 'persisting_artifacts',
    'authorizing', 'writing_default_ref', 'verifying_default_ref', 'converging',
    'observing', 'evaluating',
    'collecting_baseline', 'collecting_post', 'comparing',
    'reading_code', 'reading_public_product', 'understanding_product',
    'preparing_workspace', 'running_agent', 'extracting_change', 'verifying_change',
    -- Sprint 0114. The one addition; every value above is the list already in
    -- force, restated verbatim because a CHECK cannot be extended in place.
    -- `restoring_artifact`, `verifying_artifact` and `starting_server` stay:
    -- no new session reaches one, and the rows that recorded them are not
    -- rewritten to match the present (CLAUDE.md rule 83).
    'starting_dev_server',
    'completed'
  ));
