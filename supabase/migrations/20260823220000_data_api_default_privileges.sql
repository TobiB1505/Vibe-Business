-- DATA API DEFAULT PRIVILEGES — future tables are opt-in, not auto-exposed.
-- See docs/decisions/0043-data-api-privilege-model.md.
--
-- ## What this changes about the 49 tables that exist today: nothing
--
-- `alter default privileges` applies at `CREATE` time and only at `CREATE`
-- time. It cannot affect an existing table, an in-flight request, or a
-- running deployment. Every table currently in `public` keeps exactly the
-- privileges it has, including the wide platform-default grants this
-- repository has not yet revoked.
--
-- ## What it does change
--
-- A table, sequence or function created by `postgres` in `public` from here
-- on receives no automatic Data API grants. The migration that creates it
-- must grant explicitly — which is the point, and the state the previous
-- migration (`..._data_api_explicit_grants.sql`) put the existing 49 tables
-- into by hand.
--
-- This is what lets `auto_expose_new_tables` be deleted from
-- `supabase/config.toml`, ahead of the 2026-10-30 removal date that field
-- carries. Supabase is moving the platform default to revoke; this makes the
-- repository's behaviour match that future default now, deliberately, rather
-- than discovering it on the day the field disappears.
--
-- ## Why this belongs before the tightening, not with it
--
-- Deploying this stops the bleeding for every table created from now on, at
-- zero risk to running traffic. Revoking the surplus from the existing 49 —
-- above all `anon`'s `insert`/`update`/`delete`/`truncate` — is a separate,
-- genuinely dangerous migration that needs an empirical check that no
-- unauthenticated path reads through PostgREST first. Bundling the two would
-- put a risk-free change behind a risky one for no reason.
--
-- ## The safety net this creates
--
-- From here on, a migration that creates a table and forgets its grants
-- produces a table the Data API cannot see. That fails loudly in CI — the
-- concurrency gate's own `42501` probe (ADR 0040) is exactly this check —
-- rather than silently inheriting a platform default that is going away.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
