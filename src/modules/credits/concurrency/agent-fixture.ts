import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeOperationCredits } from "../operation-billing";

/**
 * The rows an agent execution needs to exist at all, built for real.
 *
 * `agent_execution_runs.execution_spec_id` is `not null` and references
 * `execution_specs` `on delete restrict`, and that spec's own foreign keys
 * reach eight more tables. None of them is read by the code under test — the
 * finalizer and the expiry backstop touch `agent_execution_runs`,
 * `operation_runs` and the billing tables and nothing else — but PostgreSQL
 * does not care what a test intends to exercise. Against a real database the
 * scaffolding has to be real.
 *
 * Built **once per suite** and shared: it is inert, and rebuilding eleven rows
 * per iteration would spend the run's whole budget on foreign keys. What is
 * rebuilt per iteration is exactly what the race writes.
 *
 * Every literal here is a value the schema's own CHECK constraints accept,
 * taken from the constraints rather than guessed — `execution_capability` from
 * the three the column allows, `branch_name` from the `vibe/%` pattern,
 * `execution_identity` at exactly 64 characters, `source_origin` HTTPS and at
 * least 12 characters.
 */

/** 64 characters, which is what `prepared_changes.execution_identity` requires. */
const IDENTITY_64 = "e2b0000000000000000000000000000000000000000000000000000000000000";

/**
 * A per-iteration identity of exactly 64 characters.
 *
 * `prepared_changes_single_active_idx` is unique on
 * `(project_id, execution_identity)` for any row still `preparing` or
 * `prepared`, and this suite keeps one project for the whole run — so a shared
 * identity would give every iteration after the first a `23505` from the
 * fixture rather than from the race.
 */
function identity64(label: string): string {
  const safe = label.replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  return `e2b-${safe}`.padEnd(64, "0").slice(0, 64);
}
const BASE_SHA = "1f4b0c9d7a2e5f8b3c6d9e0a1b2c3d4e5f607182";

async function insert(
  supabase: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase.from(table).insert(row).select("id").single();
  if (error) throw new Error(`could not seed ${table}: ${error.code ?? "unknown"}`);
  return (data as { id: string }).id;
}

export type AgentScaffolding = {
  projectId: string;
  executionSpecId: string;
  repositorySnapshotId: string;
};

/** The inert chain, from the GitHub installation down to the execution spec. */
export async function createAgentScaffolding(
  supabase: SupabaseClient,
  userId: string,
  label: string,
): Promise<AgentScaffolding> {
  const projectId = await insert(supabase, "projects", {
    user_id: userId,
    name: `e2b ${label}`,
    production_url: "https://example.invalid",
  });

  const installationId = await insert(supabase, "github_installations", {
    user_id: userId,
    // bigint columns, and a run-unique value so two suites never collide.
    installation_id: Math.floor(Math.random() * 1_000_000_000),
    github_account_id: Math.floor(Math.random() * 1_000_000_000),
    github_account_login: "e2b-account",
    account_type: "User",
    repository_selection: "all",
  });

  const connectionId = await insert(supabase, "repository_connections", {
    project_id: projectId,
    github_installation_id: installationId,
    github_repository_id: Math.floor(Math.random() * 1_000_000_000),
    owner: "e2b-account",
    name: "e2b-repo",
    full_name: "e2b-account/e2b-repo",
    default_branch: "main",
    private: true,
    html_url: "https://github.com/e2b-account/e2b-repo",
  });

  const repositorySnapshotId = await insert(supabase, "repository_intelligence_snapshots", {
    project_id: projectId,
    repository_connection_id: connectionId,
    source_commit_sha: BASE_SHA,
    source_branch: "main",
    analyzer_version: "e2b",
    schema_version: "e2b",
  });

  const productProfileId = await insert(supabase, "product_profiles", {
    project_id: projectId,
    schema_version: "e2b",
    builder_version: "e2b",
    evidence_version: "e2b",
    input_hash: IDENTITY_64,
  });

  const liveSnapshotId = await insert(supabase, "live_product_intelligence_snapshots", {
    project_id: projectId,
    source_origin: "https://example.invalid",
    configured_url: "https://example.invalid",
    analyzer_version: "e2b",
    schema_version: "e2b",
  });

  const auditId = await insert(supabase, "business_readiness_audits", {
    project_id: projectId,
    repository_snapshot_id: repositorySnapshotId,
    live_snapshot_id: liveSnapshotId,
    product_profile_id: productProfileId,
    business_context_hash: IDENTITY_64,
    schema_version: "e2b",
    audit_version: "e2b",
    evidence_pack_version: "e2b",
    prompt_version: "e2b",
    rubric_version: "e2b",
    provider: "e2b",
    model: "e2b",
    input_hash: IDENTITY_64,
    access_mode: "credits",
  });

  const opportunitySetId = await insert(supabase, "opportunity_sets", {
    project_id: projectId,
    business_audit_id: auditId,
    schema_version: "e2b",
    engine_version: "e2b",
    prompt_version: "e2b",
    rubric_version: "e2b",
    evidence_pack_version: "e2b",
    provider: "e2b",
    model: "e2b",
    input_hash: IDENTITY_64,
  });

  const actionPlanId = await insert(supabase, "action_plans", {
    project_id: projectId,
    business_audit_id: auditId,
    opportunity_set_id: opportunitySetId,
    opportunity_id: "e2b-move",
    product_profile_id: productProfileId,
    founder_intent_hash: IDENTITY_64,
    schema_version: "e2b",
    contract_version: "e2b",
    planner_version: "e2b",
    prompt_version: "e2b",
    rubric_version: "e2b",
    evidence_pack_version: "e2b",
    provider: "e2b",
    model: "e2b",
    input_hash: IDENTITY_64,
  });

  const executionSpecId = await insert(supabase, "execution_specs", {
    project_id: projectId,
    action_plan_id: actionPlanId,
    step_key: "e2b-step",
    step_order: 1,
    business_audit_id: auditId,
    opportunity_id: "e2b-move",
    spec_identity: IDENTITY_64,
    // `agentic` requires execution_class present and capability absent.
    mode: "agentic",
    execution_class: "application_code_change",
    risk_class: "moderate",
    repository_connection_id: connectionId,
    base_sha: BASE_SHA,
    repository_snapshot_id: repositorySnapshotId,
    spec: { e2b: true },
    schema_version: "e2b",
    resolver_version: "e2b",
    policy_version: "e2b",
    risk_policy_version: "e2b",
  });

  return { projectId, executionSpecId, repositorySnapshotId };
}

