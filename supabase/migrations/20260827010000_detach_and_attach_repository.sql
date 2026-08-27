-- VB-001 M5, part 2 — the two write paths for a repository connection.
--
-- Part 1 gave the row a detachment marker and narrowed both unique constraints
-- to live rows. Nothing wrote the marker. These are the writers.
--
--
-- ## Why `authenticated` loses UPDATE and DELETE here
--
-- `20260823210000` granted `select, insert, update, delete` on this table to
-- `authenticated` as part of restating the platform default. No production code
-- has used the last two since — the only direct write anywhere is a
-- service-role concurrency fixture, and `create_project_with_repository` does
-- the real insert in SQL.
--
-- Leaving `UPDATE` granted would make the detach gate advisory: the row's RLS
-- update policy allows the owner to set any column, so a caller could write
-- `detached_at` straight over PostgREST and skip the check that a merge is in
-- flight. The gate is a safety rail rather than a security boundary — detaching
-- is not destructive — but a rail nobody has to touch is not a rail.
--
-- **`INSERT` is deliberately kept.** `create_project_with_repository` is
-- `security invoker`, so it inserts as the caller; revoking `INSERT` would
-- break project creation. That leaves a direct insert reachable over PostgREST,
-- and it is bounded to the same outcome `attach_repository_to_project` produces:
-- the RLS insert policy requires the caller to own both the project and the
-- installation, and the partial unique indexes from part 1 allow one live
-- connection per project and per repository.
revoke update on table public.repository_connections from public;
revoke update on table public.repository_connections from anon;
revoke update on table public.repository_connections from authenticated;

revoke delete on table public.repository_connections from public;
revoke delete on table public.repository_connections from anon;
revoke delete on table public.repository_connections from authenticated;


-- ---------------------------------------------------------------------
-- Detach: sever the link, keep everything
-- ---------------------------------------------------------------------
--
-- A narrow setter, and deliberately nothing more. The question "may this
-- project be detached right now?" — an operation still running, an agent still
-- writing, a merge in flight, a Credit hold unsettled — is answered in
-- TypeScript by `findBlockingWork`, which project deletion already uses.
--
-- Restating that gate in SQL would give the product two definitions of live
-- work that have to agree, and the one that drifts is the one nobody reads. So
-- the gate stays in one place and this function stays a setter, reachable only
-- by `service_role` — which is to say, only through the service that runs the
-- gate first.
--
-- `SECURITY DEFINER` is required rather than stylistic: `UPDATE` is revoked
-- above, so the write can only run as the owner. Ownership is therefore
-- re-established in the `where` clause and not trusted because a caller passed
-- a `p_user_id`.
create or replace function public.detach_repository(
  p_project_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detached uuid;
begin
  if p_project_id is null or p_user_id is null then
    return 'not_found';
  end if;

  update public.repository_connections c
     set detached_at = now()
   where c.project_id = p_project_id
     and c.detached_at is null
     and exists (
       select 1 from public.projects p
        where p.id = c.project_id
          and p.user_id = p_user_id
     )
  returning c.id into v_detached;

  -- No such project, not this caller's, or nothing live to detach. One answer
  -- for all three: distinguishing them would be an ownership oracle, and the
  -- application maps it to a single "nothing to disconnect".
  if v_detached is null then
    return 'not_found';
  end if;

  return 'detached';
end;
$$;

comment on function public.detach_repository(uuid, uuid) is
  'VB-001 M5 (ADR 0056 §1). Marks a project''s live repository connection '
  'detached, keeping the row so execution specs, merges and snapshots that '
  'reference it with ON DELETE RESTRICT keep resolving. A setter only: whether '
  'detaching is safe right now is decided by findBlockingWork before the call.';

revoke execute on function public.detach_repository(uuid, uuid) from public;
revoke execute on function public.detach_repository(uuid, uuid) from anon;
revoke execute on function public.detach_repository(uuid, uuid) from authenticated;
grant execute on function public.detach_repository(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------
-- Attach: give an existing project a repository again
-- ---------------------------------------------------------------------
--
-- Nothing could do this before. Every connection was created together with its
-- project, so a project that lost one could never get another — which is what
-- made the global unique constraints a dead end rather than an inconvenience.
--
-- `security invoker`, exactly like `create_project_with_repository` and for the
-- same reason: both RLS insert policies then apply unchanged — the caller must
-- own the project, and must own the installation the connection is made
-- through. Elevating would mean re-implementing those two checks by hand.
--
-- A `unique_violation` here can only come from the partial unique indexes: the
-- project already has a live connection, or the repository is live somewhere
-- else. Both are the same answer to a founder — this cannot be connected — and
-- the application distinguishes them no further.
create or replace function public.attach_repository_to_project(
  p_project_id uuid,
  p_installation_row_id uuid,
  p_github_repository_id bigint,
  p_owner text,
  p_repository_name text,
  p_full_name text,
  p_default_branch text,
  p_private boolean,
  p_html_url text
)
returns table (connection_id uuid, failure text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection_id uuid;
begin
  insert into public.repository_connections
    (project_id, github_installation_id, github_repository_id, owner, name, full_name,
     default_branch, private, html_url)
  values
    (p_project_id, p_installation_row_id, p_github_repository_id, p_owner, p_repository_name,
     p_full_name, p_default_branch, p_private, p_html_url)
  returning id into v_connection_id;

  return query select v_connection_id, null::text;
exception
  when unique_violation then
    return query select null::uuid, 'already_connected'::text;
end;
$$;

comment on function public.attach_repository_to_project(
  uuid, uuid, bigint, text, text, text, text, boolean, text
) is
  'VB-001 M5 (ADR 0056 §1). Connects a repository to a project that already '
  'exists, which is what makes a detached project recoverable. Runs as the '
  'caller, so both RLS insert policies apply: the project and the installation '
  'must both be the caller''s.';

revoke execute on function public.attach_repository_to_project(
  uuid, uuid, bigint, text, text, text, text, boolean, text
) from public;
revoke execute on function public.attach_repository_to_project(
  uuid, uuid, bigint, text, text, text, text, boolean, text
) from anon;
grant execute on function public.attach_repository_to_project(
  uuid, uuid, bigint, text, text, text, text, boolean, text
) to authenticated;
