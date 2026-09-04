-- ADR 0092: a step whose whole output is a finding records the finding.
--
-- The attestation ADR 0090 opened to Vibe steps closes them with a boolean,
-- and for real-world work that is right: "the sitemap is submitted" is true or
-- it is not. For Vibe's own research it is not. A step asking whether billing
-- is *fully working, partially wired, or not implemented* has three answers,
-- its successors are written to depend on which, and a boolean carries none of
-- them — so the plan went on planning against the guess it started with.
--
-- The finding is founder-written prose, and it is stored as prose. Vibe does
-- not parse it, does not derive options from the step's completion criterion,
-- and never will: that criterion is model output, and turning model wording
-- into a machine API is the mistake this codebase refuses everywhere else.
-- What Vibe does with it is hand it to the next planning run as fenced,
-- untrusted, founder-authored context.
--
-- Nullable, because the two admitted step kinds mean different things. A
-- `founder_action` attestation is a person confirming the world changed and
-- carries no finding; a `vibe` attestation *is* the step's output and must.
-- The function below enforces exactly that, so the invariant holds against a
-- writer that is not the application.

alter table public.action_plan_founder_attestations
  add column if not exists finding text;

alter table public.action_plan_founder_attestations
  add constraint action_plan_founder_attestations_finding_shape
  check (
    finding is null
    or (char_length(btrim(finding)) between 1 and 1200)
  );

comment on column public.action_plan_founder_attestations.finding is
  'What the founder established, in their own words, for a Vibe step whose output is the finding itself. Null for founder_action work, where the attestation confirms the world changed rather than reporting anything. Never parsed; handed to planning as fenced untrusted context.';

-- Replaced rather than overloaded: a second signature would leave the old
-- four-argument function callable, and it is the one that cannot record a
-- finding. Dropping it is what makes the new rule unavoidable.
drop function if exists public.attest_founder_action_step(uuid, uuid, text, uuid);

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
  v_attestation_id uuid;
begin
  select s.step_order, s.actor into v_step_order, v_actor
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

  -- The finding is the Vibe step's entire output, so closing one without it
  -- would record that the work happened and lose what it produced. And a
  -- founder_action step has no finding to give: accepting one there would
  -- invent a second, weaker meaning for the same column.
  if v_actor = 'vibe' and (p_finding is null or btrim(p_finding) = '') then
    raise exception 'founder_step_finding_required';
  end if;

  if v_actor <> 'vibe' and p_finding is not null then
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

revoke all on function public.attest_founder_action_step(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.attest_founder_action_step(uuid, uuid, text, uuid, text)
  to service_role;
