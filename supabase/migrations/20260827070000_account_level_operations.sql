-- ADR 0057 — the durable-operation model gains an account level.
--
-- ADR 0056 §4 specified account erasure as one durable operation in eleven
-- ordered steps. Building it measured five reasons that operation could not be
-- expressed, none of them visible in the migration text (ADR 0057, G1–G5):
--
--   G1  every RLS policy on this table routes through `project_id`, which is
--       NOT NULL, so an account-level row is invisible to its own owner;
--   G2  `user_id` cascades from `auth.users`, so step 11 deletes the record of
--       the operation performing it — and an absent row cannot distinguish a
--       successful erasure from any other deletion;
--   G3  `operation_runs_single_active_idx` keys on `project_id`, so under the
--       default NULLS DISTINCT it admits unlimited concurrent account-level
--       duplicates and `already_active` never fires;
--   G4  the type vocabulary is closed, and `completed` demands a `result_id`
--       that an erasure has no artifact to point at;
--   G5  there is exactly one insertion funnel — today.
--
-- Nothing here is specific to erasure except one string. Account-scoped
-- operations are now expressible in general; erasure is the first one.

-- 1. An account-level operation has no project ------------------------------
--
-- Null means *this operation is about the account*. It is never "unknown" and
-- never a default: every project-scoped type still supplies one.

alter table public.operation_runs
  alter column project_id drop not null;

comment on column public.operation_runs.project_id is
  'The project this operation acts on, or null when it acts on the account (ADR 0057 §1).';

-- 2. The operation outlives its owner ---------------------------------------
--
-- G2. After erasure step 11 the row survives with both owner columns null: a
-- completed operation belonging to nobody. That is the same shape ADR 0056 §6
-- gives the credit account and §8 gives audit_events, adopted for the same
-- reason — the alternative is an operation that cannot report its own outcome.

alter table public.operation_runs
  alter column user_id drop not null;

alter table public.operation_runs
  drop constraint operation_runs_user_id_fkey,
  add constraint operation_runs_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

comment on column public.operation_runs.user_id is
  'The account this operation belongs to. Null once that identity is erased (ADR 0057 §2).';

-- 3. Visibility, branched rather than rewritten ------------------------------
--
-- The `else` branch of each policy is the existing rule verbatim. A `case`
-- rather than an `or` is the whole point: a disjunction would also grant
-- visibility of any project-scoped row whose `user_id` happens to match, which
-- is a different rule for existing data. Under the branch below no existing row
-- changes visibility, and the new rule applies only where the old one had
-- nothing to say.

drop policy "select own operation_runs" on public.operation_runs;
create policy "select own operation_runs" on public.operation_runs
  for select using (
    case when operation_runs.project_id is null
         then operation_runs.user_id = auth.uid()
         else exists (
           select 1 from public.projects p
           where p.id = operation_runs.project_id and p.user_id = auth.uid()
         )
    end
  );

drop policy "insert own operation_runs" on public.operation_runs;
create policy "insert own operation_runs" on public.operation_runs
  for insert with check (
    user_id = auth.uid()
    and case when project_id is null
             then true
             else exists (
               select 1 from public.projects p
               where p.id = project_id and p.user_id = auth.uid()
             )
        end
  );

drop policy "update own operation_runs" on public.operation_runs;
create policy "update own operation_runs" on public.operation_runs
  for update using (
    case when operation_runs.project_id is null
         then operation_runs.user_id = auth.uid()
         else exists (
           select 1 from public.projects p
           where p.id = operation_runs.project_id and p.user_id = auth.uid()
         )
    end
  ) with check (
    case when operation_runs.project_id is null
         then operation_runs.user_id = auth.uid()
         else exists (
           select 1 from public.projects p
           where p.id = operation_runs.project_id and p.user_id = auth.uid()
         )
    end
  );

drop policy "delete own operation_runs" on public.operation_runs;
create policy "delete own operation_runs" on public.operation_runs
  for delete using (
    case when operation_runs.project_id is null
         then operation_runs.user_id = auth.uid()
         else exists (
           select 1 from public.projects p
           where p.id = operation_runs.project_id and p.user_id = auth.uid()
         )
    end
  );

-- 4. Double submission, blocked by the same mechanism as everything else -----
--
-- G3. Expressed as an index rather than a lookup so `createOperationRun`'s
-- existing `already_active` unique-violation path covers account-level
-- operations with no change to its code — and so the loser of a race learns it
-- from PostgreSQL rather than from a read that can be raced.

create unique index operation_runs_single_active_account_idx
  on public.operation_runs (user_id, operation_type, input_identity)
  where project_id is null and status in ('queued', 'running');

-- 5. The vocabulary, and the one completion exemption ------------------------
--
-- An erasure's product is absence. `result_id` points at what an operation
-- made; there is nothing for this one to point at, and inventing a row so a
-- constraint is satisfied would be a lie told to a CHECK. The exemption names
-- the single type rather than relaxing the rule for the other fourteen.

alter table public.operation_runs
  drop constraint operation_runs_operation_type_check,
  add constraint operation_runs_operation_type_check check (
    operation_type = any (array[
      'business_audit', 'opportunity_generation', 'change_preparation',
      'change_validation', 'change_preview', 'preview_teardown', 'change_review',
      'change_merge', 'change_outcome_verification', 'business_measurement',
      'product_understanding', 'product_scan', 'action_planning', 'agent_execution',
      'account_erasure'
    ])
  );

alter table public.operation_runs
  drop constraint operation_runs_completed_has_result,
  add constraint operation_runs_completed_has_result check (
    status <> 'completed'
    or result_id is not null
    or operation_type = 'account_erasure'
  );

-- 6. Every start path is closed, by construction -----------------------------
--
-- ADR 0056 §4 step 1. G5 says one funnel exists today, so a check inside
-- `createOperationRun` would be true today. This is a trigger anyway, for
-- rule 76's reason: an effect that must never happen is better as an absent
-- capability than a denied one. A trigger closes paths that do not exist yet,
-- paths that bypass the store, and paths taken by the service-role client —
-- which bypasses RLS and is exactly the client durable execution uses.
--
-- The blocking set is `isActive()`'s three statuses, never the store's
-- two-value ACTIVE_STATUSES. ADR 0056 §10 names that trap: a gate built on the
-- narrower set would admit work beside an erasure paused in `needs_user`.
--
-- `account_erasure` is exempt from its own rule twice over: so an erasure can
-- be started at all, and so a *failed* erasure does not lock the account out
-- of its own product forever.

create index operation_runs_active_erasure_idx
  on public.operation_runs (user_id)
  where operation_type = 'account_erasure'
    and status in ('queued', 'running', 'needs_user');

create or replace function public.reject_start_during_account_erasure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.operation_type = 'account_erasure' then return new; end if;
  if new.user_id is null then return new; end if;

  if exists (
    select 1
    from public.operation_runs o
    where o.user_id = new.user_id
      and o.operation_type = 'account_erasure'
      and o.status in ('queued', 'running', 'needs_user')
  ) then
    raise exception 'account erasure in progress; no new work may start'
      using errcode = 'VB001';
  end if;

  return new;
end;
$$;

comment on function public.reject_start_during_account_erasure() is
  'ADR 0057 §5 — refuses work while an erasure is live. Refuses; authorizes nothing.';

create trigger operation_runs_reject_during_erasure
  before insert on public.operation_runs
  for each row execute function public.reject_start_during_account_erasure();
