-- Sprint 0114 — the preview becomes the review, and an approval says so.
--
-- Sprint 0113 gave an approval two evidence forms: a `review_artifacts` row
-- (two stored screenshots) for a change that alters a rendered page, and a
-- `code_review_digest` for one that does not.
--
-- The screenshot comparison is now the weaker instrument. It photographs one
-- route at one viewport; the preview it photographs is the whole running
-- application, openable and clickable. Vibe was paying a browser session to
-- turn something rich into something poorer, and *that* was blocking approval.
--
-- So a visual approval names the preview instead. See ADR 0065.

alter table public.change_approvals
  -- The interactive preview of this exact commit that the person was shown.
  --
  -- `restrict`, like `review_artifact_id`, and for the same reason: an approval
  -- that cannot say what evidence it rested on is not an audit record.
  --
  -- The sandbox is gone within fifteen minutes; the row is not. It records that
  -- an interactive preview of this commit ran and became reachable at `ready_at`,
  -- under a stated `preview_policy_version`. That is a weaker claim than "you
  -- can look again", and the product says so — but it is a durable, immutable
  -- row, which is what an approval is allowed to bind to (CLAUDE.md rule 67).
  add column if not exists preview_session_id uuid
    references public.preview_sessions (id) on delete restrict;

-- The diff is now part of *every* new approval, visual or not. A preview shows
-- what a change looks like; only the diff shows what it does.
alter table public.change_approvals
  add constraint change_approvals_preview_accompanies_a_diff
    check (preview_session_id is null or code_review_digest is not null);

-- Which evidence the classification calls for, restated for three forms.
--
-- Sprint 0113 wrote this as "a digest implies the change was classified code",
-- which was exact while the digest was the *whole* of a code-only approval and
-- appeared nowhere else. It appears in every new approval now, so that
-- predicate would refuse the visual form outright.
--
-- The rule it was expressing survives unchanged, and is what is written here
-- instead: **the diff alone is enough only for a change that alters no rendered
-- page.** Anything else must also name what was looked at.
--
-- Together with `change_approvals_has_exactly_one_evidence` — untouched, and
-- still satisfied by the new form, which carries a digest and no artifact —
-- these two admit exactly three shapes and no fourth:
--
--   review_artifact_id                          the historical comparison
--   code_review_digest                          a code-only change
--   code_review_digest + preview_session_id     a change somebody looked at
alter table public.change_approvals
  drop constraint if exists change_approvals_evidence_matches_classification;

alter table public.change_approvals
  add constraint change_approvals_evidence_matches_classification
    check (
      code_review_digest is null
      or preview_session_id is not null
      or review_classification = 'code'
    );

-- ---------------------------------------------------------------------
-- The insert policy learns the third form — and stops refusing the second.
-- ---------------------------------------------------------------------
--
-- The policy written in Sprint 11B required a `ready` review artifact
-- unconditionally:
--
--     and exists (select 1 from review_artifacts ra
--                 where ra.id = change_approvals.review_artifact_id and …)
--
-- That was correct while every approval named one. It is **not** vacuously true
-- for a null: `ra.id = null` matches no row, so `exists` is false and the insert
-- is refused. Sprint 0113 introduced the code-diff form without touching this
-- policy, so a code-only approval passed every domain test, passed the SQL
-- constraint tests — which insert as the table owner, bypassing RLS — and would
-- have been refused in a customer's own session. It is repaired here rather than
-- left for the sprint that discovers it, because a nullable evidence column and
-- an unguarded `exists` is a defect either way.
--
-- Each evidence clause is therefore guarded by its own column being present.
-- The form is decided by the CHECK constraints above; these clauses only verify
-- whatever form was chosen.
--
-- `(select auth.uid())` rather than the bare call: the caller is resolved once
-- per statement, not once per row (VB-026, `owner-pin.migration.ts`).
drop policy if exists "insert own change_approvals" on public.change_approvals;

create policy "insert own change_approvals"
  on public.change_approvals
  for insert with check (
    -- The approver is the caller, and the caller owns the project (§20).
    change_approvals.user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = change_approvals.project_id and p.user_id = (select auth.uid())
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
    -- A completed comparison, for an approval that names one (Sprint 11B §4).
    and (
      change_approvals.review_artifact_id is null
      or exists (
        select 1 from public.review_artifacts ra
        where ra.id = change_approvals.review_artifact_id
          and ra.project_id = change_approvals.project_id
          and ra.prepared_change_id = change_approvals.prepared_change_id
          and ra.validation_run_id = change_approvals.validation_run_id
          and ra.status = 'ready'
      )
    )
    -- A preview that actually became reachable, of exactly this commit, for an
    -- approval that names one (Sprint 0114). `ready_at` rather than a status:
    -- the session is expected to be over by now, and what is being asserted is
    -- that it once answered.
    and (
      change_approvals.preview_session_id is null
      or exists (
        select 1 from public.preview_sessions ps
        where ps.id = change_approvals.preview_session_id
          and ps.project_id = change_approvals.project_id
          and ps.prepared_change_id = change_approvals.prepared_change_id
          and ps.prepared_commit_sha = change_approvals.prepared_commit_sha
          and ps.ready_at is not null
      )
    )
    -- A new approval is created as `approved`, atomically. There is no state to
    -- work through, because nothing asynchronous happens (§2, §28).
    and change_approvals.status = 'approved'
  );

create index if not exists change_approvals_preview_session_idx
  on public.change_approvals (preview_session_id)
  where preview_session_id is not null;
