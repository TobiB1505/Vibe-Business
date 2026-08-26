-- VB-001 M1 — Project Lifecycle Deletion Authority (ADR 0056 §5, §11).
--
-- Project deletion is structurally impossible today. `DELETE FROM projects`
-- cascades into `execution_specs`, and `execution_specs_immutable` is a
-- `before update or delete ... for each row` trigger that raises
-- unconditionally — and a BEFORE DELETE row trigger fires on *cascaded*
-- deletes, not only direct ones. So every project that has ever resolved an
-- execution spec is undeletable, and with it the account that owns it.
--
-- This migration opens exactly one hole in that guard, and nothing else. It
-- adds no caller: `erase_project_lifecycle()` has no application code behind it
-- yet, deliberately, so the database authority can be verified on its own
-- before anything can invoke it.
--
--
-- ## What this migration does NOT do
--
-- It converts **no foreign key**. The launch audit named the intra-project
-- `RESTRICT` edges (`business_readiness_audits.*_snapshot_id`,
-- `product_profiles.*_snapshot_id`, `execution_specs.*`,
-- `change_merges.change_approval_id`, …) as the thing blocking the cascade.
-- They are not: `RESTRICT` and `NO ACTION` differ only in deferrability, and
-- both ask whether referencing rows still exist *when the constraint is
-- checked* — by which point a same-subtree sibling has already been removed by
-- its own cascade. Converting them would be churn against a non-cause and
-- would weaken real out-of-band integrity guards for nothing (ADR 0056 F1).
--
--
-- ## Why the root project row, and not the specs
--
-- The lifecycle function deletes `public.projects` and lets the existing,
-- empirically proven cascade graph do the rest. Deleting `execution_specs`
-- directly was measured and **refused**:
--
--     ERROR: update or delete on table "execution_specs" violates foreign key
--            constraint "agent_execution_runs_execution_spec_id_fkey"
--
-- Two tables reference `execution_specs` with `ON DELETE RESTRICT` —
-- `agent_execution_runs` and `execution_interrupts` — and a *direct* delete of
-- a referenced parent while its children are still present is refused, which
-- is the case F1 does not cover. Deleting the root instead means the ordering
-- is PostgreSQL's problem rather than a sequence some future caller has to
-- remember.
--
--
-- ## Where the authority actually lives
--
-- The lifecycle marker is a custom GUC, and a custom GUC is **forgeable**: any
-- role may `set local vibe.lifecycle_erasure = 'on'`. It is a context marker,
-- never a permission. Two independent facts do the real work, and neither is
-- caller-supplied:
--
--   1. **The parent must already be gone.** Inside the cascade, the `projects`
--      row has been deleted before the spec's trigger fires; in a direct
--      `DELETE FROM execution_specs` it is still there. So the trigger permits
--      a delete only when its project no longer exists. This binds **every**
--      role including `postgres`, the table owner — which a privilege revoke
--      cannot do, because an owner's rights are implicit.
--
--   2. **`DELETE` on `public.projects` is the entry privilege**, and
--      `service_role` loses it here. Referential-integrity cascades run as the
--      referencing table's owner — measured: `current_user` inside the trigger
--      is `postgres` even when the caller is `service_role` — so revoking
--      `DELETE` on `execution_specs` does not bind the cascade path. What
--      bounds it is who may delete the root row. `service_role` bypasses RLS
--      and could otherwise reach any tenant's project with a forged marker;
--      after this migration it cannot delete a project at all and must go
--      through the ownership-verifying function below.
--
-- `authenticated` keeps `DELETE` on `public.projects`, because
-- `projects/connect.ts` uses it as a compensating rollback and
-- `projects/disconnect.ts` is the path VB-001 exists to fix. That leaves one
-- residual, stated plainly rather than papered over: an authenticated caller
-- who forges the marker can delete **their own** project and cascade its specs,
-- bypassing the active-work gate the next slice adds. It is RLS-bounded to
-- rows that caller already owns and already deletes today whenever the project
-- has no spec; it is never cross-tenant. It closes when Disconnect stops
-- deleting projects (ADR 0056 §1, migration family M5).
--
-- `UPDATE` remains refused unconditionally — marker or no marker, role or no
-- role. Nothing below weakens the guarantee the trigger exists to make.


