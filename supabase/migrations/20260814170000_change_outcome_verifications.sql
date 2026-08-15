-- Sprint 12A — Production outcome verification.
--
-- The first thing Vibe records about a customer's *product* rather than about
-- its own pipeline. Everything before this row is a statement about work Vibe
-- performed: bytes written, a build that passed, a preview that answered, a
-- human who agreed, a branch that moved. This is a statement about what the
-- public internet could see afterwards.
--
-- That makes the vocabulary load-bearing. `verified` here means *a small, fixed
-- set of public GETs on this project's own origin returned the behaviour the
-- merged capability was built to produce*. It does not mean deployed, released,
-- live, or that anything improved. See ADR 0020.
--
-- Deliberately NOT stored here: response bodies, HTML, XML, robots text,
-- sitemap contents, request or response headers beyond a normalized content
-- type, query strings, cookies, or any URL that was not produced by Vibe's own
-- deterministic contract code (CLAUDE.md rules 36, 37).

-- ---------------------------------------------------------------------
-- Operation type and stages
--
-- Read from the LIVE constraints before this file was written, not inferred
-- from the TypeScript union: the deployed CHECK listed eight operation types
-- and thirty-two stages, and included neither `change_outcome_verification` nor
-- `observing`/`evaluating`. That gap is the one that failed every real run at
-- INSERT in Sprint 9, again in 10B, and again in 11A.
-- `schema.test.ts` pins the two representations together from here on.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview', 'preview_teardown', 'change_review', 'change_merge',
    -- Observing the public product after a merge (Sprint 12A §18).
    'change_outcome_verification'
  ));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'running_ai', 'prioritizing', 'validating', 'persisting',
    'preflight', 'generating_change', 'writing_repository', 'verifying_repository',
    'provisioning', 'acquiring_source', 'verifying_source', 'securing_sandbox',
    'installing', 'typechecking', 'testing', 'building', 'collecting_results', 'cleaning_up',
    'restoring_artifact', 'verifying_artifact', 'starting_server', 'checking_preview',
    'capturing_before', 'capturing_after', 'persisting_artifacts',
    'authorizing', 'writing_default_ref', 'verifying_default_ref', 'converging',
    -- Outcome verification (Sprint 12A §18). `observing` covers the whole
    -- bounded window including its sleeps, because a user watching this should
    -- see "we are still looking" rather than a stage that flickers per attempt.
    'observing', 'evaluating',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- change_outcome_verifications
