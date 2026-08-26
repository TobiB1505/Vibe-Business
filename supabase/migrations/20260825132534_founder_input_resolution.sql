-- ADR 0053: dynamic founder-owned inputs, durable resolutions, and
-- evidence-based Action Plan completion.

-- The existing actor taxonomy distinguishes decisions from manual actions.
-- `founder_input` is the factual counterpart to a strategic decision; neither
-- is work Vibe may silently decide or execute.
alter table public.action_plan_steps
  drop constraint action_plan_steps_actor_check;

alter table public.action_plan_steps
  add constraint action_plan_steps_actor_check check (
    actor in ('vibe', 'founder_decision', 'founder_input', 'founder_action', 'external_party')
  );

alter table public.action_plan_steps
  drop constraint action_plan_steps_change_kind_check;

alter table public.action_plan_steps
  add constraint action_plan_steps_change_kind_check check (
    change_kind in (
      'decision', 'input', 'analysis', 'product_change', 'external_setup',
      'measurement', 'research'
    )
  );

alter table public.action_plan_steps
  drop constraint action_plan_steps_execution_support_check;

alter table public.action_plan_steps
  add constraint action_plan_steps_execution_support_check check (
    execution_support in (
      'vibe_executes_now', 'vibe_prepares', 'founder_decides',
      'founder_provides_input', 'founder_acts', 'external_dependency',
      'not_yet_supported'
    )
  );

alter table public.action_plan_steps
  add column founder_input_requirement jsonb;

alter table public.action_plan_steps
  add constraint action_plan_steps_founder_input_requirement_shape check (
    founder_input_requirement is null
    or (
      jsonb_typeof(founder_input_requirement) = 'object'
      and octet_length(founder_input_requirement::text) <= 12000
    )
  );

comment on column public.action_plan_steps.founder_input_requirement is
  'Validated planner-authored request content. Null for non-founder-input work and for legacy plans created before ADR 0053.';

create table public.project_founder_input_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  action_plan_id uuid references public.action_plans (id) on delete cascade,
  action_plan_step_key text,
  execution_interrupt_id uuid references public.execution_interrupts (id) on delete set null,

  origin text not null check (origin in ('planner', 'execution_blocker')),
  input_kind text not null check (input_kind in ('decision', 'input')),
  subject_key text not null check (
    char_length(subject_key) between 3 and 96
    and subject_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  question text not null check (char_length(btrim(question)) between 3 and 400),
  why_needed text not null check (char_length(btrim(why_needed)) between 3 and 600),
  response_type text not null check (response_type in ('confirm', 'single_select', 'text')),
  recommendation jsonb,
  alternatives jsonb not null default '[]'::jsonb,
  allow_custom boolean not null default false,
  context_hash text not null check (char_length(context_hash) = 64),

  status text not null default 'open' check (status in ('open', 'resolved', 'superseded', 'cancelled')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint founder_input_requests_plan_step_pair check (
    (action_plan_id is null and action_plan_step_key is null)
    or (action_plan_id is not null and action_plan_step_key is not null)
  ),
  constraint founder_input_requests_origin_link check (
    (origin = 'planner' and action_plan_id is not null and execution_interrupt_id is null)
    or (origin = 'execution_blocker' and execution_interrupt_id is not null)
  ),
  constraint founder_input_requests_recommendation_shape check (
    recommendation is null or jsonb_typeof(recommendation) = 'object'
  ),
  constraint founder_input_requests_alternatives_shape check (
    jsonb_typeof(alternatives) = 'array' and jsonb_array_length(alternatives) <= 5
  ),
  constraint founder_input_requests_resolved_time check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  ),
  constraint founder_input_requests_id_project_unique unique (id, project_id),
  constraint founder_input_requests_plan_step_unique unique (action_plan_id, action_plan_step_key),
  constraint founder_input_requests_plan_step_fk foreign key (action_plan_id, action_plan_step_key)
    references public.action_plan_steps (action_plan_id, step_key) on delete cascade
);

comment on table public.project_founder_input_requests is
  'Bounded dynamic questions generated from project intelligence. No secrets, credentials, prompts, raw model responses or reasoning.';

create unique index project_founder_input_requests_one_open_subject_idx
  on public.project_founder_input_requests (project_id, input_kind, subject_key)
  where status = 'open';

create index project_founder_input_requests_plan_status_idx
  on public.project_founder_input_requests (action_plan_id, status, created_at);

create index project_founder_input_requests_project_created_idx
  on public.project_founder_input_requests (project_id, created_at desc);

create trigger set_updated_at
  before update on public.project_founder_input_requests
  for each row execute function public.set_updated_at();

alter table public.project_founder_input_requests enable row level security;

create policy "select own project_founder_input_requests"
  on public.project_founder_input_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_founder_input_requests.project_id
        and p.user_id = (select auth.uid())
    )
  );

create table public.project_founder_resolutions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  request_id uuid not null unique,
  input_kind text not null check (input_kind in ('decision', 'input')),
  subject_key text not null check (
    char_length(subject_key) between 3 and 96
    and subject_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  response_source text not null check (response_source in ('recommendation', 'option', 'custom')),
  selected_option_id text,
  raw_answer text,
  resolved_statement text not null check (char_length(btrim(resolved_statement)) between 1 and 1200),
  context_hash text not null check (char_length(context_hash) = 64),
  supersedes_resolution_id uuid references public.project_founder_resolutions (id) on delete restrict,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),

  constraint founder_resolutions_custom_has_raw_answer check (
    response_source <> 'custom'
    or (raw_answer is not null and char_length(btrim(raw_answer)) between 1 and 1200)
  ),
  constraint founder_resolutions_response_shape check (
    (
      response_source = 'custom'
      and selected_option_id is null
      and raw_answer is not null
      and char_length(raw_answer) <= 1200
    )
    or (
      response_source in ('recommendation', 'option')
      and selected_option_id is not null
      and char_length(selected_option_id) between 1 and 64
      and raw_answer is null
    )
  ),
  constraint founder_resolutions_request_project_fk
    foreign key (request_id, project_id)
    references public.project_founder_input_requests (id, project_id) on delete restrict
);

