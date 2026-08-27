-- VB-002 M2′ — the installation reference defers its check to commit (ADR 0056 F3).
--
-- `repository_connections.github_installation_id` references
-- `github_installations` with `on delete restrict`, checked immediately. That
-- guard is worth keeping: it is what stops an installation being removed while
-- a live project still depends on it, and F1 established that intra-project
-- RESTRICT edges are not the cause of the deletion defect and must not be
-- converted away.
--
-- What it cannot survive is a *single-statement* erasure. Deleting `auth.users`
-- fans out to both `github_installations` and `projects` — and through projects
-- to `repository_connections`. Both branches are correct, and the order
-- PostgreSQL takes them in is not a guarantee. Measured on a cluster carrying
-- every migration: `delete from auth.users` for an identity that still owns a
-- project is refused by this very constraint, before the `execution_specs`
-- immutability trigger the erasure order implies is the blocker.
--
-- `no action deferrable initially deferred` keeps the guard and moves the
-- question to the only moment it can be answered honestly: commit. Mid-
-- transaction the row may legitimately be in flight; at commit it must not
-- reference an installation that is gone. `restrict` cannot express that,
-- because `restrict` is precisely the variant that refuses to be deferred —
-- which is the only difference between the two actions.
--
-- This does not weaken the out-of-band guard. A stray `delete from
-- github_installations` in a session that still has live connections still
-- fails; it now fails at commit rather than at the statement, and reports the
-- same violated constraint.

alter table public.repository_connections
  drop constraint repository_connections_github_installation_id_fkey,
  add constraint repository_connections_github_installation_id_fkey
    foreign key (github_installation_id) references public.github_installations (id)
    on delete no action deferrable initially deferred;