-- ---------------------------------------------------------------------
-- 1. The guard, narrowed
-- ---------------------------------------------------------------------
--
-- `security invoker` is retained from `20260818131334`, which removed the
-- elevation this function never needed. A trigger fires through its table, not
-- through a grant, so the guarantee is identical and there is no
-- `SECURITY DEFINER` surface to re-review.
--
-- The `projects` lookup runs as the invoker and is therefore RLS-visible only.
-- In the cascade that invoker is the table owner, which bypasses RLS and sees
-- the true state. A non-owning `authenticated` caller would see "gone" for a
-- project that exists — and is still refused, twice over: `DELETE` on
-- `execution_specs` is revoked below, and the table has no delete policy at
-- all. The RLS nuance therefore never reaches a role that could act on it.
create or replace function public.reject_execution_spec_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('vibe.lifecycle_erasure', true), '') = 'on'
     and not exists (
       select 1 from public.projects p where p.id = old.project_id
     )
  then
    return old;
  end if;

  raise exception
    'execution_specs rows are immutable. Re-resolve the step and insert a new spec instead.'
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.reject_execution_spec_mutation() is
  'Trigger guard: execution_specs rows are immutable (EXECUTION CORE-3 §10). '
  'UPDATE is always refused. DELETE is refused unless the row''s project is '
  'already gone AND the lifecycle marker is set — the project cascade, which '
  'only erase_project_lifecycle() can reach for service_role (ADR 0056 §5).';


-- ---------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------
--
-- `20260823210000_data_api_explicit_grants.sql` granted `delete` on
-- `execution_specs` to `service_role` as part of restating the platform
-- default. Nothing has ever used it — there is no `execution_specs` delete
-- anywhere in `src/` — and ADR 0056 §5 requires its absence, so it is
-- withdrawn. `anon` and `authenticated` are named too: neither was granted it
-- by that migration, but both may still carry the wider platform default on
-- tables created before it.
revoke delete on table public.execution_specs from public;
revoke delete on table public.execution_specs from anon;
revoke delete on table public.execution_specs from authenticated;
revoke delete on table public.execution_specs from service_role;

-- The entry privilege for the cascade path. No service-role code deletes a
-- project: the only two delete sites are `projects/connect.ts` and
-- `projects/disconnect.ts`, both on the cookie-scoped client. Withdrawing it
-- makes the function below the single way durable execution can delete a
-- project, and makes the forgeable marker insufficient for the one role that
-- bypasses RLS.
revoke delete on table public.projects from service_role;


-- ---------------------------------------------------------------------
-- 3. The lifecycle function
-- ---------------------------------------------------------------------
--
-- `SECURITY DEFINER` is required rather than stylistic: `service_role` no
-- longer holds `DELETE` on `public.projects`, so the only way to perform the
-- deletion is as the owner.
--
-- Ownership is re-established **here**, inside the function body, and not
-- trusted because a caller passed a `p_user_id`. A service-role bug therefore
-- cannot cross tenants: a mismatched pair deletes nothing and reports it.
--
-- The marker is set by the function itself and transaction-locally
-- (`set_config(..., true)`), so it is gone at commit and no caller has to
-- remember to clear it. It is never read from a parameter.
--
-- No dynamic SQL: two literal statements over two tables. There is nothing
-- here a caller can steer.
create or replace function public.erase_project_lifecycle(
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted uuid;
begin
  -- A null pair is not an error; it is simply not a project anyone owns.
  if p_project_id is null or p_user_id is null then
    return false;
  end if;

  perform set_config('vibe.lifecycle_erasure', 'on', true);

  delete from public.projects
   where id = p_project_id
     and user_id = p_user_id
  returning id into v_deleted;

  -- Deterministic, and idempotent by construction: a second call finds no row
  -- and returns false rather than raising. The application maps that to
  -- `project_not_found`, which is also what a cross-tenant call receives —
  -- deliberately, so the result is not an ownership oracle.
  return v_deleted is not null;
end;
$$;

comment on function public.erase_project_lifecycle(uuid, uuid) is
  'VB-001 M1 (ADR 0056 §3, §5). Deletes one owned project and lets the proven '
  'cascade remove its subtree, under a transaction-local lifecycle marker. '
  'Verifies ownership internally. Returns false for not-found, not-owned and '
  'a repeat call. Authorizes nothing beyond the deletion itself.';

revoke execute on function public.erase_project_lifecycle(uuid, uuid) from public;
revoke execute on function public.erase_project_lifecycle(uuid, uuid) from anon;
revoke execute on function public.erase_project_lifecycle(uuid, uuid) from authenticated;
grant execute on function public.erase_project_lifecycle(uuid, uuid) to service_role;
