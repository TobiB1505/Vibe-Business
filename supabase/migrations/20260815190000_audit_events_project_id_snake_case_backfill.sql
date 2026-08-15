-- Sprint UI-2.5 — completing the audit_events.project_id backfill.
--
-- The first backfill (20260815180000) matched `metadata->>'projectId'` and
-- moved 237 of 277 events. Querying the remaining 40 afterwards showed the
-- assumption behind that filter was wrong:
--
--   26 are genuinely account-level (`github.authorization.started`,
--      `github.identity.verified`, `github.installation.connected`) and
--      correctly have no project.
--
--    1 is `repository.selected`, written before the project row exists. It has
--      only a `githubRepositoryId`, and there is nothing to resolve it to
--      without guessing. It stays null.
--
--   13 DO carry a project id — spelled `project_id`, not `projectId`.
--
-- The modules written from Sprint 11B onwards (merge, approval, outcome,
-- measurement) use snake_case in their metadata; the earlier ones use camel.
-- Nothing ever enforced either, because nothing read the column back until
-- UI-2.
--
-- The 13 are not incidental: they include `change_merge.default_branch_updated`
-- and `change_merge.verified` — the two events that record Vibe moving a
-- customer's default branch, and the most consequential entries the log holds.
-- An Activity feed that silently omitted them would be worse than one that
-- said nothing.
--
-- This migration is separate rather than an edit to the previous one, because
-- that one is already applied: migrations are the source of truth and the
-- remote converges to them (CLAUDE.md rule 34), so a correction is a new file.

update public.audit_events as events
set project_id = (events.metadata ->> 'project_id')::uuid
where events.project_id is null
  and events.metadata ->> 'project_id' is not null
  -- Same guard as before: reject anything that is not a UUID before casting,
  -- so one bad value cannot abort the statement.
  and events.metadata ->> 'project_id' ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and exists (
    select 1
    from public.projects
    where projects.id = (events.metadata ->> 'project_id')::uuid
  );

-- The write path now reads both spellings (`resolveProjectId` in
-- src/modules/audit-log/events.ts), so new events populate the column whichever
-- convention their module follows. Neither metadata key is removed: other
-- readers may still rely on them.
