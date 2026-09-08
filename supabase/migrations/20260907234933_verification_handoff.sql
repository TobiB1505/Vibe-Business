-- A handoff is not always a refusal (ADR 0097 follow-on).
--
-- The first handoff had exactly one meaning: "Vibe will not build this, here is
-- the prompt for the tool you already use". That is a refusal, and the table's
-- comment says so.
--
-- A measurement step is the opposite shape and lands in the same place. "Verify
-- a real subscription completes end to end" is not work Vibe declined on
-- policy — it is work Vibe *cannot reach*. The validation sandbox runs with no
-- network and no credential, by design, so it can never complete a checkout;
-- the founder's own tool has their keys, their running app and their session.
-- The prompt is the same mechanism pointed at a different question.
--
-- So `purpose` separates the two, rather than one meaning quietly widening to
-- cover both. It matters beyond copy: a `build` handoff is what admits a
-- `vibe` + `product_change` step to founder attestation, and that admission
-- must never follow from a handoff issued for verification.

alter table public.action_plan_handoffs
  add column purpose text not null default 'build'
    check (purpose in ('build', 'verify'));

-- Existing rows are builds, which is what the default records. The default
-- stays so a caller that predates this column cannot write an untyped row.
comment on column public.action_plan_handoffs.purpose is
  'build: Vibe declined the work and handed out the prompt. verify: Vibe cannot reach the check and handed out the prompt. Only build admits a product_change step to attestation.';

comment on table public.action_plan_handoffs is
  'One row per plan step Vibe handed to the founder with a prompt. Not a claim that anything was built or verified — it records that the prompt was issued, and a build handoff is what admits a handed-off product change to founder attestation.';

-- The recorder learns the second shape.
--
-- Dropped and recreated rather than replaced: a new parameter is a new
-- signature, and leaving the five-argument version in place would leave a
-- second door that writes rows with no stated purpose.
drop function if exists public.record_action_plan_handoff(uuid, uuid, text, uuid, text);

create function public.record_action_plan_handoff(
  p_project_id uuid,
  p_action_plan_id uuid,
  p_action_plan_step_key text,
  p_user_id uuid,
  p_tool text,
  p_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step_order smallint;
  v_handoff_id uuid;
begin
  if p_purpose not in ('build', 'verify') then
    raise exception 'action_plan_handoff_purpose_unknown';
  end if;

  -- Each purpose admits exactly one step shape, and neither admits the other.
  --
  -- `build` stays what it was: work Vibe genuinely will not run. `verify` is
  -- the founder's own measurement, which is already theirs to close — so
  -- issuing one grants nothing that was not already granted, and the arm is
  -- written narrowly anyway so that stays true if the shapes ever move.
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
      (p_purpose = 'build' and s.actor = 'vibe' and s.change_kind = 'product_change')
      or (p_purpose = 'verify' and s.actor = 'founder_action' and s.change_kind = 'measurement')
    );

  if not found then
    raise exception 'action_plan_step_not_handoffable';
  end if;

  insert into public.action_plan_handoffs (
    project_id,
    action_plan_id,
    action_plan_step_key,
    action_plan_step_order,
    tool,
    purpose,
    issued_to_user_id
  ) values (
    p_project_id,
    p_action_plan_id,
    p_action_plan_step_key,
    v_step_order,
    p_tool,
    p_purpose,
    p_user_id
  )
  on conflict (action_plan_id, action_plan_step_key) do nothing
  returning id into v_handoff_id;

  if v_handoff_id is null then
    select id into v_handoff_id
    from public.action_plan_handoffs
    where action_plan_id = p_action_plan_id
      and action_plan_step_key = p_action_plan_step_key;
  end if;

  return v_handoff_id;
end;
$$;

revoke all on function public.record_action_plan_handoff(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_action_plan_handoff(uuid, uuid, text, uuid, text, text)
  to service_role;

-- The attestation learns that a measurement produces a result.
--
-- Two changes, and the second is the one that was blocking the screen.
--
-- The handoff arm now requires `purpose = 'build'`. It admits nothing new
-- today — a verify handoff only exists on a `founder_action` step, which the
-- first arm already admits — and it is written anyway, because the arm's whole
-- job is to name the one case where a product change may be closed by hand,
-- and an unqualified `exists` would let a future purpose inherit that.
--
-- And a finding is now required on a measurement step instead of refused. The
-- old rule keyed on the actor alone: `vibe` steps must write down what they
-- found, everybody else must not. That was right for `founder_action` +
-- `external_setup` — "the sitemap is submitted" is true or it is not, and there
-- is nothing to record. A measurement is the opposite: the result *is* the
-- step's output, and closing it with a bare tick threw away the one thing the
-- next planning run most needed.
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

  v_finding_expected :=
    v_actor = 'vibe' or (v_actor = 'founder_action' and v_change_kind = 'measurement');

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
