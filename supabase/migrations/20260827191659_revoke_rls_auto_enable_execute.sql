-- The platform's own auto-RLS function, if this database has one --------------
--
-- Supabase's `rls_auto_enable()` is a `SECURITY DEFINER` event-trigger function
-- with `EXECUTE` granted to `anon` and `authenticated`, and it is the sole
-- subject of two of the four findings `get_advisors` returns. It is exposed at
-- `/rest/v1/rpc/rls_auto_enable`, which is the part that matters: a
-- `SECURITY DEFINER` function reachable by an unauthenticated caller.
--
-- Revoking `EXECUTE` cannot break it. An event trigger fires through the event
-- system on DDL, never through a privilege — which is the same reason
-- `20260818131334` revoked the same shape from `reject_execution_spec_mutation`.
--
-- Guarded by existence because no migration declares this function: it is
-- created by the platform, and a database restored from these files alone will
-- not have it. That absence is itself a known gap, recorded in
-- `docs/ROADMAP.md`; this migration narrows the function where it exists and
-- deliberately does not decide whether Vibe adopts or drops it.

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
