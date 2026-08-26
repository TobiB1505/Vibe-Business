-- ADR 0053 follow-up: runtime-discovered founder input reuses the canonical
-- Founder Input Request domain and ends the old execution attempt before a
-- fresh admission/spec/run is allowed to start.

alter table public.execution_interrupts
  add column founder_input_request_id uuid
    references public.project_founder_input_requests (id) on delete set null;

alter table public.execution_interrupts
  drop constraint execution_interrupts_interrupt_type_check;

alter table public.execution_interrupts
  add constraint execution_interrupts_interrupt_type_check check (interrupt_type in (
    'business_decision_required', 'founder_input_required',
    'materially_different_outcomes', 'permission_semantics_unknown',
    'external_paid_service_required', 'destructive_migration_required',
    'scope_expansion_required', 'additional_credits_required',
    'consequential_action_approval_required'
  ));

create index execution_interrupts_founder_input_request_idx
  on public.execution_interrupts (founder_input_request_id)
  where founder_input_request_id is not null;

comment on column public.execution_interrupts.founder_input_request_id is
  'Canonical Founder Input Request that resolves this operational blocker. Multiple concurrent interrupts may converge on one request.';

comment on table public.execution_interrupts is
  'One bounded question an execution stopped on. The situation is closed, the question may be Vibe- or runtime-generated, and no reasoning or transcript is stored.';

comment on column public.execution_interrupts.question is
  'Bounded founder-facing question normalized into a canonical Founder Input Request; never model reasoning or a transcript.';

-- One transaction creates the operational history row and the reusable
-- founder-input request. The service role is the sole caller; ownership and
-- every parent binding are re-established from the persisted run.
create or replace function public.raise_execution_founder_input_request(
  p_agent_execution_run_id uuid,
  p_interrupt_type text,
  p_question text,
  p_response_schema jsonb,
  p_input_kind text,
  p_subject_key text,
  p_why_needed text,
  p_response_type text,
  p_recommendation jsonb,
  p_alternatives jsonb,
  p_allow_custom boolean
)
returns table (execution_interrupt_id uuid, founder_input_request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_execution_runs%rowtype;
  v_interrupt_id uuid;
  v_request_id uuid;
  v_context_hash text;
begin
  select r.* into v_run
  from public.agent_execution_runs r
  where r.id = p_agent_execution_run_id
    and r.status in ('queued', 'running', 'needs_user_input')
  for update;

  if not found then
    raise exception 'agent_execution_run_not_open';
  end if;

  select s.spec_identity into v_context_hash
  from public.execution_specs s
  where s.id = v_run.execution_spec_id and s.project_id = v_run.project_id;
  if v_context_hash is null then raise exception 'runtime_founder_input_spec_missing'; end if;

  select i.id, i.founder_input_request_id
    into v_interrupt_id, v_request_id
  from public.execution_interrupts i
  where i.agent_execution_run_id = v_run.id and i.status = 'open'
  for update;

  if v_interrupt_id is null then
    insert into public.execution_interrupts (
      project_id, user_id, execution_spec_id, agent_execution_run_id,
      interrupt_type, question, response_schema, status
    ) values (
      v_run.project_id, v_run.user_id, v_run.execution_spec_id, v_run.id,
      p_interrupt_type, p_question, p_response_schema, 'open'
    ) returning id into v_interrupt_id;
  end if;

  if v_request_id is null then
    begin
      insert into public.project_founder_input_requests (
        project_id, action_plan_id, action_plan_step_key, execution_interrupt_id,
        origin, input_kind, subject_key, question, why_needed, response_type,
        recommendation, alternatives, allow_custom, context_hash, status
      ) values (
        v_run.project_id, null, null, v_interrupt_id,
        'execution_blocker', p_input_kind, p_subject_key, p_question, p_why_needed,
        p_response_type, p_recommendation, p_alternatives, p_allow_custom,
        v_context_hash, 'open'
      ) returning id into v_request_id;
    exception when unique_violation then
      select r.id into v_request_id
      from public.project_founder_input_requests r
      where r.project_id = v_run.project_id
        and r.input_kind = p_input_kind
        and r.subject_key = p_subject_key
        and r.status = 'open'
      for update;

      if v_request_id is null then
        raise;
      end if;
    end;

    update public.execution_interrupts
    set founder_input_request_id = v_request_id
    where id = v_interrupt_id and founder_input_request_id is null;
  end if;

  return query select v_interrupt_id, v_request_id;
end;
$$;

-- Resolving a runtime request closes the old immutable attempt in the same
-- transaction as the durable resolution. It deliberately does not create or
-- start its replacement: fresh admission reads live project/repository state
-- after this transaction and writes a new immutable ExecutionSpec.
create or replace function public.finalize_runtime_founder_input_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution_id uuid;
begin
  if new.origin <> 'execution_blocker' or new.status <> 'resolved' or old.status = 'resolved' then
    return new;
  end if;

  select r.id into v_resolution_id
  from public.project_founder_resolutions r
  where r.request_id = new.id;

  if v_resolution_id is null then
    raise exception 'runtime_founder_input_resolution_missing';
  end if;

  if not exists (
    select 1
    from public.execution_interrupts i
    join public.agent_execution_runs aer on aer.id = i.agent_execution_run_id
    where i.founder_input_request_id = new.id
  ) then
    raise exception 'runtime_founder_input_attempt_missing';
  end if;

  if exists (
    select 1 from public.billing_credit_reservations b
    where b.status = 'active'
      and b.operation_run_id in (
        select aer.operation_run_id
        from public.execution_interrupts i
        join public.agent_execution_runs aer on aer.id = i.agent_execution_run_id
        where i.founder_input_request_id = new.id
      )
  ) then
    raise exception 'runtime_founder_input_reservation_still_active';
  end if;

  update public.execution_interrupts
  set status = 'answered',
      answer = jsonb_build_object(
        'kind', 'founder_input_resolution',
        'resolutionId', v_resolution_id
      ),
      answered_at = now()
  where founder_input_request_id = new.id and status = 'open';

  update public.agent_execution_runs
  set status = 'cancelled', completed_at = now()
  where id in (
    select i.agent_execution_run_id
    from public.execution_interrupts i
    where i.founder_input_request_id = new.id
  ) and status = 'needs_user_input';

  update public.operation_runs
  set status = 'cancelled', completed_at = now()
  where id in (
    select aer.operation_run_id
    from public.execution_interrupts i
    join public.agent_execution_runs aer on aer.id = i.agent_execution_run_id
    where i.founder_input_request_id = new.id
  ) and status = 'needs_user';

  return new;
end;
$$;

create trigger finalize_runtime_founder_input_attempt
  after update of status on public.project_founder_input_requests
  for each row
  when (new.status = 'resolved' and old.status is distinct from new.status)
  execute function public.finalize_runtime_founder_input_attempt();

revoke all on function public.raise_execution_founder_input_request(
  uuid, text, text, jsonb, text, text, text, text, jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.raise_execution_founder_input_request(
  uuid, text, text, jsonb, text, text, text, text, jsonb, jsonb, boolean
) to service_role;

revoke all on function public.finalize_runtime_founder_input_attempt() from public, anon, authenticated;
