-- Sprint 11C — Safe merge of an approved change.
--
-- The first Vibe-authorized write to a repository's DEFAULT branch. Every write
-- before this one went to an isolated `vibe/…` branch nobody was running; this
-- one moves the branch a customer's deployments come from. See ADR 0019.
--
-- A ChangeMerge is a durable record of one *attempt*, not a flag on something
-- else. `prepared_changes.status = 'merged'` alone could not say which commit
-- moved which branch from where to where, under which policy, authorized by
-- which approval — which is precisely what an audit of a default-branch write
-- has to be able to answer.
--
-- Deliberately NOT stored here: installation tokens, provider error text, diff
-- content, file contents, or anything a merge read from GitHub beyond the SHAs
-- it acted on.

-- ---------------------------------------------------------------------
-- Operation type and stages
--
-- Read from the LIVE constraint before this file was written, not inferred from
-- the TypeScript union: the deployed CHECK listed seven operation types and
-- twenty-eight stages, and did not include `change_merge`. That gap is the one
-- that failed every real run at INSERT in Sprint 9 and again in 10B.
-- `schema.test.ts` pins the two representations together from here on.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview', 'preview_teardown', 'change_review',
    -- Moving a default branch to an approved commit (Sprint 11C §18).
    'change_merge'
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
    -- Safe merge (Sprint 11C §18). `authorizing` is its own stage because it is
    -- the moment the merge revalidates human intent against live GitHub state,
    -- and a user watching a default-branch write deserves to see that it
    -- happened rather than a single opaque "working".
    'authorizing', 'writing_default_ref', 'verifying_default_ref', 'converging',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- change_merges
-- ---------------------------------------------------------------------
create table public.change_merges (
  id uuid primary key default gen_random_uuid(),

  -- The human who requested the merge, and the project the authority comes
  -- from. Both resolved from the session server-side; neither is ever accepted
  -- from a client (§14).
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,

  -- The exact approval that authorized this write. `restrict`, not `cascade`: a
  -- merge record that cannot say who authorized it is not an audit record, and
  -- a default-branch write is the last thing that should lose its authorization
  -- trail. There is no delete path for approvals through the product anyway.
  change_approval_id uuid not null references public.change_approvals (id) on delete restrict,
  repository_connection_id uuid not null references public.repository_connections (id) on delete restrict,

  -- Copied onto the row rather than joined at read time, for the same reason
  -- the approval copies them: a re-preparation must not be able to change what
  -- a completed merge says it did.
  prepared_commit_sha text not null check (char_length(prepared_commit_sha) = 40),
  prepared_base_sha text not null check (char_length(prepared_base_sha) = 40),

  -- As GitHub reported it at preflight, never from the stored connection: a
  -- default branch can be renamed, and a stale name would address the wrong ref.
  default_branch text not null check (char_length(btrim(default_branch)) > 0),
  -- Where the branch was immediately before the write was attempted. Without it
  -- a `merged` row cannot distinguish "we fast-forwarded main" from "main was
  -- already there".
  observed_default_head_before text check (observed_default_head_before is null
    or char_length(observed_default_head_before) = 40),

  merge_policy_version text not null check (char_length(btrim(merge_policy_version)) > 0),

  -- One strategy, and it is not user-selectable (§12). A CHECK with a single
  -- value looks redundant and is not: it is what makes adding a second strategy
  -- a deliberate migration rather than a string that appears one day.
  merge_strategy text not null default 'fast_forward_exact_commit'
    check (merge_strategy in ('fast_forward_exact_commit')),

  -- sha256 over project + prepared change + approval + commit + base + policy.
  merge_identity text not null check (char_length(merge_identity) = 64),

  operation_run_id uuid references public.operation_runs (id) on delete set null,

  status text not null default 'preflight'
    check (status in ('preflight', 'merging', 'merged', 'blocked', 'failed')),

  -- The default-branch head read back *independently* after the write (§22).
  resulting_default_head_sha text check (resulting_default_head_sha is null
    or char_length(resulting_default_head_sha) = 40),

  -- Deliberately NOT constrained to an enumerated set, matching
  -- `validation_runs.failure_code` and the convention Sprint 10A paid for: a
  -- CHECK listing failure codes turns adding a refusal reason into a migration,
  -- and a forgotten one fails only at INSERT — which is to say, only in
  -- production, only on the path that was already going badly. The TypeScript
  -- union is the contract for this column; the constraints that carry weight
  -- here are the ones about *outcomes*, below.
  failure_code text,

  preflight_checked_at timestamptz,
  -- Set immediately BEFORE the default-branch write is attempted, never after.
  -- This column is what makes an interrupted merge legible: a row with a
  -- `started_at` and no result is the ambiguous case, and the only safe
  -- response to it is to read the branch (§19).
  started_at timestamptz,
  merged_at timestamptz,
  failed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- **A merge is only `merged` if the branch came back as the approved commit.**
  --
  -- The single most important constraint in this file. Sprint 11C's read-back
  -- verification lives in application code, and application code is exactly
  -- what this project has twice watched be right and still not run. Here the
  -- database refuses to store a successful merge whose observed result is
  -- anything other than the commit a human approved — including null.
  --
  -- A mutation that deletes the read-back, or accepts "the branch changed
  -- somehow", cannot produce a `merged` row (§39).
  constraint change_merges_merged_matches_approved_commit
    check (
      status <> 'merged'
      or (
        merged_at is not null
        and failure_code is null
        and resulting_default_head_sha = prepared_commit_sha
      )
    ),

  -- Blocked means refused *before any write*. Modelled rather than trusted,
  -- because "we stopped" and "we tried and it did not work" are the two
  -- sentences a user reads completely differently (§29).
  constraint change_merges_blocked_wrote_nothing
    check (
      status <> 'blocked'
      or (failure_code is not null and failed_at is not null and started_at is null)
    ),

  constraint change_merges_failed_has_reason
    check (status <> 'failed' or (failure_code is not null and failed_at is not null)),

  -- An attempt in flight has not concluded. Without this, a row could claim to
  -- be mid-write and carry a completion timestamp.
  constraint change_merges_in_flight_is_not_concluded
    check (
      status not in ('preflight', 'merging')
      or (merged_at is null and failed_at is null and failure_code is null)
    ),

  -- A write cannot have been attempted before the preflight that authorizes it.
  constraint change_merges_write_follows_preflight
    check (started_at is null or preflight_checked_at is not null)
);

