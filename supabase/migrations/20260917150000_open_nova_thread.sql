-- Opening a thread, once, however many callers ask at the same moment.
--
-- ## The race
--
-- `ensureOpenThread` is *find or create*: read the project's open thread, and
-- insert one if there is none. Two round trips from the application, and the
-- window between them is the whole defect. Two founders' tabs asking their
-- first question at once — or a run finishing while a founder asks — both read
-- *none* and both insert, and the conversation is then **split across two
-- threads**: one turn in each, each looking complete, and `findOpenThread`
-- answering with whichever was created second.
--
-- No client-side fix reaches it. PostgREST runs each request in its own
-- transaction, so the application cannot hold anything across the read and the
-- write. The decision has to be made where the rows are.
--
-- ## Why an advisory lock and not a unique index
--
-- A partial unique index on `(project_id) where status = 'open'` would close
-- the race and forbid **New chat**, which exists to open a second open thread.
-- `nova_threads`' own header says so: a schema that has to be changed to allow
-- a planned feature is a schema that decided something it was not asked to.
--
-- What is actually wanted is *serialise the callers who are deciding whether to
-- create one*, which is exactly what a transaction-scoped advisory lock keyed
-- on the project does. Two callers about one project queue; two callers about
-- different projects never meet. The lock is released at commit, so it lives
-- for one PostgREST request and cannot leak.
--
-- ## Why `security invoker`
--
-- Because it needs no more authority than its caller already has, and a
-- `security definer` function that did would be a new definer surface for a
-- problem that is about *ordering* rather than about permission.
--
-- Both callers keep exactly the reach they had: an `authenticated` founder
-- inserts through the same RLS policy and the same three-column grant, so a
-- project that is not theirs is refused by the policy as it was before, and
-- `service_role` — the operations tail, which takes its project id from a
-- persisted row (rule 53) — bypasses RLS as it did before.
--
-- ## The one parameter
--
-- `p_only_if_empty` is the difference between the two callers, and it is the
-- whole difference. *Where does this belong* (a run finishing, a question with
-- nothing in progress) reuses any open thread. **New chat** reuses one only if
-- nothing has been said in it, because a second press means the same thing as
-- the first and two identical empty rows is not an answer to it.

create or replace function public.open_nova_thread(
  p_project_id uuid,
  p_title text,
  p_only_if_empty boolean default false
)
returns setof public.nova_threads
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.nova_threads;
begin
  -- Serialised per project, for the length of this statement's transaction.
  -- `hashtextextended` rather than `hashtext` so the key is the full 64 bits a
  -- single-argument advisory lock takes; a uuid deserves more than 32.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );

  -- The same rule `findOpenThread` applies, asked once the lock is held: the
  -- most recently created open thread is the one the conversation is in.
  select t.* into v_existing
  from public.nova_threads t
  where t.project_id = p_project_id and t.status = 'open'
  order by t.created_at desc, t.id desc
  limit 1;

  if found and not (p_only_if_empty and exists (
    select 1 from public.nova_messages m where m.thread_id = v_existing.id
  )) then
    return next v_existing;
    return;
  end if;

  -- `user_id` is `auth.uid()` for a founder and the project's owner for the
  -- service role, which has no session. Taken from the project row rather than
  -- from an argument either way: the authority is the persisted relationship
  -- (rule 53), and a caller who is not the owner is refused by the insert
  -- policy rather than by this expression.
  return query
  insert into public.nova_threads (project_id, user_id, title)
  select p_project_id,
         coalesce((select auth.uid()), p.user_id),
         pg_catalog.left(pg_catalog.btrim(p_title), 120)
  from public.projects p
  where p.id = p_project_id
  returning *;
end;
$$;

comment on function public.open_nova_thread is
  'Find-or-create the thread a project''s conversation is in, serialised per project by a transaction-scoped advisory lock. Security invoker: an authenticated founder still inserts through the RLS policy and the three-column grant, and service_role still bypasses RLS. p_only_if_empty is New chat, which reuses an open thread only when nothing has been said in it.';

revoke all on function public.open_nova_thread(uuid, text, boolean) from public, anon;

grant execute on function public.open_nova_thread(uuid, text, boolean) to authenticated, service_role;
