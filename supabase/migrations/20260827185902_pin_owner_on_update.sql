-- VB-019 — the denormalized owner stops being client-mutable.
--
-- Six tables carry a `user_id` alongside a `project_id`, and their UPDATE
-- policies checked only the project. The project check is correct and stays;
-- what was missing is that nothing said the row's own owner column had to
-- survive the update. So an owner could write another identity onto their own
-- row and the policy would pass, because the project was still theirs:
--
--   update validation_runs set user_id = '<someone else>' where project_id = <mine>;
--
-- That column is not decoration. Billing resolves the economic owner through
-- it, the erasure operation finds an account's rows by it, and the metering
-- tables tombstone it precisely so a charge stays attributable. A client that
-- can rewrite it can point its own work at someone else's identity.
--
-- ## Why WITH CHECK and not USING
--
-- USING decides which rows are visible to the statement; WITH CHECK decides
-- what they may become. The gap is entirely in the second, and only the second
-- is touched — narrowing USING would change which rows an owner can act on,
-- which is a different rule and not the defect.
--
-- ## What this cannot refuse
--
-- Nothing here binds durable execution: `src/modules/operations/` uses the
-- service-role client, which bypasses RLS by design (rule 53). This closes the
-- Data API path, which is the one a customer's browser can reach.
--
-- Measured before writing, against the live database: zero rows on any of the
-- six tables have a `user_id` that differs from their project's owner, so no
-- existing row becomes unupdatable. The two `operation_runs` rows with a null
-- owner are erasure tombstones — they belong to nobody, and a row belonging to
-- nobody should not be client-updatable.

-- 1. operation_runs — the one this repository wrote most recently -------------
--
-- ADR 0057 gave this policy a `case` so an account-level operation (null
-- project) is visible to its owner. That branch pins the owner correctly; the
-- project-scoped branch it left alone did not, which is the same omission as
-- the other five and arrived with the newest migration rather than the oldest.

drop policy "update own operation_runs" on public.operation_runs;
create policy "update own operation_runs" on public.operation_runs
  for update using (
    case when operation_runs.project_id is null
         then operation_runs.user_id = auth.uid()
         else exists (
           select 1 from public.projects p
           where p.id = operation_runs.project_id and p.user_id = auth.uid()
         )
    end
  ) with check (
    operation_runs.user_id = auth.uid()
    and case when operation_runs.project_id is null
             then true
             else exists (
               select 1 from public.projects p
               where p.id = operation_runs.project_id and p.user_id = auth.uid()
             )
        end
  );

-- 2. The five project-scoped tables ------------------------------------------
--
-- Each keeps its existing project predicate verbatim and gains the owner pin.

drop policy "update own validation_runs" on public.validation_runs;
create policy "update own validation_runs" on public.validation_runs
  for update using (
    exists (select 1 from public.projects p
            where p.id = validation_runs.project_id and p.user_id = auth.uid())
  ) with check (
    validation_runs.user_id = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = validation_runs.project_id and p.user_id = auth.uid())
  );

drop policy "update own prepared_changes" on public.prepared_changes;
create policy "update own prepared_changes" on public.prepared_changes
  for update using (
    exists (select 1 from public.projects p
            where p.id = prepared_changes.project_id and p.user_id = auth.uid())
  ) with check (
    prepared_changes.user_id = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = prepared_changes.project_id and p.user_id = auth.uid())
  );

drop policy "update own preview_sessions" on public.preview_sessions;
create policy "update own preview_sessions" on public.preview_sessions
  for update using (
    exists (select 1 from public.projects p
            where p.id = preview_sessions.project_id and p.user_id = auth.uid())
  ) with check (
    preview_sessions.user_id = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = preview_sessions.project_id and p.user_id = auth.uid())
  );

drop policy "update own review_artifacts" on public.review_artifacts;
create policy "update own review_artifacts" on public.review_artifacts
  for update using (
    exists (select 1 from public.projects p
            where p.id = review_artifacts.project_id and p.user_id = auth.uid())
  ) with check (
    review_artifacts.user_id = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = review_artifacts.project_id and p.user_id = auth.uid())
  );

-- Named `answer own …` rather than `update own …`, unlike the other five. The
-- name is kept: it is the founder answering an interrupt, and renaming it here
-- would be an unrelated change buried in a security migration. The name was
-- read from the live catalog after an earlier draft guessed it from a
-- superseded migration and the real-PostgreSQL harness refused to apply it.
drop policy "answer own execution_interrupts" on public.execution_interrupts;
create policy "answer own execution_interrupts" on public.execution_interrupts
  for update using (
    exists (select 1 from public.projects p
            where p.id = execution_interrupts.project_id and p.user_id = auth.uid())
  ) with check (
    execution_interrupts.user_id = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = execution_interrupts.project_id and p.user_id = auth.uid())
  );