comment on table public.change_merges is
  'One attempt to move a repository default branch to one approved commit, by fast-forward only. Records what was written and what was read back — never that anything was deployed.';

comment on column public.change_merges.resulting_default_head_sha is
  'The default-branch head read back independently after the write. A merge is only "merged" when this equals the approved commit (Sprint 11C §22).';

comment on column public.change_merges.started_at is
  'Set immediately before the default-branch write. A row with this set and no outcome is the ambiguous case: read the branch, never write again (§19).';

-- **At most one consequential write per exact artifact** (§20, §21).
--
-- The predicate covers `merging` and `merged` and deliberately excludes
-- `preflight`. Double-click protection lives one layer up, on
-- `operation_runs`'s active-identity index, which already refuses a second
-- simultaneous operation for the same input identity and has a failure path
-- that releases it. Including `preflight` here would add a second lock with no
-- release: an operation that failed to enqueue would leave a row that blocks
-- every future attempt at the same merge, forever, with no way to clear it
-- through the product.
--
-- What this index guarantees is the sentence that actually matters: however
-- many requests are made, only one of them can ever be *writing* or *written*.
create unique index change_merges_written_identity_idx
  on public.change_merges (project_id, merge_identity)
  where status in ('merging', 'merged');

create index change_merges_prepared_change_idx
  on public.change_merges (prepared_change_id, created_at desc);

create index change_merges_project_created_idx
  on public.change_merges (project_id, created_at desc);

create index change_merges_operation_idx
  on public.change_merges (operation_run_id);

alter table public.change_merges enable row level security;

create trigger set_updated_at
  before update on public.change_merges
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- The split here is the point (§32).
--
--   INSERT  a human may *request* a merge of something they approved.
--   UPDATE  nobody may, through the product. There is no update policy at all,
--           so every authoritative transition — merging, merged, blocked,
--           failed, the resulting SHA, the failure code — can only be written
--           by the service-role client that durable execution holds.
--   DELETE  nobody, ever. A default-branch write leaves a permanent record.
--
-- So a caller holding nothing but an authenticated anon-key token cannot forge
-- a merged state, cannot invent a resulting SHA, cannot claim an observed
-- GitHub head and cannot attach itself to an operation. Not because a code path
-- declined — because no policy permits the statement.
--
-- The insert policy verifies linkage rather than ownership alone, exactly as
-- the approval's does, and for the same reason: "the application resolves it"
-- is the premise that failed silently twice in Sprint 10B and 11A.
--
-- Every reference to the new row is qualified `change_merges.<column>`.
-- Unqualified would be a guess about scope — `prepared_change_id` exists on
-- `change_approvals` too, so inside that subquery a bare name binds to the
-- inner table and the check silently passes for the wrong row.
-- ---------------------------------------------------------------------
create policy "select own change_merges"
  on public.change_merges
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = change_merges.project_id and p.user_id = auth.uid()
    )
  );

create policy "insert own change_merges"
  on public.change_merges
  for insert with check (
    change_merges.user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = change_merges.project_id and p.user_id = auth.uid()
    )
    -- The commit and base are the prepared change's own, not the client's.
    and exists (
      select 1 from public.prepared_changes pc
      where pc.id = change_merges.prepared_change_id
        and pc.project_id = change_merges.project_id
        and pc.status = 'prepared'
        and pc.commit_sha = change_merges.prepared_commit_sha
        and pc.base_sha = change_merges.prepared_base_sha
    )
    -- An **active** approval, by this user, for exactly this commit and base.
    -- This is the database saying what §3 and §4 say: a merge request that is
    -- not backed by a standing human decision about these exact bytes cannot
    -- exist as a row, whatever the application believes.
    and exists (
      select 1 from public.change_approvals ca
      where ca.id = change_merges.change_approval_id
        and ca.project_id = change_merges.project_id
        and ca.prepared_change_id = change_merges.prepared_change_id
        and ca.prepared_commit_sha = change_merges.prepared_commit_sha
        and ca.prepared_base_sha = change_merges.prepared_base_sha
        and ca.status = 'approved'
    )
    and exists (
      select 1 from public.repository_connections rc
      where rc.id = change_merges.repository_connection_id
        and rc.project_id = change_merges.project_id
    )
    -- A merge may only attach itself to this caller's own merge operation.
    -- Without this a client could point a merge row at somebody else's
    -- operation run, which is one of the identifiers §32 says it must not be
    -- able to choose.
    and exists (
      select 1 from public.operation_runs orn
      where orn.id = change_merges.operation_run_id
        and orn.project_id = change_merges.project_id
        and orn.user_id = auth.uid()
        and orn.operation_type = 'change_merge'
    )
    -- A requested merge has written nothing and concluded nothing. The client
    -- cannot open a row that already claims an outcome.
    and change_merges.status = 'preflight'
    and change_merges.resulting_default_head_sha is null
    and change_merges.failure_code is null
    and change_merges.started_at is null
    and change_merges.merged_at is null
    and change_merges.failed_at is null
  );

-- No update policy and no delete policy, deliberately. See the block above.