-- ---------------------------------------------------------------------
create table public.change_outcome_verifications (
  id uuid primary key default gen_random_uuid(),

  -- Both resolved from the session server-side; neither is ever accepted from
  -- a client (§11).
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- `restrict`, not `cascade`: a verification that cannot say which merge it
  -- was about documents nothing, and there is no delete path for merges
  -- through the product anyway.
  change_merge_id uuid not null references public.change_merges (id) on delete restrict,
  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,
  change_approval_id uuid not null references public.change_approvals (id) on delete restrict,

  -- The commit the default branch was moved to and independently read back at.
  -- Copied onto the row for the same reason the merge copies its SHAs: a later
  -- merge must not be able to change what a completed verification says it was
  -- about.
  merged_commit_sha text not null check (char_length(merged_commit_sha) = 40),

  capability text not null check (char_length(btrim(capability)) > 0),
  capability_version text not null check (char_length(btrim(capability_version)) > 0),

  -- Deliberately NOT constrained to an enumerated set, matching
  -- `merge_policy_version` and the convention Sprint 10A paid for: a CHECK
  -- listing versions turns a bump into a migration, and a forgotten one fails
  -- only at INSERT — which is to say, only in production. The TypeScript unions
  -- are the contract for these columns; `schema.test.ts` pins the *profile*
  -- union, which is a closed set of code paths rather than a version string.
  outcome_profile text not null
    check (outcome_profile in ('nextjs_seo_foundations_outcome_v1')),
  outcome_profile_version text not null check (char_length(btrim(outcome_profile_version)) > 0),
  outcome_policy_version text not null check (char_length(btrim(outcome_policy_version)) > 0),
  evidence_schema_version text not null check (char_length(btrim(evidence_schema_version)) > 0),

  -- Resolved server-side from trusted project state and re-validated through
  -- the production-URL policy on the way out. A client cannot name it (§11).
  public_origin text not null check (public_origin like 'https://%'),
  -- The origin actually served after redirects, each hop independently
  -- revalidated by the safe-fetch boundary. Null until something answered.
  effective_origin text,

  -- **The expectation, frozen before observation** (§9).
  --
  -- Not null and not defaulted: a verification whose expectations were decided
  -- after it looked at production is not a verification, it is a description.
  -- Storing it also means a historical row keeps meaning what it meant even
  -- after the capability's generator changes.
  expected_outcome jsonb not null,
  -- Per-check truth from the latest observation. Null until the first attempt.
  check_results jsonb,

  -- sha256 over project + merge + commit + profile + profile version + policy.
  verification_identity text not null check (char_length(verification_identity) = 64),

  operation_run_id uuid references public.operation_runs (id) on delete set null,

  -- Not success/failure. Three of these are different sentences a user reads
  -- completely differently, and collapsing them is the whole failure mode this
  -- table exists to avoid (§7, §21, §22, §23).
  status text not null default 'queued'
    check (status in ('queued', 'observing', 'verified', 'partial', 'not_observed', 'failed')),

  failure_code text,

  -- Bounded by the schedule in `schedule.ts`. Present so a reader can see how
  -- many times the public product was actually contacted.
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 32),

  started_at timestamptz,
  completed_at timestamptz,
  observation_started_at timestamptz,
  observation_completed_at timestamptz,

  -- **The window, written once and never recomputed** (§17, §42).
  --
  -- A replayed workflow that recalculated its own deadline from `now()` would
  -- extend the window on every re-entry, and a fifteen-minute observation would
  -- quietly become an unbounded one. Persisting it is what makes the bound a
  -- property of the record rather than of a process that happens to be running.
  verification_window_started_at timestamptz,
  verification_window_ends_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- **A verified outcome must carry the evidence that produced it.**
  --
  -- The most important constraint in this file. Classification lives in
  -- application code, and application code is exactly what this project has
  -- repeatedly watched be right and still not run. Here the database refuses a
  -- `verified` row with no observations, no results and no completion — so a
  -- mutation that skips the observation entirely cannot store a green outcome
  -- (§45).
  constraint outcome_verified_has_observations
    check (
      status <> 'verified'
      or (
        check_results is not null
        and attempt_count > 0
        and observation_completed_at is not null
        and completed_at is not null
        and failure_code is null
      )
    ),

  -- The two product answers are also evidence-bearing. `partial` and
  -- `not_observed` are statements about what was seen; without a recorded
  -- observation they would be statements about nothing.
  constraint outcome_product_answer_has_observations
    check (
      status not in ('partial', 'not_observed')
      or (check_results is not null and attempt_count > 0 and completed_at is not null)
    ),

  -- `failed` is the one terminal state that is about Vibe rather than about the
  -- product, so it is the only one that may exist without observations — and it
  -- must say why.
  constraint outcome_failed_has_reason
    check (status <> 'failed' or (failure_code is not null and completed_at is not null)),

  -- An observation in flight has not concluded.
  constraint outcome_in_flight_is_not_concluded
    check (
      status not in ('queued', 'observing')
      or (completed_at is null and failure_code is null)
    ),

  -- The window must be a window.
  constraint outcome_window_is_bounded
    check (
      verification_window_ends_at is null
      or (
        verification_window_started_at is not null
        and verification_window_ends_at > verification_window_started_at
      )
    ),

  -- Observation cannot have started before the verification did.
  constraint outcome_observation_follows_start
    check (observation_started_at is null or started_at is not null)
);

comment on table public.change_outcome_verifications is
  'One bounded observation of a public product after one merged change. "verified" means the intended public behaviour was observed — never that anything was deployed, released, or that any business metric moved.';

comment on column public.change_outcome_verifications.expected_outcome is
  'The expectation snapshot, frozen before observation begins (Sprint 12A §9). Historical verification stays historical.';

comment on column public.change_outcome_verifications.verification_window_ends_at is
  'The observation deadline, written once. Never recomputed on replay (Sprint 12A §42).';

comment on column public.change_outcome_verifications.check_results is
  'Bounded derived evidence only: statuses, counts, booleans, a normalized content type. Never a response body (Sprint 12A §8).';

