-- A full-depth project, built in one statement so a test can create as many as
-- it needs. It deliberately carries BOTH tables that reference execution_specs
-- with ON DELETE RESTRICT — agent_execution_runs and execution_interrupts —
-- because the Wave 0 fixture carried neither, and they are exactly what makes
-- a direct execution_specs delete impossible (ADR 0056 §5).
create or replace function public.build_lifecycle_fixture(p_label text)
returns table (user_id uuid, project_id uuid, spec_id uuid)
language plpgsql as $$
declare
  u uuid; inst uuid; prj uuid; conn uuid; rsnap uuid; lsnap uuid;
  prof uuid; aud uuid; oset uuid; plan uuid; spec uuid; orun uuid; arun uuid;
  n bigint; h64 text;
begin
  n := (random() * 1000000000)::bigint;
  h64 := md5(random()::text) || md5(random()::text);

  insert into auth.users (email) values (p_label || '@fixture.test') returning id into u;

  insert into public.github_installations
    (user_id, installation_id, github_account_id, github_account_login, account_type,
     repository_selection)
  values (u, n, n, 'octo-' || p_label, 'User', 'all') returning id into inst;

  insert into public.projects (user_id, name) values (u, p_label) returning id into prj;

  insert into public.repository_connections
    (project_id, github_installation_id, github_repository_id, owner, name, full_name,
     default_branch, private, html_url)
  values (prj, inst, n, 'octo', p_label, 'octo/' || p_label, 'main', false,
          'https://github.com/octo/' || p_label)
  returning id into conn;

  insert into public.repository_intelligence_snapshots
    (project_id, repository_connection_id, source_commit_sha, source_branch, analyzer_version,
     schema_version)
  values (prj, conn, repeat('a', 40), 'main', 'v1', 'v1') returning id into rsnap;

  insert into public.live_product_intelligence_snapshots
    (project_id, source_origin, configured_url, analyzer_version, schema_version)
  values (prj, 'https://fixture.test', 'https://fixture.test', 'v1', 'v1') returning id into lsnap;

  insert into public.product_profiles
    (project_id, schema_version, builder_version, evidence_version, input_hash)
  values (prj, 'v1', 'v1', 'v1', h64) returning id into prof;

  insert into public.business_readiness_audits
    (project_id, repository_snapshot_id, live_snapshot_id, business_context_hash, schema_version,
     audit_version, evidence_pack_version, prompt_version, rubric_version, provider, model,
     input_hash, access_mode, status, completed_at, result, assessed_lenses)
  values (prj, rsnap, lsnap, h64, 'v1', 'v7', 'v4', 'v1', 'v1', 'anthropic', 'm', h64,
          'credits', 'completed', now(), '{}'::jsonb, 9)
  returning id into aud;

  insert into public.opportunity_sets
    (project_id, business_audit_id, schema_version, engine_version, prompt_version,
     rubric_version, evidence_pack_version, provider, model, input_hash)
  values (prj, aud, 'v1', 'v1', 'v1', 'v1', 'v4', 'anthropic', 'm', h64) returning id into oset;

  insert into public.business_opportunities
    (opportunity_set_id, rank, title, problem, why_now, impact, effort, confidence, category,
     execution_type, execution_readiness, primary_dimension)
  values (oset, 1, 't', 'p', 'w', 'high', 'low', 'high', 'seo', 'code_change', 'ready', 'product');

  insert into public.action_plans
    (project_id, business_audit_id, opportunity_set_id, opportunity_id, product_profile_id,
     founder_intent_hash, schema_version, contract_version, planner_version, prompt_version,
     rubric_version, evidence_pack_version, provider, model, input_hash)
  values (prj, aud, oset, 'opp-1', prof, 'ih', 'v1', 'v1', 'v1', 'v1', 'v1', 'v4', 'anthropic',
          'm', h64)
  returning id into plan;

  insert into public.action_plan_steps
    (action_plan_id, step_key, step_order, title, description, purpose, actor, change_kind,
     completion_criteria, execution_support, capability)
  values (plan, 'step-1', 1, 't', 'd', 'p', 'vibe', 'product_change', 'c', 'vibe_executes_now',
          'nextjs_seo_foundations_v2');

  insert into public.execution_specs
    (project_id, action_plan_id, step_key, step_order, business_audit_id, opportunity_id,
     spec_identity, mode, risk_class, repository_connection_id, base_sha, repository_snapshot_id,
     spec, schema_version, resolver_version, policy_version, risk_policy_version, execution_class)
  values (prj, plan, 'step-1', 1, aud, 'opp-1', h64, 'agentic', 'low', conn, repeat('a', 40),
          rsnap, '{}'::jsonb, 'v1', 'v1', 'v1', 'v1', 'application_code_change')
  returning id into spec;

  insert into public.operation_runs (project_id, user_id, operation_type, input_identity, status)
  values (prj, u, 'agent_execution', h64, 'running') returning id into orun;

  -- RESTRICT -> execution_specs, edge 1 of 2.
  insert into public.agent_execution_runs
    (project_id, user_id, operation_run_id, execution_spec_id, run_identity, provider, harness,
     model, coding_agent_policy_version, prompt_compiler_version, budget_policy_version,
     execution_policy_version, base_sha, status)
  values (prj, u, orun, spec, h64, 'anthropic', 'claude-code', 'm', 'v1', 'v1', 'v1', 'v1',
          repeat('a', 40), 'needs_user_input')
  returning id into arun;

  -- RESTRICT -> execution_specs, edge 2 of 2. The edge ADR 0056 §5 names.
  insert into public.execution_interrupts
    (project_id, user_id, execution_spec_id, agent_execution_run_id, interrupt_type, question,
     response_schema)
  values (prj, u, spec, arun, 'business_decision_required', 'Which direction?', '{}'::jsonb);

  return query select u, prj, spec;
end;
$$;
