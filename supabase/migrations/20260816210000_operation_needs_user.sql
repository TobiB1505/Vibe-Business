-- CORE-2a.4 — a durable operation can wait for its user.
--
-- The audit already has `needs_user`. The operation carrying it needs the same
-- state, and the alternative was worse: with only `completed` available, a run
-- that paused before doing its actual work would have to report success, and
-- the screen would say an audit finished when none had.
--
-- `queued → running → needs_user → queued → running → completed` is the real
-- lifecycle. The workflow function returns at the pause — nothing may hold a
-- provider request or a durable step open across a human's coffee break — and
-- answering re-enters the same operation from the top. Every step is already
-- written to be replay-safe, so re-entry reuses the claimed audit row and
-- repeats only deterministic work.

alter table public.operation_runs
  drop constraint operation_runs_status_check;

alter table public.operation_runs
  add constraint operation_runs_status_check
  check (status in ('queued', 'running', 'needs_user', 'completed', 'failed', 'cancelled'));

comment on column public.operation_runs.status is
  'Lifecycle of a durable operation. ''needs_user'' means the run stopped and is waiting for an answer only the user can give; it holds its claims, has spent nothing, and re-enters at ''queued'' when answered (CORE-2a.4).';

-- Progress, not status: what the run had got to when it stopped.
--
-- Its own stage rather than reusing `preparing`, because "Vibe is getting
-- ready" and "Vibe is waiting for you" are different things to show someone,
-- and a stage list that cannot tell them apart forces the UI to guess from
-- status alone.
alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing',
    'counting_tokens',
    'asking_founder',
    'running_ai',
    'prioritizing',
    'validating',
    'persisting',
    'preflight',
    'generating_change',
    'writing_repository',
    'verifying_repository',
    'provisioning',
    'acquiring_source',
    'verifying_source',
    'securing_sandbox',
    'installing',
    'typechecking',
    'testing',
    'building',
    'collecting_results',
    'cleaning_up',
    'restoring_artifact',
    'verifying_artifact',
    'starting_server',
    'checking_preview',
    'capturing_before',
    'capturing_after',
    'persisting_artifacts',
    'authorizing',
    'writing_default_ref',
    'verifying_default_ref',
    'converging',
    'observing',
    'evaluating',
    'collecting_baseline',
    'collecting_post',
    'comparing',
    'reading_code',
    'reading_public_product',
    'understanding_product',
    'completed'
  ));