export type AgentRunFixture = {
  operationRunId: string;
  agentRunId: string;
  preparedChangeId: string;
  reservationId: string;
};

/**
 * One running agent execution, holding Credits, started long enough ago to be
 * past the staleness deadline.
 *
 * The prepared change exists up front because `completeAgentRun` writes its id
 * and the schema refuses `status = 'succeeded'` without one — the workflow's
 * success path cannot be exercised against a real database otherwise.
 */
export async function createRunningAgentRun(
  supabase: SupabaseClient,
  params: {
    scaffolding: AgentScaffolding;
    userId: string;
    startedAt: string;
    identity: string;
  },
): Promise<AgentRunFixture> {
  const { scaffolding, userId } = params;

  const operationRunId = await insert(supabase, "operation_runs", {
    project_id: scaffolding.projectId,
    user_id: userId,
    operation_type: "agent_execution",
    status: "running",
    // The one value the operation_runs stage CHECK constraint allows for an
    // agent run genuinely in flight — "executing" is not in that list.
    stage: "running_agent",
    input_identity: params.identity,
    subject_id: scaffolding.executionSpecId,
  });

  // The hold is taken through the real authorization path rather than inserted,
  // so the reservation, its allocations and the account cache are whatever
  // production would have produced — the race is then asserted against a hold
  // the ledger genuinely agrees exists.
  const authorized = await authorizeOperationCredits(supabase, {
    projectId: scaffolding.projectId,
    operation: "agent_execution_dogfood",
    idempotencyKey: `e2b:${params.identity}`,
    operationRunId,
  });
  if (!authorized.ok || !authorized.billable) {
    throw new Error("fixture could not reserve Credits for the agent run");
  }

  const preparedChangeId = await insert(supabase, "prepared_changes", {
    project_id: scaffolding.projectId,
    user_id: userId,
    operation_run_id: operationRunId,
    // The one capability that does not additionally require an opportunity.
    execution_capability: "agentic_execution_v1",
    execution_version: "e2b",
    repository_snapshot_id: scaffolding.repositorySnapshotId,
    base_branch: "main",
    base_sha: BASE_SHA,
    branch_name: `vibe/e2b-${params.identity}`,
    commit_sha: BASE_SHA,
    execution_identity: identity64(params.identity),
    status: "prepared",
    completed_at: new Date().toISOString(),
  });

  const agentRunId = await insert(supabase, "agent_execution_runs", {
    project_id: scaffolding.projectId,
    user_id: userId,
    operation_run_id: operationRunId,
    execution_spec_id: scaffolding.executionSpecId,
    run_identity: params.identity,
    provider: "e2b_provider",
    harness: "e2b_harness",
    model: "claude-sonnet-5",
    coding_agent_policy_version: "e2b",
    prompt_compiler_version: "e2b",
    budget_policy_version: "e2b",
    execution_policy_version: "e2b",
    base_sha: BASE_SHA,
    credit_reservation_id: authorized.reservationId,
    status: "running",
    started_at: params.startedAt,
  });

  return { operationRunId, agentRunId, preparedChangeId, reservationId: authorized.reservationId };
}

/** Removes one iteration's rows. The scaffolding outlives them. */
export async function deleteAgentRun(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<void> {
  // `agent_execution_runs` and `prepared_changes` both cascade from the
  // operation, so one delete is the whole iteration.
  const { error } = await supabase.from("operation_runs").delete().eq("id", operationRunId);
  if (error) throw error;
}
