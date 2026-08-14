-- Sprint 11B — Human approval.
--
-- One human's yes to one exact reviewed commit. It records intent and grants no
-- capability: no merge exists, no deploy exists, and nothing in this migration
-- touches a repository. See ADR 0018.
--
-- Deliberately NOT a boolean on `prepared_changes`. A boolean cannot answer the
-- only question a merge needs answered — *approved what, exactly?* It survives a
-- regenerated commit, a second validation and a fresh comparison, and quietly
-- becomes "approved whatever is on the branch now".

-- ---------------------------------------------------------------------
-- change_approvals
-- ---------------------------------------------------------------------
create table public.change_approvals (
  id uuid primary key default gen_random_uuid(),

  -- The human who approved, and the project the authority comes from. Both are
  -- resolved from the session server-side; neither is ever accepted from a
  -- client (Sprint 11B §9).
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,
  validation_run_id uuid not null references public.validation_runs (id) on delete cascade,
  -- The comparison the human actually looked at. `restrict` rather than
  -- `cascade`: an approval that cannot say what evidence it was based on is not
  -- an audit record, and deleting that evidence out from under it would leave
  -- exactly that. Nothing in the product deletes review artifacts today; if
  -- retention cleanup is built, it must skip approved ones deliberately.
  review_artifact_id uuid not null references public.review_artifacts (id) on delete restrict,

  -- Copied onto the row, not joined at merge time. If a preparation is ever
  -- re-run and rewrites its commit, this must still say which commit the human
  -- saw — a join would quietly answer with the new one (§3).
  prepared_commit_sha text not null check (char_length(prepared_commit_sha) = 40),
  prepared_base_sha text not null check (char_length(prepared_base_sha) = 40),

  approval_policy_version text not null
    check (char_length(btrim(approval_policy_version)) > 0),

  -- Deterministic hash of project + change + commit + base + validation +
  -- review + policy. The uniqueness key, and the reason a human's yes cannot
  -- float to a different artifact (§12, §13).
  approval_identity text not null check (char_length(approval_identity) = 64),

  status text not null default 'approved'
    check (status in ('approved', 'revoked', 'invalidated')),

  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text
    check (invalidation_reason in (
      'prepared_change_modified', 'validation_superseded', 'review_superseded'
    )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A terminal state must say when it happened. Without this a revoked
  -- approval is indistinguishable from a bug that set the status.
  constraint change_approvals_revoked_has_timestamp
    check (status <> 'revoked' or revoked_at is not null),

  -- And an invalidated one must say why. "This no longer applies" with no
  -- reason is exactly the sentence a user cannot act on (§25).
  constraint change_approvals_invalidated_has_reason
    check (
      status <> 'invalidated'
      or (invalidated_at is not null and invalidation_reason is not null)
    ),

  -- An active approval is not a terminated one. Modelled rather than trusted:
  -- a revoked row that still reads `approved` is the one defect in this table
  -- that would silently grant standing authority.
  constraint change_approvals_active_is_not_terminated
    check (status <> 'approved' or (revoked_at is null and invalidated_at is null))
);

comment on table public.change_approvals is
  'One human approval of one exact reviewed commit. Records intent only — it is not merge eligibility, and nothing here touches a repository.';

comment on column public.change_approvals.prepared_commit_sha is
  'The exact commit the human approved, copied onto the row so a later re-preparation cannot change what the approval means.';

comment on column public.change_approvals.approval_identity is
  'sha256 over project, prepared change, commit, base, validation run, review artifact and policy version. Approval never floats to a different artifact.';

-- At most one *active* approval per exact artifact (§12). A double click loses
-- its second insert here rather than producing two rows that both claim to be
-- the standing decision. Revoked and invalidated rows are excluded, so history
-- accumulates and re-approval after a revoke remains possible.
create unique index change_approvals_active_identity_idx
  on public.change_approvals (project_id, approval_identity)
  where status = 'approved';

create index change_approvals_prepared_change_idx
  on public.change_approvals (prepared_change_id, created_at desc);

create index change_approvals_project_created_idx
  on public.change_approvals (project_id, created_at desc);

create index change_approvals_review_artifact_idx
  on public.change_approvals (review_artifact_id);

alter table public.change_approvals enable row level security;

create trigger set_updated_at
  before update on public.change_approvals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- Approval is a **human** action, so it is not service-role-only (§19). It is
-- performed by an authenticated user through their own session, and the
-- database enforces what that user may claim.
--
-- The insert policy below is deliberately more than an ownership check. The
-- application already resolves every field server-side, but "the application
-- resolves it" is exactly the premise that failed twice in the last two
-- sprints — once for a write RLS refused and swallowed, once for a read RLS
-- refused silently. So the linkage a forged approval would have to lie about is
-- checked here as well:
--
--   * the prepared change belongs to this project and is genuinely at this
--     commit and this base;
--   * the validation run belongs to that prepared change and **passed**;
--   * the review artifact belongs to that prepared change and that validation
--     run and is **ready**.
--
-- A caller holding nothing but an authenticated anon-key token therefore cannot
-- invent an approval for a commit that was never prepared, never validated or
-- never reviewed — not because a code path declined to, but because the row
-- cannot exist.
--
-- Every reference to the new row is qualified as `change_approvals.<column>`.
-- Unqualified would be a guess about scope: `prepared_change_id` exists on
-- `validation_runs` and on `review_artifacts` too, so inside those subqueries a
-- bare name binds to the inner table and the check silently passes for the
-- wrong row. Migration 20260814101000 is the same lesson learned the expensive
-- way, in a storage policy that matched nothing and reported nothing.
-- ---------------------------------------------------------------------
create policy "select own change_approvals"
  on public.change_approvals
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = change_approvals.project_id and p.user_id = auth.uid()
    )
  );

