-- ADR 0055: a founder_action step completes only when the owning founder
-- explicitly attests that the immutable step's completion criterion is true.

-- The composite key lets the evidence row prove that the plan it names belongs
-- to the same project. `id` remains the plan's ordinary primary key.
alter table public.action_plans
  add constraint action_plans_id_project_unique unique (id, project_id);

create table public.action_plan_founder_attestations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  action_plan_id uuid not null,
  action_plan_step_key text not null,
  action_plan_step_order smallint not null check (action_plan_step_order between 1 and 9),
  attested_by_user_id uuid not null references auth.users (id) on delete cascade,
  attestation_version text not null default 'founder-action-attestation.v1'
    check (attestation_version = 'founder-action-attestation.v1'),
  created_at timestamptz not null default now(),

  constraint action_plan_founder_attestations_plan_project_fk
    foreign key (action_plan_id, project_id)
    references public.action_plans (id, project_id) on delete cascade,
  constraint action_plan_founder_attestations_plan_step_fk
    foreign key (action_plan_id, action_plan_step_key)
    references public.action_plan_steps (action_plan_id, step_key) on delete cascade,
  constraint action_plan_founder_attestations_one_per_step
    unique (action_plan_id, action_plan_step_key)
);

comment on table public.action_plan_founder_attestations is
  'Immutable founder attestations for founder_action steps. The linked immutable step owns the attested completion criterion.';

create index action_plan_founder_attestations_project_plan_idx
  on public.action_plan_founder_attestations (project_id, action_plan_id, created_at);

alter table public.action_plan_founder_attestations enable row level security;

create policy "select own action_plan_founder_attestations"
  on public.action_plan_founder_attestations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = action_plan_founder_attestations.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- The mutation is deliberately service-role only. It re-establishes project
-- ownership, verifies the exact immutable step is the current plan's
-- founder_action/founder_acts work, and converges retries on one evidence row.
create or replace function public.attest_founder_action_step(
  p_project_id uuid,
  p_action_plan_id uuid,
  p_action_plan_step_key text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step_order smallint;
  v_attestation_id uuid;
begin
  select s.step_order into v_step_order
  from public.action_plan_steps s
  join public.action_plans a on a.id = s.action_plan_id
  join public.projects p on p.id = a.project_id
  where p.id = p_project_id
    and p.user_id = p_user_id
    and a.id = p_action_plan_id
    and a.status = 'completed'
    and s.step_key = p_action_plan_step_key
    and s.actor = 'founder_action'
    and s.execution_support = 'founder_acts';

  if not found then
    raise exception 'founder_action_step_not_attestable';
  end if;

  insert into public.action_plan_founder_attestations (
    project_id,
    action_plan_id,
    action_plan_step_key,
    action_plan_step_order,
    attested_by_user_id
  ) values (
    p_project_id,
    p_action_plan_id,
    p_action_plan_step_key,
    v_step_order,
    p_user_id
  )
  on conflict (action_plan_id, action_plan_step_key) do nothing
  returning id into v_attestation_id;

  if v_attestation_id is null then
    select id into v_attestation_id
    from public.action_plan_founder_attestations
    where action_plan_id = p_action_plan_id
      and action_plan_step_key = p_action_plan_step_key;
  end if;

  return v_attestation_id;
end;
$$;

revoke all on table public.action_plan_founder_attestations from anon, authenticated;
grant select on table public.action_plan_founder_attestations to authenticated;
grant select, insert on table public.action_plan_founder_attestations to service_role;

revoke all on function public.attest_founder_action_step(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.attest_founder_action_step(uuid, uuid, text, uuid)
  to service_role;

-- No update or delete grants/policies. An attestation is historical evidence,
-- not a mutable checkbox. Replanning creates a new immutable step identity.
