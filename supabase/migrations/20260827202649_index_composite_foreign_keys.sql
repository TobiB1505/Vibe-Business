-- VB-027, completing it.
--
-- The migration before this one generated single-column indexes only, leaving
-- the two composite foreign keys the founder-input work added:
-- `action_plan_founder_attestations_plan_project_fk` and
-- `founder_resolutions_request_project_fk`.
--
-- Generated rather than written out, for a concrete reason: the hand-written
-- attempt named the wrong leading column for the first one. Column order is
-- the whole question — an index on `(project_id, id)` does not serve a key
-- declared `(id, project_id)`, so a wrong order produces an index that
-- satisfies the advisor and helps nothing. The catalog knows the order; a
-- person reading a constraint name does not.

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
    where con.contype = 'f'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.oid
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
