-- Sprint UI-2.5 — audit_events.project_id
--
-- Activity became a real screen in UI-2, reading the audit log for the first
-- time since Sprint 1 wrote to it. That read had to filter on
-- `metadata->>'projectId'`, because the table has no project column: it was
-- designed when the only events were account-level GitHub authorization, and
-- callers that belonged to a project put the id in the metadata blob instead.
--
-- That worked and was correctly scoped, but it had two costs. The filter could
-- not use an index, so the read was capped defensively at 50 rows with a hard
-- ceiling of 200. And "which project is this event about" was a convention
-- rather than a constraint — nothing stopped a writer from omitting it or
-- misspelling the key.
--
-- This makes it a column.

-- ---------------------------------------------------------------------
-- Column
--
-- Nullable on purpose, and permanently so. Several event types are genuinely
-- account-level and have no project: `github.authorization.started` happens
-- before any project exists, and `github.identity.verified` and
-- `github.installation.connected` describe the account's connection rather
-- than one project's. A NOT NULL column would force those to invent a project
-- id, which is exactly the fabrication this codebase refuses elsewhere.
--
-- `on delete set null`, NOT cascade. Disconnecting a project deletes its row
-- (see `disconnectProject`), and an audit log that loses its history when the
-- thing it recorded is removed is not an audit log. ADR 0007 makes this
-- append-only; the event survives, and only its association is cleared. It
-- remains readable by its owner under the existing user-scoped policy.
-- ---------------------------------------------------------------------
alter table public.audit_events
  add column if not exists project_id uuid
    references public.projects (id) on delete set null;

comment on column public.audit_events.project_id is
  'The project this event is about, when it is about one. Null for account-level events (GitHub authorization, identity, installation) and for events whose project was later disconnected.';

-- ---------------------------------------------------------------------
-- Backfill
--
-- Only where the metadata carries an id that is both well-formed and points at
-- a project that still exists. Anything else keeps a null `project_id`:
--
--   * account-level events, which never had one
--   * events whose project has since been disconnected — the row was deleted,
--     so a foreign key to it cannot be written, and guessing would be worse
--   * any malformed value
--
-- No id is inferred, derived from a neighbouring row, or reconstructed from
-- ordering. An event either says which project it belongs to or it does not.
-- ---------------------------------------------------------------------
update public.audit_events as events
set project_id = (events.metadata ->> 'projectId')::uuid
where events.project_id is null
  and events.metadata ->> 'projectId' is not null
  -- Reject anything that is not a UUID before casting: a bad value would abort
  -- the whole statement rather than skip one row.
  and events.metadata ->> 'projectId' ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and exists (
    select 1
    from public.projects
    where projects.id = (events.metadata ->> 'projectId')::uuid
  );

-- ---------------------------------------------------------------------
-- Index
--
-- One index, matching the one query that exists: a project's events, newest
-- first, with `id` breaking timestamp ties. Several events are written inside a
-- single statement and share a `created_at` to the microsecond, so without the
-- tiebreaker a paged read can skip or repeat one.
--
-- The column order is the access path exactly — equality on `project_id`, then
-- the sort. `where project_id is not null` keeps the account-level events out
-- of it, since no query ever asks for "events with no project".
-- ---------------------------------------------------------------------
create index if not exists audit_events_project_id_created_at_idx
  on public.audit_events (project_id, created_at desc, id desc)
  where project_id is not null;

-- ---------------------------------------------------------------------
-- Insert policy
--
-- The existing policy is `user_id = auth.uid()`, which already prevents reading
-- another account's events — the read path filters on `user_id` too, so no
-- cross-account leak was ever possible.
--
-- What it did not prevent is *writing* an event tagged with someone else's
-- project id. That could not leak anything (the reader still filters by user),
-- but it would put a row in an append-only log claiming to describe a project
-- its author has no access to, and an append-only log cannot be cleaned up
-- afterwards.
--
-- So the insert policy now also requires that a non-null `project_id` names a
-- project the caller owns. Null stays allowed, for the account-level events.
-- ---------------------------------------------------------------------
drop policy if exists "insert own audit_events" on public.audit_events;

create policy "insert own audit_events" on public.audit_events
  for insert with check (
    user_id = auth.uid()
    and (
      project_id is null
      or exists (
        select 1
        from public.projects
        where projects.id = audit_events.project_id
          and projects.user_id = auth.uid()
      )
    )
  );

-- The select policy is unchanged and stays user-scoped: a project's activity is
-- the caller's own events for that project. Projects are single-owner
-- (`projects.user_id`), so user scope and project scope agree; if membership is
-- ever introduced, this policy is the one place that has to change.

-- No update policy and no delete policy: append-only by omission, as before.
