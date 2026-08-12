-- Sprint 9 post-dogfood: allow the v2 SEO foundations capability.
--
-- The first real execution ran under `nextjs_seo_foundations_v1`, whose
-- generator emitted a sitemap listing `/login` and `/signup`. v2 derives the
-- sitemap from structured route intelligence instead. Because the generated
-- artifact changed meaning, the capability identifier was versioned rather than
-- redefined in place (Sprint 9 §7).
--
-- v1 stays permitted. It is not dead configuration: the `prepared_changes` row
-- for commit 2f05958 on `vibe/seo-foundations-cc32273131c5` carries it, and that
-- row must keep describing what was actually written. Retiring v1 would either
-- orphan the row or force us to relabel history as something it was not.
--
-- Discovered by reading the deployed constraint rather than by a failing test:
-- the in-memory test database does not evaluate CHECK constraints, so a v2
-- insert passed every suite and would have failed on the first real click.

alter table public.prepared_changes
  drop constraint if exists prepared_changes_execution_capability_check;

alter table public.prepared_changes
  add constraint prepared_changes_execution_capability_check
  check (execution_capability in ('nextjs_seo_foundations_v1', 'nextjs_seo_foundations_v2'));
