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
 *
 * The `.` before the zero-padding is load-bearing, not decoration: without a
 * delimiter outside the label's own alphabet, `"start-1"` and `"start-10"`
 * zero-pad to the *same* 64 characters — the digit `"0"` that continues one
 * label is indistinguishable from the padding that finishes the other. A
 * defect-B regression this sprint found exactly that collision between
 * iterations 1 and 10, surfaced as a real `23505` because that fixture's rows
 * are never deleted between iterations. `.` cannot appear in `safe` (the
 * sanitizer excludes it) and padding can never produce it, so its position
 * unambiguously marks where the real label ends.
 */
function identity64(label: string): string {
  const safe = label.replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  return `e2b-${safe}.`.padEnd(64, "0").slice(0, 64);
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
  actionPlanId: string;
  businessAuditId: string;
  repositoryConnectionId: string;
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
    /*
     * `pricingClass` is load-bearing, not decoration.
     *
     * `startAgentExecution` reads it off the stored spec and refuses with
     * `agentic_execution_not_authorized` when it is absent — the class the
     * customer was quoted decides both the retail price and the budget
     * ceiling, and guessing one is unsafe in both directions (ADR 0061).
     * This blob predates that and said only `{ e2b: true }`, so every start
     * in this suite refused before reaching the branch it exists to prove.
     *
     * `standard` keeps the arithmetic exact: this project is on the dogfood
     * allowlist, `CORE4_DOGFOOD_BUDGET_POLICY` is uniform across all three
     * classes, and `HOLD` is derived from the same internal price — so the
     * hold stays 100 Credits whichever class is named.
     */
    spec: { e2b: true, pricingClass: "standard", pricingClassReason: "single_surface" },
    schema_version: "e2b",
    resolver_version: "e2b",
    policy_version: "e2b",
    risk_policy_version: "e2b",
  });

  return {
    projectId,
    executionSpecId,
    repositorySnapshotId,
    actionPlanId,
    businessAuditId: auditId,
    repositoryConnectionId: connectionId,
  };
}

/**
 * One more execution spec on the same action plan, for a caller that needs a
 * fresh `run_identity` each attempt rather than the shared one `scaffolding`
 * already carries.
 *
 * `execution_specs_identity_idx` is unique on `(project_id, spec_identity)`
 * unconditionally — unlike the run-identity and input-identity indexes above
 * it, this one is not scoped to a status, so no two calls may share a label.
 */
export async function createIterationExecutionSpec(
  supabase: SupabaseClient,
  scaffolding: AgentScaffolding,
  label: string,
): Promise<string> {
  return insert(supabase, "execution_specs", {
    project_id: scaffolding.projectId,
    action_plan_id: scaffolding.actionPlanId,
    step_key: `e2b-step-${label}`,
    step_order: 1,
    business_audit_id: scaffolding.businessAuditId,
    opportunity_id: "e2b-move",
    spec_identity: identity64(label),
    mode: "agentic",
    execution_class: "application_code_change",
    risk_class: "moderate",
    repository_connection_id: scaffolding.repositoryConnectionId,
    base_sha: BASE_SHA,
    repository_snapshot_id: scaffolding.repositorySnapshotId,
    // Same reason as `createAgentScaffolding`'s spec above: without a
    // pricing class `startAgentExecution` refuses before it can be tested.
    spec: { e2b: true, pricingClass: "standard", pricingClassReason: "single_surface" },
    schema_version: "e2b",
    resolver_version: "e2b",
    policy_version: "e2b",
    risk_policy_version: "e2b",
  });
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
    // operation_runs.input_identity carries the same "exactly 64 characters"
    // CHECK as prepared_changes.execution_identity — the constraint this
    // fixture's own CI run first missed here and only padded on the other
    // table.
    input_identity: identity64(params.identity),
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
    // agent_execution_runs.run_identity carries the same "exactly 64
    // characters" CHECK as the other two identity columns above.
    run_identity: identity64(params.identity),
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

/**
 * Why the scaffolding — and the auth user underneath it — is never deleted.
 *
 * A first version of this file tried to delete the ten scaffolding rows in
 * FK-dependency order before the shared teardown's `deleteUser` call. It got
 * as far as `execution_specs` and stopped there permanently:
 *
 * ```
 * Error: could not delete execution_specs: 23001
 * ```
 *
 * `23001` is `restrict_violation`, and the source is not a foreign key —
 * `20260818131106_execution_specs.sql` puts a `BEFORE UPDATE OR DELETE`
 * trigger on the table that unconditionally raises that code, for every
 * caller including the service role: "execution_specs rows are immutable.
 * Re-resolve the step and insert a new spec instead." The comment above the
 * trigger in that migration explains why — it is enforced in the database
 * *because* "nothing updates this table" is a claim about every future line
 * of code, and a trigger is a claim about the table, not a convention someone
 * could forget.
 *
 * That trigger fires identically on a cascaded delete — `ON DELETE CASCADE`
 * still issues a real `DELETE` on the child row, which still fires `BEFORE
 * DELETE`. So `execution_specs.project_id → projects ON DELETE CASCADE` means
 * deleting the *project* fails too, and `projects.user_id → auth.users ON
 * DELETE CASCADE` means deleting the *user* fails the same way. A project
 * that has ever had one execution spec is permanently rooted in this
 * database, by design, and so is the user that created it.
 *
 * [2026-08-26] VB-001 M1 narrowed that trigger: a delete is now permitted when
 * the row's project is already gone *and* the lifecycle marker is set, which
 * only `erase_project_lifecycle()` arranges. Nothing here changes — this suite
 * holds no such marker, so every sentence above still describes what it gets —
 * but "permanently rooted" is now "rooted outside lifecycle context".
 *
 * This is not a gap to work around. The disposable database itself is the
 * cleanup — `supabase stop --no-backup` deletes the whole stack's volumes at
 * the end of the job — exactly the same reasoning ADR 0040 already gives for
 * the gate as a whole. So this suite's shared user, project and scaffolding
 * are created once and simply left; only the genuinely ephemeral rows each
 * iteration writes (`deleteAgentRun`, below) are cleaned up as the suite runs,
 * because those are what would otherwise collide across iterations.
 */
