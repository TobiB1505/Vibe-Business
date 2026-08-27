-- VB-015 — the surplus Data API privileges are withdrawn.
--
-- `20260823210000` stated Vibe's own grants and said, in its own header, what
-- it deliberately did not do:
--
--   "The tightening — revoking the surplus, above all `anon`'s `insert`,
--    `update`, `delete` and `truncate` on all 49 tables — is deliberately NOT
--    here. It is the only genuinely dangerous step, and it belongs in its own
--    reviewed migration with an empirical reachability check in front of it."
--
-- This is that migration.
--
-- ## Why the surplus is not harmless
--
-- Supabase's platform default granted `arwdDxtm` on every `public` table to
-- `anon` and `authenticated` at create time. RLS covers most of it — but not
-- `TRUNCATE`, which **row-level security does not govern at all**. A role
-- holding `TRUNCATE` empties a table regardless of every policy on it. That is
-- the finding's sharp edge, and no policy anywhere closes it.
--
-- ## The reachability check, run against the deployed database
--
-- Three facts, measured rather than assumed, and together they are why the
-- revoke below cannot take away anything reachable:
--
--   1. **53 public tables, and not one has RLS disabled.** So on every table a
--      privilege without a matching policy is already unusable: RLS
--      default-denies, and the grant is decoration.
--   2. **Every policy is for `authenticated` or `public`.** None is scoped to
--      another role, so deriving the grant set from the policies cannot miss a
--      role's rights.
--   3. **`anon` can satisfy no policy on any table**, which `20260823210000`
--      established and this migration relies on: every policy in this schema
--      resolves `auth.uid()`, and that is NULL for an unauthenticated request.
--      Sign-in runs through GoTrue against the `auth` schema, never through
--      PostgREST on `public`.
--
-- ## The rule: subtract only, never add
--
-- The first draft of this migration derived the grant set from the policies and
-- re-issued it — "authenticated gets exactly the commands a policy exists for".
-- It was wrong, and `lifecycle-authority.migration.ts` caught it: `projects`
-- has a DELETE policy **and deliberately no DELETE grant**, because
-- `20260826221000` withdrew it to reach VB-001's invariant that no Data API
-- role can start a project cascade. Re-deriving handed it straight back.
--
-- A policy and a privilege are two independent decisions, and a policy is not
-- evidence that the privilege is wanted. So this migration never grants
-- anything. It only takes away what is held *and* unbacked, which cannot
-- re-open a door another migration deliberately closed.
--
-- `anon` keeps nothing at all — it can satisfy no policy on any table, per
-- point 3 above. `service_role` and `postgres` are untouched: durable
-- execution is the only writer for the billing tables and the only path a
-- workflow step has (rule 53), and `service_role` bypasses RLS anyway.

do $$
declare
  tbl record;
  privilege text;
begin
  for tbl in select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    -- Never reachable through PostgREST, and TRUNCATE is the one RLS cannot
    -- govern at all. Withdrawn unconditionally from both Data API roles.
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', tbl.tablename);

    -- `anon` satisfies no policy anywhere, so every CRUD privilege it holds is
    -- unusable by construction.
    execute format('revoke select, insert, update, delete on public.%I from anon', tbl.tablename);

    -- For `authenticated`, subtract only what no policy backs. A command with
    -- no policy is already RLS-denied, so removing the grant changes no
    -- behaviour and removes the decoration that made RLS look like the only
    -- line.
    foreach privilege in array array['select', 'insert', 'update', 'delete']
    loop
      if not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = tbl.tablename
          and (p.cmd = 'ALL' or lower(p.cmd) = privilege)
      ) then
        execute format('revoke %s on public.%I from authenticated', privilege, tbl.tablename);
      end if;
    end loop;
  end loop;
end
$$;

-- `set_updated_at` gets its search_path pinned --------------------------------
--
-- Named in the same finding. It is `security invoker`, so this is hardening
-- rather than a hole being closed — but a trigger function that resolves `now`
-- through a caller-controlled `search_path` is a shape worth not having, and
-- the advisor flags it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