comment on table public.project_founder_resolutions is
  'Versioned project context produced by a founder response. Raw custom input is preserved; superseded rows remain immutable history.';

create unique index project_founder_resolutions_one_active_subject_idx
  on public.project_founder_resolutions (project_id, input_kind, subject_key)
  where superseded_at is null;

create index project_founder_resolutions_project_created_idx
  on public.project_founder_resolutions (project_id, created_at desc);

alter table public.project_founder_resolutions enable row level security;

create policy "select own project_founder_resolutions"
  on public.project_founder_resolutions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_founder_resolutions.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- Founder answers need one row lock and one transaction: validate the selected
-- path against the stored request, supersede an older active decision, insert
-- the new immutable resolution, and close the request. Only the server-side
-- service-role path may call this function; the caller's authenticated user id
-- is re-checked against the project row inside the transaction.
create or replace function public.resolve_founder_input_request(
  p_request_id uuid,
  p_user_id uuid,
  p_response_source text,
  p_selected_option_id text default null,
  p_raw_answer text default null,
  p_expected_context_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.project_founder_input_requests%rowtype;
  v_existing_resolution_id uuid;
  v_previous_resolution_id uuid;
  v_resolution_id uuid;
  v_resolved_statement text;
  v_selected_option_id text;
  v_option jsonb;
begin
  select r.* into v_request
  from public.project_founder_input_requests r
  join public.projects p on p.id = r.project_id
  where r.id = p_request_id and p.user_id = p_user_id
  for update of r;

  if not found then
    raise exception 'founder_input_request_not_found';
  end if;

  if v_request.status = 'resolved' then
    select id into v_existing_resolution_id
    from public.project_founder_resolutions
    where request_id = v_request.id;
    if v_existing_resolution_id is not null then
      return v_existing_resolution_id;
    end if;
  end if;

  if v_request.status <> 'open' then
    raise exception 'founder_input_request_not_open';
  end if;

  if p_expected_context_hash is null or p_expected_context_hash <> v_request.context_hash then
    raise exception 'stale_founder_input_request';
  end if;

  if p_response_source = 'recommendation' then
    if v_request.recommendation is null then
      raise exception 'founder_input_recommendation_missing';
    end if;
    v_resolved_statement := nullif(btrim(v_request.recommendation ->> 'value'), '');
    v_selected_option_id := nullif(btrim(v_request.recommendation ->> 'id'), '');
  elsif p_response_source = 'option' then
    if p_selected_option_id is null then
      raise exception 'founder_input_option_missing';
    end if;
    select option_value into v_option
    from jsonb_array_elements(v_request.alternatives) option_value
    where option_value ->> 'id' = p_selected_option_id
    limit 1;
    if v_option is null then
      raise exception 'founder_input_option_invalid';
    end if;
    v_resolved_statement := nullif(btrim(v_option ->> 'value'), '');
    v_selected_option_id := p_selected_option_id;
  elsif p_response_source = 'custom' then
    if not v_request.allow_custom then
      raise exception 'founder_input_custom_not_allowed';
    end if;
    v_resolved_statement := nullif(btrim(p_raw_answer), '');
  else
    raise exception 'founder_input_response_source_invalid';
  end if;

  if v_resolved_statement is null or char_length(v_resolved_statement) > 1200 then
    raise exception 'founder_input_answer_invalid';
  end if;

  select id into v_previous_resolution_id
  from public.project_founder_resolutions
  where project_id = v_request.project_id
    and input_kind = v_request.input_kind
    and subject_key = v_request.subject_key
    and superseded_at is null
  for update;

  if v_previous_resolution_id is not null then
    update public.project_founder_resolutions
    set superseded_at = now()
    where id = v_previous_resolution_id;
  end if;

  insert into public.project_founder_resolutions (
    project_id,
    request_id,
    input_kind,
    subject_key,
    response_source,
    selected_option_id,
    raw_answer,
    resolved_statement,
    context_hash,
    supersedes_resolution_id
  ) values (
    v_request.project_id,
    v_request.id,
    v_request.input_kind,
    v_request.subject_key,
    p_response_source,
    v_selected_option_id,
    case when p_response_source = 'custom' then p_raw_answer else null end,
    v_resolved_statement,
    v_request.context_hash,
    v_previous_resolution_id
  ) returning id into v_resolution_id;

  update public.project_founder_input_requests
  set status = 'resolved', resolved_at = now()
  where id = v_request.id;

  return v_resolution_id;
end;
$$;

revoke all on table public.project_founder_input_requests from anon, authenticated;
revoke all on table public.project_founder_resolutions from anon, authenticated;
grant select on table public.project_founder_input_requests to authenticated;
grant select on table public.project_founder_resolutions to authenticated;
grant select, insert, update, delete on table public.project_founder_input_requests to service_role;
grant select, insert, update, delete on table public.project_founder_resolutions to service_role;

revoke all on function public.resolve_founder_input_request(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_founder_input_request(uuid, uuid, text, text, text, text) to service_role;
