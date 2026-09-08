-- The last step shape with no way to close it.
--
-- `external_party` is a real actor the planner assigns: "wait for Google to
-- index the new pages", "wait for the domain transfer to complete". Nothing
-- inside Vibe produces it, no founder action performs it, and until now no
-- authority finished it either — `completed_steps_from_evidence` said as much
-- in a comment, that an external dependency "contributes nothing until its own
-- authority exists".
--
-- What that produced on screen is worth stating, because it was observed rather
-- than reasoned about: the plan marked such a step **Start here** and rendered
-- no control at all, while the panel two lines below said *"Needs from you:
-- nothing right now"*. A founder told to start something, given nothing to
-- start it with, and told in the same breath that nothing was needed.
--
-- The authority it was waiting for is the founder's own eyes. Only they can see
-- that Google indexed the pages; Vibe has no integration that observes it, and
-- inventing one would be a different product. So this admits the same
-- confirmation `founder_action` already carries — and it grants nothing the
-- agent wanted, because no execution path has ever produced an
-- `external_party` step.

create or replace function public.attest_founder_action_step(
  p_project_id uuid,
  p_action_plan_id uuid,
  p_action_plan_step_key text,
  p_user_id uuid,
  p_finding text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step_order smallint;
  v_actor text;
  v_change_kind text;
  v_finding_expected boolean;
  v_attestation_id uuid;
begin
  select s.step_order, s.actor, s.change_kind
    into v_step_order, v_actor, v_change_kind
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
      -- Confirming that the outside world did the thing. Paired with its own
      -- execution support for the same reason the arm above is: the actor says
      -- who acts, and the support says Vibe agreed nothing of its own runs.
      or (s.actor = 'external_party' and s.execution_support = 'external_dependency')
      or (s.actor = 'vibe' and s.change_kind <> 'product_change')
      or (
        s.actor = 'vibe'
        and s.change_kind = 'product_change'
        and exists (
          select 1 from public.action_plan_handoffs h
          where h.action_plan_id = a.id
            and h.action_plan_step_key = s.step_key
            and h.purpose = 'build'
        )
      )
    );

  if not found then
    raise exception 'founder_action_step_not_attestable';
  end if;

  -- Keyed on the change kind rather than on the actor, which is what it was
  -- always about. A measurement's result *is* its output whoever ran it; a
  -- setup step is done or it is not and there is nothing to write down. The
  -- actor still decides it for `vibe`, whose steps are all findings.
  v_finding_expected := v_actor = 'vibe' or v_change_kind = 'measurement';

  if v_finding_expected and (p_finding is null or btrim(p_finding) = '') then
    raise exception 'founder_step_finding_required';
  end if;

  if not v_finding_expected and p_finding is not null then
    raise exception 'founder_step_finding_not_accepted';
  end if;

  insert into public.action_plan_founder_attestations (
    project_id,
    action_plan_id,
    action_plan_step_key,
    action_plan_step_order,
    attested_by_user_id,
    finding
  ) values (
    p_project_id,
    p_action_plan_id,
    p_action_plan_step_key,
    v_step_order,
    p_user_id,
    p_finding
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
