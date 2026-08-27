-- VB-001 M5, part 1 — a repository connection can be detached (ADR 0056 §1).
--
-- Additive and behaviour-neutral on its own: nothing writes `detached_at` yet,
-- so every existing row stays live and every existing query keeps its result.
-- The detach service, the Delete Project control and the reconnect path are
-- part 2.
--
--
-- ## Why the row survives a disconnect
--
-- ADR 0056 §1 decided Disconnect severs the GitHub link and *keeps* the
-- project. That is not only a product choice — the row could not be removed
-- even if we wanted to. Three tables reference `repository_connections` with
-- `ON DELETE RESTRICT`:
--
--   repository_intelligence_snapshots.repository_connection_id
--   change_merges.repository_connection_id
--   execution_specs.repository_connection_id
--
-- Those are the edges F1 measured as *not* blocking the projects cascade, and
-- they do not — a cascade removes the children first. But Disconnect deletes
-- the parent **directly**, with its children still present, which is the other
-- case entirely and is refused. Deleting the connection would mean destroying
-- the evidence that points at it, which is exactly what Disconnect promises not
-- to do.
--
-- So the row stays and gains a detachment marker. A timestamp rather than a
-- boolean: when a founder stopped Vibe reading their repository is a fact worth
-- keeping, and `is null` is the same test either way.
alter table public.repository_connections
  add column detached_at timestamptz;

comment on column public.repository_connections.detached_at is
  'When Vibe''s link to this repository was severed (ADR 0056 §1). Null means '
  'live. A detached row is retained history: execution specs, merges and '
  'snapshots reference it with ON DELETE RESTRICT and must keep resolving.';


-- ---------------------------------------------------------------------
-- Uniqueness narrows to live connections
-- ---------------------------------------------------------------------
--
-- Both constraints are global today, and both would turn a detached row into a
-- dead end:
--
--   * `..._github_repository_id_key` is global across every account, so a
--     detached repository could never be connected again — by its owner or by
--     anybody else.
--   * `..._project_id_key` allows one connection row per project, so a project
--     could never hold a live connection alongside its detached history.
--
-- Narrowing both to `where detached_at is null` keeps exactly the guarantees
-- they were written for — one live connection per project, and per repository —
-- while letting detached rows accumulate as unconstrained history.
--
-- Neither constraint backs a foreign key: all three references above point at
-- `id`. Dropping them therefore takes nothing else with it.
--
-- A partial unique index still raises `unique_violation` (23505), so
-- `create_project_with_repository`'s duplicate-repository classification is
-- unaffected.
alter table public.repository_connections
  drop constraint repository_connections_project_id_key;

alter table public.repository_connections
  drop constraint repository_connections_github_repository_id_key;

create unique index repository_connections_live_project_key
  on public.repository_connections (project_id)
  where detached_at is null;

create unique index repository_connections_live_repository_key
  on public.repository_connections (github_repository_id)
  where detached_at is null;
