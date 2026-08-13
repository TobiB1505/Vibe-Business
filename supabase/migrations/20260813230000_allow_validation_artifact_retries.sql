-- A passing validation and a retained artifact prove different things. The
-- first real Temporary Preview dogfood produced a valid pass but snapshot()
-- failed, leaving no artifact. The old index treated that historical pass as
-- permanently active, so an explicit "Validate again" could never recover.

drop index if exists public.validation_runs_single_active_idx;

-- Concurrency protection belongs to work that is actually in flight. Passed
-- rows remain immutable history and are reused by the service only while their
-- captured artifact is present, undeleted and unexpired. Once it is not, a new
-- run of the same validation identity is allowed; two concurrent retries still
-- conflict here before either can provision a second sandbox.
create unique index validation_runs_single_active_idx
  on public.validation_runs (project_id, validation_identity)
  where status in ('queued', 'running');
