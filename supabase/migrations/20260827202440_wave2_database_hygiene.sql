-- VB-026 — RLS policies stop re-evaluating `auth.uid()` per row.
--
-- A policy that names `auth.uid()` directly is re-evaluated for **every row
-- the statement touches**, because PostgreSQL cannot prove the call is stable
-- across rows. Wrapping it in a scalar subquery makes it an InitPlan: computed
-- once per statement, then compared. Supabase's own performance advisor flags
-- this as `auth_rls_initplan`, and it flagged **114 policies** here — every
-- policy in the schema that consults the caller.
--
-- ## Why it matters more here than the "performance" label suggests
--
-- The obvious cost is page latency. The larger one is deletion. Wave 0 built
-- cascading deletes and SET NULLs across roughly forty tables, so erasing an
-- account walks a large fan-out — and every policy check along the way was
-- paying per row.
--
-- ## Semantics are unchanged, and that is the whole risk
--
-- `(select auth.uid())` returns exactly what `auth.uid()` returns. The rewrite
-- reads each policy's own deparsed definition out of `pg_policies` and puts it
-- back with the calls wrapped, rather than transcribing 114 policies by hand —
-- a transcription is where a `using` silently becomes a `with check`, or a
-- restrictive policy comes back permissive.
--
-- `permissive`, `cmd` and `roles` are carried across explicitly for that
-- reason. The migration tests are the check: they assert what the policies
-- *refuse*, not how they are written, so a rewrite that changed meaning fails
-- them.
--
-- Idempotent: an already-wrapped policy is normalized back to the bare form
-- first, so running this twice cannot produce `(select (select auth.uid()))`.

do $$
declare
  pol record;
  bare_qual text;
  bare_check text;
  new_qual text;
  new_check text;
  clauses text;
begin
  for pol in
    select tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.uid()%')
    order by tablename, policyname
  loop
    -- Normalize first: `( SELECT auth.uid() AS uid)` is how an already-wrapped
    -- call deparses, and wrapping it again would nest a subquery per policy.
    bare_qual := regexp_replace(coalesce(pol.qual, ''), '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g');
    bare_check := regexp_replace(coalesce(pol.with_check, ''), '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g');

    new_qual := replace(bare_qual, 'auth.uid()', '(select auth.uid())');
    new_check := replace(bare_check, 'auth.uid()', '(select auth.uid())');

    clauses := '';
    if pol.qual is not null then clauses := clauses || ' using (' || new_qual || ')'; end if;
    if pol.with_check is not null then clauses := clauses || ' with check (' || new_check || ')'; end if;

    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
    execute format(
      'create policy %I on public.%I as %s for %s to %s%s',
      pol.policyname,
      pol.tablename,
      case when pol.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      lower(pol.cmd),
      array_to_string(pol.roles, ', '),
      clauses
    );
  end loop;
end
$$;

-- VB-027 — every foreign key gets a covering index -----------------------------
--
-- Fifty-five single-column foreign keys had none. PostgreSQL does not index a
-- referencing column automatically, and two things pay for that here:
--
--   * **Deletion fan-out.** Wave 0 made project deletion and account erasure
--     real, and both walk `ON DELETE CASCADE` / `SET NULL` across roughly forty
--     tables. Every unindexed child FK means a sequential scan of that table
--     per parent row removed, under a lock.
--   * **Policy checks.** Several policies resolve ownership by joining through
--     one of these columns, so the scan happens on read as well.
--
-- The statements below are generated from `pg_constraint` against the deployed
-- catalog rather than transcribed from the advisor's list, so the set is the
-- database's own answer rather than a summary of it.
--
-- ## What is deliberately not done
--
-- The same advisor reports 25 `unused_index` findings, and none is acted on.
-- The list includes an index created forty minutes earlier — so what it is
-- really reporting on a pre-launch database is "never scanned yet", not
-- "useless". Dropping indexes on that evidence would remove them for query
-- paths nobody has exercised. It becomes a real signal once there is traffic.

do $$
declare
  fk record;
begin
  for fk in
    select c.relname as tbl,
           con.conname,
           (select array_agg(a.attname order by k.ord)
              from unnest(con.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum) as cols
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where con.contype = 'f' and array_length(con.conkey, 1) = 1
      and not exists (
        -- Covered when an existing index leads with the same column.
        select 1 from pg_index i
        join pg_class ic on ic.oid = i.indrelid
        where ic.oid = c.oid
          and (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] = con.conkey
      )
    order by c.relname, con.conname
  loop
    execute format(
      'create index if not exists %I on public.%I (%s)',
      left(fk.tbl || '_' || array_to_string(fk.cols, '_') || '_idx', 63),
      fk.tbl,
      (select string_agg(quote_ident(col), ', ') from unnest(fk.cols) as col)
    );
  end loop;
end
$$;

-- VB-036 — the provider ledgers stop accepting client writes -------------------
--
-- `ai_usage_events` and `deep_scan_provider_usage` are Vibe's record of what a
-- provider charged *it*. A client could insert into both, which is two
-- problems: a customer could write rows that reconciliation then reads as
-- provider cost, and could squat a `job_id` an agent run was about to use.
--
-- Only durable execution writes these, through the service-role client, so the
-- grant is withdrawn rather than a policy added — an effect that must never
-- happen is better as an absent capability than a denied one (rule 76). The
-- INSERT policies go with it, so nothing is left implying the write is allowed.
--
-- Both tables are left with no policy at all, which is the same shape
-- `billing_stripe_events` already has and is correct for the same reason: RLS
-- is enabled and a table with no policy denies every command to every
-- non-bypassing role. Worth stating because it is not what it looks like —
-- neither table had a SELECT policy to begin with, so no customer read is
-- being removed here. The billing surfaces do not read these tables through
-- the Data API.

revoke insert on public.ai_usage_events from anon, authenticated;
revoke insert on public.deep_scan_provider_usage from anon, authenticated;

drop policy if exists "insert own ai_usage_events" on public.ai_usage_events;
drop policy if exists "insert own deep_scan_provider_usage" on public.deep_scan_provider_usage;
