-- VB-018 — execution evidence stops being writable from a browser.
--
-- `validation_runs.status`, the SHAs on `prepared_changes` and a
-- `business_readiness_audits` result are all things Vibe *concluded*. An owner
-- could rewrite every one of them through the Data API, because the UPDATE
-- policies asked only whether the project was theirs — which it was. A
-- customer could mark their own validation `passed`, and the approval and merge
-- machinery downstream treats that as a fact Vibe established.
--
-- ## What the previous migration did, and why this goes further
--
-- `20260827185902` (VB-019) pinned the owner column in the WITH CHECK of six
-- tables, uniformly, because that gap was uniform. Tracing the callers
-- afterwards showed two of them need no client UPDATE *at all*, which is
-- strictly stronger than a pin: an effect that must never happen is better as
-- an absent capability than a denied one (rule 76).
--
-- ## Traced, not assumed
--
-- Every mutating store function was followed to its callers:
--
--   * `validation_runs` — claim, stage, phase, source integrity, completion and
--     sandbox usage all have exactly one caller,
--     `operations/change-validation/execution.ts`. Two more
--     (`recordValidatedArtifact`, `markArtifactDeleted`) have no caller at all.
--   * `prepared_changes` — `markPreparedChangePrepared` and
--     `markPreparedChangeFailed`, called only from
--     `operations/change-preparation/` and `operations/agent-execution/`.
--   * `business_readiness_audits` — four of five mutators are durable
--     execution. The fifth is not, and it is the reason this table is treated
--     differently below.
--
-- Everything under `src/modules/operations/` runs on the service-role client,
-- which bypasses RLS by design (rule 53). Nothing here binds it, and nothing
-- here is meant to.

-- 1. Two tables no browser has any business updating ---------------------------
--
-- The grant is withdrawn as well as the policy dropped. Either alone would
-- refuse the write; together the refusal does not depend on a policy someone
-- could later re-add without thinking about this migration.

revoke update on public.validation_runs from anon, authenticated;
drop policy "update own validation_runs" on public.validation_runs;

revoke update on public.prepared_changes from anon, authenticated;
drop policy "update own prepared_changes" on public.prepared_changes;

-- 2. The audit, which has exactly one legitimate client write ------------------
--
-- `submitFounderAnswerAction` runs on the authenticated client and reaches
-- `resumeAuditAfterAnswer`, which writes `status` and `pending_question` and
-- nothing else. That is the founder answering the audit's own question, and it
-- is a real product path — so this table is column-restricted rather than
-- closed.
--
-- PostgreSQL has no way to subtract a column from a table-level UPDATE, so the
-- table-level grant is withdrawn and re-issued for those two columns only.
-- `result`, `overall_score`, `input_hash`, `access_mode` and every other column
-- become unwritable from a browser, which is the finding.

revoke update on public.business_readiness_audits from anon, authenticated;
grant update (status, pending_question) on public.business_readiness_audits to authenticated;

-- The row-level rule is unchanged and still applies on top: the column grant
-- says *which columns*, the policy still says *whose rows*. Recreated rather
-- than left alone only because VB-019 rewrote it one migration ago and the pair
-- should read as one decision.
drop policy "update own business_readiness_audits" on public.business_readiness_audits;
create policy "update own business_readiness_audits" on public.business_readiness_audits
  for update using (
    exists (select 1 from public.projects p
            where p.id = business_readiness_audits.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p
            where p.id = business_readiness_audits.project_id and p.user_id = auth.uid())
  );