create policy "insert own change_approvals"
  on public.change_approvals
  for insert with check (
    -- The approver is the caller, and the caller owns the project (§20).
    change_approvals.user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = change_approvals.project_id and p.user_id = auth.uid()
    )
    -- The commit and base are the prepared change's own, not the client's.
    and exists (
      select 1 from public.prepared_changes pc
      where pc.id = change_approvals.prepared_change_id
        and pc.project_id = change_approvals.project_id
        and pc.status = 'prepared'
        and pc.commit_sha = change_approvals.prepared_commit_sha
        and pc.base_sha = change_approvals.prepared_base_sha
    )
    -- Something proved these bytes build.
    and exists (
      select 1 from public.validation_runs vr
      where vr.id = change_approvals.validation_run_id
        and vr.project_id = change_approvals.project_id
        and vr.prepared_change_id = change_approvals.prepared_change_id
        and vr.status = 'passed'
    )
    -- And a completed comparison exists for exactly that pair (§4).
    and exists (
      select 1 from public.review_artifacts ra
      where ra.id = change_approvals.review_artifact_id
        and ra.project_id = change_approvals.project_id
        and ra.prepared_change_id = change_approvals.prepared_change_id
        and ra.validation_run_id = change_approvals.validation_run_id
        and ra.status = 'ready'
    )
    -- A new approval is created as `approved`, atomically. There is no state to
    -- work through, because nothing asynchronous happens (§2, §28).
    and change_approvals.status = 'approved'
  );

-- Revocation and invalidation are updates, and only the approver may make them
-- (§32). Note what the WITH CHECK omits: it does not allow returning a row to
-- `approved`. Re-approval is a new row with a fresh timestamp and a fresh
-- decision, never a resurrected one (§26).
create policy "update own change_approvals"
  on public.change_approvals
  for update using (
    change_approvals.user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = change_approvals.project_id and p.user_id = auth.uid()
    )
  ) with check (
    change_approvals.user_id = auth.uid()
    and change_approvals.status in ('revoked', 'invalidated')
  );

-- No delete policy, deliberately. Approval history is the record of who
-- authorized what, and it must survive the product's normal flows (§16).
