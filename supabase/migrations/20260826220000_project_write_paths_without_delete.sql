-- VB-001 M1a, Migration A — the two project write paths, without `DELETE`.
--
-- Additive. Nothing is revoked here, and no deployed code calls either
-- function, so this migration is inert until Application Deploy A ships.
--
--
-- ## What this is for
--
-- `DELETE ON public.projects` is the entry authority for the cascade that
-- reaches `execution_specs`. M1's lifecycle marker is a forgeable custom GUC,
-- so while any Data API role holds that privilege, holding the marker is
-- enough to destroy a project's execution history outside the lifecycle
-- routine — measured, under RLS, as the owning user. See the [2026-08-26]
-- correction in ADR 0056 §5.
--
-- Closing the privilege means the two application paths that use it need
-- somewhere else to go. Neither of them actually needs a general delete:
--
--   * `projects/connect.ts` deletes only to undo its own half-finished insert
--     pair. That is a transaction, not a deletion.
--   * `projects/disconnect.ts` deletes a project the user owns. That is a
--     deletion, but a narrow one, and it does not need the privilege to be
--     held by every request the browser makes.
--
-- Migration B revokes the privilege once these are in use.


-- ---------------------------------------------------------------------
-- 1. Connect: one transaction instead of a compensating delete
-- ---------------------------------------------------------------------
--
-- The Sprint 1 shape was two sequential inserts with a best-effort
-- `DELETE` if the second failed. `connect.ts` says so itself: it "does not
-- close every failure window (e.g. a crash between the two calls)". A
-- function body is one transaction, so the window closes and the delete
-- stops being needed at all — the failure path is a rollback, and a
-- rollback needs no privilege.
--
-- `security invoker` is deliberate and sufficient. Both inserts are made as
-- the caller, so both RLS insert policies apply exactly as they do today:
-- `projects` checks `user_id = auth.uid()`, and `repository_connections`
-- checks that the caller owns *both* the project and the installation. There
-- is nothing here a service-role client would be needed for, and elevating
-- would mean re-implementing those two policies by hand.
--
-- The owner is `auth.uid()` rather than a parameter. A caller cannot name
-- somebody else because there is no argument in which to name them.
--
-- `projects` carries no unique constraint of any kind, so a `unique_violation`
-- raised in this body can only have come from `repository_connections` —
-- either the repository is already connected somewhere
-- (`repository_connections_github_repository_id_key`) or the project already
-- has a connection, which a project created two statements ago cannot. The
-- classification is therefore unambiguous rather than a guess.
create or replace function public.create_project_with_repository(
  p_project_name text,
  p_installation_row_id uuid,
  p_github_repository_id bigint,
  p_owner text,
  p_repository_name text,
  p_full_name text,
  p_default_branch text,
  p_private boolean,
  p_html_url text
)
returns table (project_id uuid, failure text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  insert into public.projects (user_id, name)
  values (auth.uid(), p_project_name)
  returning id into v_project_id;

  insert into public.repository_connections
    (project_id, github_installation_id, github_repository_id, owner, name, full_name,
     default_branch, private, html_url)
  values
    (v_project_id, p_installation_row_id, p_github_repository_id, p_owner, p_repository_name,
     p_full_name, p_default_branch, p_private, p_html_url);

  return query select v_project_id, null::text;
exception
  -- The block rolls back to its own start, which takes the project insert
  -- with it. That is the whole point: no orphan, and nothing to compensate.
  when unique_violation then
    return query select null::uuid, 'duplicate_repository'::text;
end;
$$;

comment on function public.create_project_with_repository(
  text, uuid, bigint, text, text, text, text, boolean, text
) is
  'VB-001 M1a. Creates a project and its one repository connection in a single '
  'transaction, so a failed connection insert rolls the project back instead of '
  'being compensated by a DELETE. Runs as the caller: both RLS insert policies '
  'apply, and the owner is auth.uid() rather than an argument.';

revoke execute on function public.create_project_with_repository(
  text, uuid, bigint, text, text, text, text, boolean, text
) from public;
revoke execute on function public.create_project_with_repository(
  text, uuid, bigint, text, text, text, text, boolean, text
) from anon;
grant execute on function public.create_project_with_repository(
  text, uuid, bigint, text, text, text, text, boolean, text
) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Disconnect: today's semantics, without today's privilege
-- ---------------------------------------------------------------------
--
--   ┌────────────────────────────────────────────────────────────────┐
--   │ TEMPORARY STAGING FUNCTION.                                    │
--   │                                                                │
--   │ This is not the Disconnect Repository design. ADR 0056 §1 says │
--   │ Disconnect detaches GitHub and *keeps* the project; migration  │
--   │ family M5 implements that — a detachment marker on             │
--   │ `repository_connections` plus partial unique indexes so a      │
--   │ detached repository can be reconnected.                        │
--   │                                                                │
--   │ This function exists for one reason: `authenticated` must stop │
--   │ holding `DELETE ON public.projects` before M1 can ship, and M5 │
--   │ is a product and data-model slice that cannot be rushed to     │
--   │ meet a security deadline. So the destructive behaviour stays   │
--   │ exactly as it is today and only the privilege moves.           │
--   │                                                                │
--   │ M5 deletes this function.                                      │
--   └────────────────────────────────────────────────────────────────┘
--
-- `SECURITY DEFINER` is required rather than stylistic: after Migration B the
-- caller holds no `DELETE` on `public.projects`, so the delete can only run as
-- the owner.
--
-- **Ownership comes from `auth.uid()`, not from an argument, and that is the
-- load-bearing choice.** A `SECURITY DEFINER` function granted to
-- `authenticated` is reachable directly at `/rest/v1/rpc/disconnect_project`
-- with arguments the browser chooses. An earlier revision of this function
-- took a `p_user_id` and deleted on `(id, user_id)` — which reads as an
-- ownership check and is not one: `SECURITY DEFINER` bypasses RLS, so a caller
-- who knew both uuids could pass somebody else's pair and delete their
-- project. Taking the owner from the verified JWT instead removes the
-- argument in which another user could be named, and reduces the function's
-- reach to exactly what the `delete own projects` RLS policy already allowed.
--
-- **It clears the lifecycle marker rather than merely not setting it**, and
-- that is the second thing an earlier revision got wrong. `set_config(…, true)`
-- is transaction-local, and a `SECURITY DEFINER` function runs inside the
-- caller's transaction — so a marker the caller forged before calling is still
-- visible to the cascade this function triggers. Not setting it is not enough;
-- it has to be unset. With it cleared, the cascade reaches the immutability
-- trigger with no marker and is refused, exactly as the direct delete this
-- replaces was. A project that has ever resolved an execution spec is still
-- undeletable through this path, and this function cannot be used to reach the
-- lifecycle authority M1 defines.
--
-- The `restrict_violation` handler is what turns that refusal into a value.
create or replace function public.disconnect_project(
  p_project_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_deleted uuid;
begin
  v_owner := auth.uid();

  if p_project_id is null or v_owner is null then
    return 'not_found';
  end if;

  -- Neutralise any marker the caller set before reaching this function.
  perform set_config('vibe.lifecycle_erasure', '', true);

  delete from public.projects
   where id = p_project_id
     and user_id = v_owner
  returning id into v_deleted;

  if v_deleted is null then
    -- No such project, not this caller's, or already disconnected. One answer
    -- for all three, deliberately: distinguishing them would be an ownership
    -- oracle, and VB-003 already maps this to a single `project_not_found`.
    return 'not_found';
  end if;

  return 'disconnected';
exception
  -- `restrict_violation` is the immutability trigger's own errcode. Catching
  -- it here rolls the delete back and returns a value instead of letting a
  -- message that names the table and trigger travel to a Server Action.
  when restrict_violation then
    return 'blocked_by_execution_history';
end;
$$;

comment on function public.disconnect_project(uuid) is
  'VB-001 M1a, TEMPORARY. Today''s destructive disconnect, moved off the '
  'authenticated DELETE privilege so Migration B can revoke it. Owner comes '
  'from auth.uid(), never an argument, and the lifecycle marker is cleared '
  'before the delete, so a project holding an execution spec is still refused. '
  'Replaced and dropped by M5, which makes Disconnect non-destructive '
  '(ADR 0056 §1).';

revoke execute on function public.disconnect_project(uuid) from public;
revoke execute on function public.disconnect_project(uuid) from anon;
grant execute on function public.disconnect_project(uuid) to authenticated;
