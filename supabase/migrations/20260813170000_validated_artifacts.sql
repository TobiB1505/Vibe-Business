-- Sprint 10B: a successful validation may retain a bounded, resumable artifact.
--
-- This does NOT make validation sandboxes persistent. ADR 0015 §5 stands: a
-- sandbox never snapshots itself on stop, because that would retain arbitrary
-- filesystems — including failed runs and runs that stopped mid-scrub — under
-- the provider's 30-day default.
--
-- Capture is the opposite shape: explicit, only after every check passed and
-- the credential scrub was re-verified, with an expiry Vibe chose (60 minutes),
-- deleted when the preview that uses it ends.
--
-- A failed validation never produces one, which is why these columns are
-- nullable rather than defaulted.

alter table public.validation_runs
  add column artifact_snapshot_id text,
  add column artifact_expires_at timestamptz,
  add column artifact_deleted_at timestamptz,
  add column artifact_size_bytes bigint check (artifact_size_bytes is null or artifact_size_bytes >= 0);

comment on column public.validation_runs.artifact_snapshot_id is
  'Provider snapshot of the validated filesystem, captured only after a passing run with a re-verified credential scrub. Null for failed runs and for passes where capture failed.';

comment on column public.validation_runs.artifact_expires_at is
  'Explicit retention deadline. Never the provider default — an unbounded retention of a customer filesystem is not a policy anyone chose.';

comment on column public.validation_runs.artifact_deleted_at is
  'When Vibe explicitly deleted the artifact, normally at preview teardown. Expiry is the backstop, not the plan.';

-- An artifact only ever belongs to a passing run.
alter table public.validation_runs
  add constraint validation_runs_artifact_only_when_passed
  check (artifact_snapshot_id is null or status = 'passed');

-- A retained artifact always has a deadline.
alter table public.validation_runs
  add constraint validation_runs_artifact_has_expiry
  check (artifact_snapshot_id is null or artifact_expires_at is not null);

-- Finding artifacts that outlived their deadline, for cleanup.
create index validation_runs_live_artifact_idx
  on public.validation_runs (artifact_expires_at)
  where artifact_snapshot_id is not null and artifact_deleted_at is null;
