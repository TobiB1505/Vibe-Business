-- ADR 0096: work Vibe will not do becomes a prompt the founder runs themselves.
--
-- Vibe refuses payment architecture and authentication rewrites permanently,
-- and the refusal is right: Vibe's validation runs the project's own typecheck,
-- tests and build, and none of those can see that a charge is off by a factor
-- of a hundred. But the founder is a vibe coder with their own coding agent,
-- their own credentials and their own machine, and they are allowed to do what
-- Vibe is not. So the refusal becomes a handoff.
--
-- This table is the durable fact that a handoff happened, and it exists for one
-- specific reason: it is what makes the attestation below safe. `isFounderAttestable`
-- deliberately excludes a `vibe` + `product_change` step, so that a founder can
-- never confirm away work Vibe would have built (ADR 0090). A handed-off step is
-- exactly that shape — so admitting it needs a gate that is a *fact in the
-- database*, not an opinion a resolver held at render time.
--
-- The gate is issued only where Vibe refuses by policy; the server action that
-- writes it re-derives that live. What is stored here is the outcome, and it is
-- bound to one immutable plan/step pair, so a replan cannot inherit it.

create table public.action_plan_handoffs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  action_plan_id uuid not null,
  action_plan_step_key text not null,
  action_plan_step_order smallint not null check (action_plan_step_order between 1 and 9),
  -- Which tool the founder said they would paste it into. A closed vocabulary,
  -- because it selects one Vibe-authored preamble sentence and a free-text
  -- value would select none.
  tool text not null check (tool in ('claude_code', 'codex', 'cursor', 'lovable', 'other')),
  issued_to_user_id uuid not null references auth.users (id) on delete cascade,
  handoff_version text not null default 'action-plan-handoff.v1'
    check (handoff_version = 'action-plan-handoff.v1'),
  created_at timestamptz not null default now(),

  constraint action_plan_handoffs_plan_project_fk
    foreign key (action_plan_id, project_id)
    references public.action_plans (id, project_id) on delete cascade,
  constraint action_plan_handoffs_plan_step_fk
    foreign key (action_plan_id, action_plan_step_key)
    references public.action_plan_steps (action_plan_id, step_key) on delete cascade,
  constraint action_plan_handoffs_one_per_step
    unique (action_plan_id, action_plan_step_key)
);

comment on table public.action_plan_handoffs is
  'One row per plan step Vibe handed to the founder to build with their own tool. Not a claim that anything was built — it records that the prompt was issued, and it is what admits the step to founder attestation.';

create index action_plan_handoffs_project_plan_idx
  on public.action_plan_handoffs (project_id, action_plan_id, created_at);

-- Every foreign key gets a covering index, and two of these needed one written
-- deliberately rather than inherited. VB-027 caught both.
--
-- The index above leads on `project_id`, so it does not cover the composite key
-- on `(action_plan_id, project_id)` — column order decides, and the arity here
-- is the exact case that test exists for. The step key's own key is covered by
-- the one-per-step unique constraint, which leads on `action_plan_id`.
create index action_plan_handoffs_plan_project_idx
  on public.action_plan_handoffs (action_plan_id, project_id);

create index action_plan_handoffs_issued_to_user_idx
  on public.action_plan_handoffs (issued_to_user_id);

alter table public.action_plan_handoffs enable row level security;

create policy "select own action_plan_handoffs"
  on public.action_plan_handoffs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = action_plan_handoffs.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- Service-role only, like the attestation it gates. It re-establishes ownership
-- and admits only a step Vibe genuinely will not run: `vibe` + `product_change`.
-- Every other shape either has an executor or is already attestable without a
-- handoff, and issuing one for those would create a second way to close work
-- the agent should do.
create or replace function public.record_action_plan_handoff(
  p_project_id uuid,
  p_action_plan_id uuid,
  p_action_plan_step_key text,
  p_user_id uuid,
  p_tool text
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
  select s.step_order into v_step_order
  from public.action_plan_steps s
  join public.action_plans a on a.id = s.action_plan_id
  join public.projects p on p.id = a.project_id
  where p.id = p_project_id
    and p.user_id = p_user_id
    and a.id = p_action_plan_id
    and a.status = 'completed'
    and s.step_key = p_action_plan_step_key
    and s.actor = 'vibe'
    and s.change_kind = 'product_change';

  if not found then
    raise exception 'action_plan_step_not_handoffable';
  end if;

  insert into public.action_plan_handoffs (
    project_id,
    action_plan_id,
    action_plan_step_key,
    action_plan_step_order,
    tool,
    issued_to_user_id
  ) values (
    p_project_id,
    p_action_plan_id,
    p_action_plan_step_key,
    v_step_order,
    p_tool,
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

revoke all on table public.action_plan_handoffs from anon, authenticated;
grant select on table public.action_plan_handoffs to authenticated;
grant select, insert on table public.action_plan_handoffs to service_role;

revoke all on function public.record_action_plan_handoff(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_action_plan_handoff(uuid, uuid, text, uuid, text)
  to service_role;

-- And the attestation opens to exactly the steps a handoff was issued for.
--
-- `vibe` + `product_change` stays excluded in general — that exclusion is what
-- stops a founder confirming away work the agent would build. What changes is
-- that a step Vibe handed *out* is no longer that work: Vibe declined it, said
-- so, and gave the founder the prompt instead.
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
      or (
        s.actor = 'vibe'
        and s.change_kind = 'product_change'
        and exists (
          select 1 from public.action_plan_handoffs h
          where h.action_plan_id = a.id
            and h.action_plan_step_key = s.step_key
        )
      )
    );

  if not found then
    raise exception 'founder_action_step_not_attestable';
  end if;

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
