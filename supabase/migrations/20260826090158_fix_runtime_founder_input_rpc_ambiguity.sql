-- Qualify the execution_interrupts target row explicitly. The RPC returns a
-- column named founder_input_request_id, which also becomes a PL/pgSQL output
-- variable; leaving the target column unqualified is therefore ambiguous.
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

    update public.execution_interrupts as i
    set founder_input_request_id = v_request_id
    where i.id = v_interrupt_id and i.founder_input_request_id is null;
  end if;

  return query select v_interrupt_id, v_request_id;
end;
$$;

revoke all on function public.raise_execution_founder_input_request(
  uuid, text, text, jsonb, text, text, text, text, jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.raise_execution_founder_input_request(
  uuid, text, text, jsonb, text, text, text, text, jsonb, jsonb, boolean
) to service_role;
