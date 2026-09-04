-- ADR 0088: a founder may also close a Vibe step Vibe has no executor for.
--
-- `resolveStepExecution` refuses every `vibe` step whose change kind is not
-- `product_change`, and that refusal had no way out: no agent run produces
-- such a step, no founder resolution covers it, and this function rejected it.
-- It could not be completed by anything, so the plan stopped there for good.
--
-- The admitted set is keyed on `change_kind`, not `execution_support`, because
-- `not_yet_supported` is also what a `product_change` step carries when the
-- deterministic registry misses it — the work the agent exists to do. Keying
-- on the change kind keeps every buildable change out of a founder's reach.
--
-- The function keeps its name. It is granted to service_role only, its name is
-- part of that grant and of the client that calls it, and renaming it would be
-- a second change wearing the first one's clothes.

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
    and (
      (s.actor = 'founder_action' and s.execution_support = 'founder_acts')
      or (s.actor = 'vibe' and s.change_kind <> 'product_change')
    );

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

revoke all on function public.attest_founder_action_step(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.attest_founder_action_step(uuid, uuid, text, uuid)
  to service_role;

comment on table public.action_plan_founder_attestations is
  'Immutable founder attestations for steps no execution can complete: founder_action work, and Vibe work Vibe has no executor for. The linked immutable step owns the attested completion criterion.';