-- **One verification per exact question** (§27).
--
-- Total rather than partial for every state except `failed`, because there is
-- deliberately no re-check in v1: a terminal `not_observed` or `partial` is an
-- answer, and asking the same question repeatedly until it comes back greener
-- is measurement theatre.
--
-- `failed` is excluded for the reason `preflight` is excluded from the merge's
-- write lock: it is the state a Vibe-side problem lands in — the operation could
-- not be enqueued, the origin was unreachable throughout — and a lock with no
-- release would block that verification forever with no way to clear it through
-- the product.
create unique index change_outcome_verifications_identity_idx
  on public.change_outcome_verifications (project_id, verification_identity)
  where status in ('queued', 'observing', 'verified', 'partial', 'not_observed');

create index change_outcome_verifications_merge_idx
  on public.change_outcome_verifications (change_merge_id, created_at desc);

create index change_outcome_verifications_prepared_change_idx
  on public.change_outcome_verifications (prepared_change_id, created_at desc);

create index change_outcome_verifications_operation_idx
  on public.change_outcome_verifications (operation_run_id);

alter table public.change_outcome_verifications enable row level security;

create trigger set_updated_at
  before update on public.change_outcome_verifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- The same split the merge table uses, and for the same reason (§37).
--
--   INSERT  a human may *request* a check of something that was merged.
--   UPDATE  nobody may, through the product. There is no update policy at all,
--           so every authoritative transition — observing, verified, partial,
--           not_observed, failed, the check results, the timestamps, the
--           attempt count — can only be written by the service-role client that
--           durable execution holds.
--   DELETE  nobody, ever.
--
-- So a caller holding nothing but an authenticated anon-key token cannot forge
-- a verified outcome, cannot invent a passed check, cannot claim an observation
-- timestamp and cannot attach itself to somebody else's operation. Not because
-- a code path declined — because no policy permits the statement.
--
-- The insert policy verifies **linkage to a genuinely merged change**, not
-- ownership alone. This is the database saying what §10 says: a verification of
-- something that was never merged cannot exist as a row, whatever the
-- application believes.
--
-- Every reference to the new row is qualified `change_outcome_verifications.…`.
-- Unqualified would be a guess about scope — `prepared_change_id` exists on
-- `change_merges` and `change_approvals` too, so inside a subquery a bare name
-- binds to the inner table and the check silently passes for the wrong row.
-- Migration 20260814101000 is that lesson learned expensively.
-- ---------------------------------------------------------------------
create policy "select own change_outcome_verifications"
  on public.change_outcome_verifications
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = change_outcome_verifications.project_id and p.user_id = auth.uid()
    )
  );

create policy "insert own change_outcome_verifications"
  on public.change_outcome_verifications
  for insert with check (
    change_outcome_verifications.user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = change_outcome_verifications.project_id and p.user_id = auth.uid()
    )
    -- A **merged** merge, whose independently read-back head is exactly the
    -- commit this verification claims to be about. Unmerged, blocked and failed
    -- merges cannot open a verification row at all (§10, §39).
    and exists (
      select 1 from public.change_merges cm
      where cm.id = change_outcome_verifications.change_merge_id
        and cm.project_id = change_outcome_verifications.project_id
        and cm.prepared_change_id = change_outcome_verifications.prepared_change_id
        and cm.change_approval_id = change_outcome_verifications.change_approval_id
        and cm.status = 'merged'
        and cm.prepared_commit_sha = change_outcome_verifications.merged_commit_sha
        and cm.resulting_default_head_sha = change_outcome_verifications.merged_commit_sha
    )
    -- A verification may only attach itself to this caller's own outcome
    -- operation. Without this a client could point a row at somebody else's
    -- operation run.
    and exists (
      select 1 from public.operation_runs orn
      where orn.id = change_outcome_verifications.operation_run_id
        and orn.project_id = change_outcome_verifications.project_id
        and orn.user_id = auth.uid()
        and orn.operation_type = 'change_outcome_verification'
    )
    -- A requested verification has observed nothing and concluded nothing. The
    -- client cannot open a row that already claims an outcome (§37).
    and change_outcome_verifications.status = 'queued'
    and change_outcome_verifications.check_results is null
    and change_outcome_verifications.failure_code is null
    and change_outcome_verifications.attempt_count = 0
    and change_outcome_verifications.effective_origin is null
    and change_outcome_verifications.completed_at is null
    and change_outcome_verifications.observation_started_at is null
    and change_outcome_verifications.observation_completed_at is null
    and change_outcome_verifications.verification_window_ends_at is null
  );

-- No update policy and no delete policy, deliberately. See the block above.
