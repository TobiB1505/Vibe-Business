-- EXECUTION CORE-3 — the agentic execution contract.
--
-- One immutable instruction package for one resolved Action Plan step. It
-- records what a future Coding Agent would be authorized to do, against which
-- exact commit, under which policy, with which Credit ceiling.
--
-- It authorizes nothing. A row here is the same kind of object a
-- `change_approvals` row is: a record of a decision, not a capability. No
-- repository is touched by this migration, no agent exists, and nothing in the
-- product writes one yet — the server-only creation path in
-- `src/modules/execution-contract/service.ts` is the only writer, and Core-4
-- supplies its caller.
--
-- Deliberately NOT a mutable row with a status column. §10 requires that a
-- spec's historical meaning never changes: if a decision, the repository HEAD,
-- the plan or a policy version moves, the answer is a NEW spec with a new
-- identity. A status column would invite an UPDATE, and an UPDATE is exactly
-- how "the spec that was executed" quietly becomes "the spec as it is now".

-- ---------------------------------------------------------------------
-- execution_specs
-- ---------------------------------------------------------------------
create table public.execution_specs (
  id uuid primary key default gen_random_uuid(),

  -- Ownership, and the only scope every read is filtered on.
  project_id uuid not null references public.projects (id) on delete cascade,

  -- The step this instruction package was built for. `restrict` on the plan
  -- rather than `cascade`: a spec that cannot say which plan it came from
  -- documents nothing, and plans are already never deleted (they are
  -- superseded), so this only fires on a genuine mistake.
  action_plan_id uuid not null references public.action_plans (id) on delete restrict,
  -- The plan step's own deterministic key, not a row id: it is what the plan
  -- document, the resolver and the spec identity all agree on.
  step_key text not null check (char_length(btrim(step_key)) > 0),
  step_order integer not null check (step_order >= 1),

  -- Lineage, so audit → move → plan → step → spec is queryable end to end.
  business_audit_id uuid not null references public.business_readiness_audits (id) on delete restrict,
  opportunity_id text not null check (char_length(btrim(opportunity_id)) > 0),

  -- sha256 over project, plan, step, base SHA, snapshot, mode, class, risk,
  -- capability, business-context hash and every policy version. The uniqueness
  -- key, and the reason a spec cannot come to describe different work (§10).
  spec_identity text not null check (char_length(spec_identity) = 64),

  -- What kind of authority this describes. Mirrors the TypeScript unions; the
  -- pairing between them is asserted by `schema.test.ts` against this file.
  mode text not null check (mode in ('deterministic', 'agentic')),
  execution_class text check (execution_class in ('application_code_change')),
  risk_class text not null check (risk_class in ('low', 'moderate', 'high', 'prohibited')),

  -- Where the work is defined. `base_sha` is the whole of §16: a change is a
  -- commit on top of a specific parent, and there is no "latest default branch"
  -- anywhere in this contract.
  repository_connection_id uuid not null
    references public.repository_connections (id) on delete restrict,
  base_sha text not null check (char_length(base_sha) = 40),
  repository_snapshot_id uuid not null
    references public.repository_intelligence_snapshots (id) on delete restrict,

  capability text check (capability in ('nextjs_seo_foundations_v1', 'nextjs_seo_foundations_v2')),
  capability_version text,

  -- An agentic spec names its execution class; a deterministic one names its
  -- capability. Neither may claim the other's authority, and a row that did
  -- would be a spec nothing downstream could route.
  constraint execution_specs_mode_matches_authority
    check (
      (mode = 'agentic' and execution_class is not null and capability is null)
      or (mode = 'deterministic' and execution_class is null and capability is not null)
    ),

  -- Billing identities (§24). The quote is what the customer was shown; it is
  -- recorded here so a later audit can join a spec to the number somebody
  -- approved. The reservation is deliberately NOT here: money is bound at
  -- admission, immediately before spending, and a hold recorded on an immutable
  -- row could not be released without the row lying.
  credit_quote_id uuid references public.billing_credit_quotes (id) on delete set null,
  max_authorized_credits integer check (max_authorized_credits is null or max_authorized_credits > 0),

  -- The spec document itself. JSONB rather than fifty columns because it is
  -- read whole, by one consumer, and its shape is versioned in
  -- `schema_version` — the same reasoning `business_readiness_audits.result`
  -- already uses.
  --
  -- What it must never contain: an API key, a token, a private key, a session
  -- cookie, a model prompt, a model response, or a reasoning trace. The
  -- TypeScript type has no field for any of them (§11, §34).
  spec jsonb not null,

  schema_version text not null check (char_length(btrim(schema_version)) > 0),
  resolver_version text not null check (char_length(btrim(resolver_version)) > 0),
  policy_version text not null check (char_length(btrim(policy_version)) > 0),
  risk_policy_version text not null check (char_length(btrim(risk_policy_version)) > 0),

  created_at timestamptz not null default now()
);

comment on table public.execution_specs is
  'One immutable ExecutionSpec: the bounded instruction package a future Coding Agent would receive for one Action Plan step. Records authority, never grants it.';

comment on column public.execution_specs.spec_identity is
  'sha256 over project, plan, step, base SHA, snapshot, mode, class, risk, capability and every policy version. A changed premise produces a new spec, never an edited one.';

comment on column public.execution_specs.base_sha is
  'The exact commit the work is defined against. There is no "latest default branch" in this contract.';

comment on column public.execution_specs.spec is
  'The versioned spec document. Never contains secrets, prompts, model output or reasoning — the type it is serialized from has no field for any of them.';

-- One spec per identity per project. A re-resolution of an unchanged world
-- loses its second insert here rather than producing two rows that both claim
-- to be the instruction for the same work.
create unique index execution_specs_identity_idx
  on public.execution_specs (project_id, spec_identity);

create index execution_specs_plan_step_idx
  on public.execution_specs (action_plan_id, step_order, created_at desc);

create index execution_specs_project_created_idx
  on public.execution_specs (project_id, created_at desc);

-- ---------------------------------------------------------------------
-- Immutability (§10, §47)
--
-- Enforced in the database rather than by convention, because "nothing updates
-- this table" is a claim about every future line of code in the repository and
-- a trigger is a claim about the table. There is also no update policy below,
-- so a browser cannot reach this at all; the trigger additionally covers the
-- service-role client, which bypasses RLS entirely (Rule 53).
-- ---------------------------------------------------------------------
create or replace function public.reject_execution_spec_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'execution_specs rows are immutable. Re-resolve the step and insert a new spec instead.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger execution_specs_immutable
  before update or delete on public.execution_specs
  for each row execute function public.reject_execution_spec_mutation();

-- ---------------------------------------------------------------------
-- RLS
--
-- Read-your-own, and nothing else. There is deliberately no insert, update or
-- delete policy for authenticated users, which is the database half of §54:
--
--   * a client cannot forge an execution mode, because it cannot insert a row;
--   * a client cannot forge a base SHA or a repository, for the same reason;
--   * a client cannot expand a tool policy — the policy lives inside `spec`,
--     which only the server writes;
--   * a client cannot raise its own Credit ceiling;
--   * a client cannot turn a blocked step into a ready one.
--
-- Specs are created by the server-only service using the service-role client,
-- exactly as durable execution already creates operation rows, with ownership
-- taken from the persisted project row rather than from a caller (Rule 53).
-- ---------------------------------------------------------------------
alter table public.execution_specs enable row level security;

create policy "select own execution_specs"
  on public.execution_specs
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = execution_specs.project_id and p.user_id = auth.uid()
    )
  );
