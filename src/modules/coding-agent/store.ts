import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExecutionActivityEvent,
  ExecutionActivityRecord,
  ExecutionInterruptAnswer,
  ExecutionInterruptResponseSchema,
  ExecutionInterruptStatus,
  ExecutionInterruptType,
} from "@/modules/execution-contract/schema";
import { isValidInterruptAnswer } from "@/modules/execution-contract/interrupts";
import type { AgentToolEvent, RaisedInterrupt } from "./gateway";
import type { AgentFailureCode, AgentRunStatus } from "./schema";
import type { FreshnessState } from "@/modules/execution-context/brief";
import type { VerificationMode } from "@/modules/execution-context/verification";

/**
 * Persistence for agentic execution (EXECUTION CORE-4 §22, §23, §24, §25).
 *
 * ## What is stored, and what could not be even by mistake
 *
 * Counts, versions, enums, normalized paths and Vibe-constructed command
 * strings. There is no column here that a prompt, a model response, a reasoning
 * trace, a source file or a credential could occupy — which is how §24 and
 * Rule 43 are enforced rather than merely intended.
 *
 * ## Server-only, service-role, ownership from the row
 *
 * Every write here happens inside a durable step, which has no user session, so
 * it uses the service-role client and bypasses RLS. Rule 53 therefore applies
 * in full: every query filters on ownership taken from the persisted operation
 * row, never from anything a caller supplied. The `projectId` arguments below
 * are read off the operation, not off a request.
 */

/* ---------------------------------------------------------------------------
 * agent_execution_runs
 * ------------------------------------------------------------------------ */

export type StoredAgentExecutionRun = {
  id: string;
  projectId: string;
  userId: string;
  operationRunId: string;
  executionSpecId: string;
  runIdentity: string;
  provider: string;
  harness: string;
  model: string;
  codingAgentPolicyVersion: string;
  promptCompilerVersion: string;
  budgetPolicyVersion: string;
  executionPolicyVersion: string;
  nonProductionEconomics: boolean;
  baseSha: string;
  creditReservationId: string | null;
  status: AgentRunStatus;
  failureCode: AgentFailureCode | null;
  /** Model responses. Never comparable to the budget's turn ceiling. */
  assistantMessages: number;
  /** The harness's own loop count, in the ceiling's unit. Null if unreported. */
  sdkLoopIterations: number | null;
  toolCallsAllowed: number;
  toolCallsDenied: number;
  filesRead: number;
  checkRuns: number;
  repairAttempts: number;
  /** Paths Vibe observed as touched, before comparison against the base. */
  observedPathCount: number;
  /** Files in the verified candidate. Never what the runtime touched. */
  changedFileCount: number;
  changedBytes: number;
  durationMs: number | null;
  providerSessionId: string | null;

  /*
   * The Execution Brief this run was given, and what it read (PART L).
   *
   * Null throughout means the run had no brief — no snapshot to compile from,
   * or one taken at a different commit. `contextFreshness` distinguishes the
   * two cases that matter: `stale`/`unknown` say Vibe *had* intelligence and
   * withheld it, which is a reason to re-analyse; null says there was none.
   */
  contextBriefVersion: string | null;
  contextFreshness: FreshnessState | null;
  contextBytes: number | null;
  contextFactsSent: number | null;
  contextCandidatesSent: number | null;
  /**
   * How large the repository the brief was selected *from* was (Sprint 0053).
   *
   * `contextCandidatesSent` saturates at `BRIEF_BUDGET.maxCandidates`, so it
   * cannot separate a repository with twelve relevant files from one with
   * fifty. These do. Null means no fresh snapshot described this run's commit —
   * never zero, which would claim an empty repository.
   */
  contextCandidatesAvailable: number | null;
  repoTreeEntries: number | null;
  repoFilesAnalyzed: number | null;
  repoBytesAnalyzed: number | null;
  repoRoutesDetected: number | null;
  repoSurfacesDetected: number | null;
  contextCandidatesRead: number | null;
  uniqueFilesRead: number | null;
  repeatedFileReads: number | null;
  filesReadOutsideContext: number | null;

  /**
   * How much self-checking this run was allowed, and what it spent.
   *
   * Advisory throughout. `verificationMode` never authorized anything: a run
   * whose every permitted check passed has proved only that the agent found no
   * mistake it could see, and independent validation decides the rest.
   */
  verificationMode: VerificationMode | null;
  verificationPlanVersion: string | null;
  verificationCommands: number | null;
  verificationRefusals: number | null;
  verificationMs: number | null;
  /** Offset of the first observed write. Where implementation actually began. */
  timeToFirstEditMs: number | null;
  /** Offset of the last observed write. The closest observable thing to "done". */
  timeToLastEditMs: number | null;

  /** Where time and money went after the code was written. Null without a budget. */
  completionBudgetVersion: string | null;
  postEditToolCalls: number | null;
  postEditReads: number | null;
  postEditReadsBeyondBrief: number | null;
  postEditCommands: number | null;
  postEditProviderCalls: number | null;
  postEditProviderCostUsd: number | null;
  completionRefusals: number | null;
  /** Mutations that answered an observed failure. A real repair. */
  repairCycles: number | null;
  /** Files written while implementing. Breadth, never charged (Sprint 0044). */
  implementationMutations: number | null;
  /** Files written after the run converged. Each one cost a window. */
  convergenceMutations: number | null;
  /** Required verification operations the runtime allowed. */
  requiredVerificationActions: number | null;
  /** Of those, the ones a completion budget alone would have refused. */
  requiredVerificationOverrides: number | null;
  /** Tool calls the policy hook saw. Zero beside tool calls means it never ran. */
  policyDecisions: number | null;

  /** `planner` for a customer execution, `dogfood_fixture` for an internal benchmark. */
  executionOrigin: string;
  dogfoodFixtureId: string | null;

  preparedChangeId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type RunRow = {
  id: string;
  project_id: string;
  user_id: string;
  operation_run_id: string;
  execution_spec_id: string;
  run_identity: string;
  provider: string;
  harness: string;
  model: string;
  coding_agent_policy_version: string;
  prompt_compiler_version: string;
  budget_policy_version: string;
  execution_policy_version: string;
  non_production_economics: boolean;
  base_sha: string;
  credit_reservation_id: string | null;
  status: AgentRunStatus;
  failure_code: AgentFailureCode | null;
  assistant_messages: number;
  sdk_loop_iterations: number | null;
  tool_calls_allowed: number;
  tool_calls_denied: number;
  files_read: number;
  check_runs: number;
  repair_attempts: number;
  observed_path_count: number;
  changed_file_count: number;
  changed_bytes: number;
  duration_ms: number | null;
  provider_session_id: string | null;
  context_brief_version: string | null;
  context_freshness: FreshnessState | null;
  context_bytes: number | null;
  context_facts_sent: number | null;
  context_candidates_sent: number | null;
  context_candidates_available: number | null;
  repo_tree_entries: number | null;
  repo_files_analyzed: number | null;
  repo_bytes_analyzed: number | null;
  repo_routes_detected: number | null;
  repo_surfaces_detected: number | null;
  context_candidates_read: number | null;
  unique_files_read: number | null;
  repeated_file_reads: number | null;
  files_read_outside_context: number | null;
  verification_mode: VerificationMode | null;
  verification_plan_version: string | null;
  verification_commands: number | null;
  verification_refusals: number | null;
  verification_ms: number | null;
  time_to_first_edit_ms: number | null;
  time_to_last_edit_ms: number | null;
  completion_budget_version: string | null;
  post_edit_tool_calls: number | null;
  post_edit_reads: number | null;
  post_edit_reads_beyond_brief: number | null;
  post_edit_commands: number | null;
  post_edit_provider_calls: number | null;
  post_edit_provider_cost_usd: string | number | null;
  completion_refusals: number | null;
  repair_cycles: number | null;
  implementation_mutations: number | null;
  convergence_mutations: number | null;
  required_verification_actions: number | null;
  required_verification_overrides: number | null;
  policy_decisions: number | null;
  execution_origin: string;
  dogfood_fixture_id: string | null;
  prepared_change_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

const RUN_COLUMNS =
  "id, project_id, user_id, operation_run_id, execution_spec_id, run_identity, provider, harness, " +
  "model, coding_agent_policy_version, prompt_compiler_version, budget_policy_version, " +
  "execution_policy_version, non_production_economics, base_sha, credit_reservation_id, status, " +
  "failure_code, assistant_messages, sdk_loop_iterations, tool_calls_allowed, tool_calls_denied, files_read, check_runs, " +
  "repair_attempts, observed_path_count, changed_file_count, changed_bytes, duration_ms, provider_session_id, " +
  "context_brief_version, context_freshness, context_bytes, context_facts_sent, context_candidates_sent, " +
  "context_candidates_available, repo_tree_entries, repo_files_analyzed, repo_bytes_analyzed, " +
  "repo_routes_detected, repo_surfaces_detected, " +
  "context_candidates_read, unique_files_read, repeated_file_reads, files_read_outside_context, " +
  "verification_mode, verification_plan_version, verification_commands, verification_refusals, " +
  "verification_ms, time_to_first_edit_ms, time_to_last_edit_ms, " +
  "completion_budget_version, post_edit_tool_calls, post_edit_reads, post_edit_reads_beyond_brief, " +
  "post_edit_commands, post_edit_provider_calls, post_edit_provider_cost_usd, completion_refusals, " +
  "repair_cycles, implementation_mutations, convergence_mutations, " +
  "required_verification_actions, required_verification_overrides, policy_decisions, " +
  "execution_origin, dogfood_fixture_id, " +
  "prepared_change_id, created_at, started_at, completed_at";

function mapRun(row: RunRow): StoredAgentExecutionRun {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    operationRunId: row.operation_run_id,
    executionSpecId: row.execution_spec_id,
    runIdentity: row.run_identity,
    provider: row.provider,
    harness: row.harness,
    model: row.model,
    codingAgentPolicyVersion: row.coding_agent_policy_version,
    promptCompilerVersion: row.prompt_compiler_version,
    budgetPolicyVersion: row.budget_policy_version,
    executionPolicyVersion: row.execution_policy_version,
    nonProductionEconomics: row.non_production_economics,
    baseSha: row.base_sha,
    creditReservationId: row.credit_reservation_id,
    status: row.status,
    failureCode: row.failure_code,
    assistantMessages: row.assistant_messages,
    sdkLoopIterations: row.sdk_loop_iterations,
    toolCallsAllowed: row.tool_calls_allowed,
    toolCallsDenied: row.tool_calls_denied,
    filesRead: row.files_read,
    checkRuns: row.check_runs,
    repairAttempts: row.repair_attempts,
    observedPathCount: row.observed_path_count,
    changedFileCount: row.changed_file_count,
    changedBytes: row.changed_bytes,
    durationMs: row.duration_ms,
    providerSessionId: row.provider_session_id,
    contextBriefVersion: row.context_brief_version,
    contextFreshness: row.context_freshness,
    contextBytes: row.context_bytes,
    contextFactsSent: row.context_facts_sent,
    contextCandidatesSent: row.context_candidates_sent,
    contextCandidatesAvailable: row.context_candidates_available,
    repoTreeEntries: row.repo_tree_entries,
    repoFilesAnalyzed: row.repo_files_analyzed,
    repoBytesAnalyzed: row.repo_bytes_analyzed,
    repoRoutesDetected: row.repo_routes_detected,
    repoSurfacesDetected: row.repo_surfaces_detected,
    contextCandidatesRead: row.context_candidates_read,
    uniqueFilesRead: row.unique_files_read,
    repeatedFileReads: row.repeated_file_reads,
    filesReadOutsideContext: row.files_read_outside_context,
    verificationMode: row.verification_mode,
    verificationPlanVersion: row.verification_plan_version,
    verificationCommands: row.verification_commands,
    verificationRefusals: row.verification_refusals,
    verificationMs: row.verification_ms,
    timeToFirstEditMs: row.time_to_first_edit_ms,
    timeToLastEditMs: row.time_to_last_edit_ms,
    completionBudgetVersion: row.completion_budget_version,
    postEditToolCalls: row.post_edit_tool_calls,
    postEditReads: row.post_edit_reads,
    postEditReadsBeyondBrief: row.post_edit_reads_beyond_brief,
    postEditCommands: row.post_edit_commands,
    postEditProviderCalls: row.post_edit_provider_calls,
    postEditProviderCostUsd:
      row.post_edit_provider_cost_usd === null ? null : Number(row.post_edit_provider_cost_usd),
    completionRefusals: row.completion_refusals,
    repairCycles: row.repair_cycles,
    implementationMutations: row.implementation_mutations,
    convergenceMutations: row.convergence_mutations,
    requiredVerificationActions: row.required_verification_actions,
    requiredVerificationOverrides: row.required_verification_overrides,
    policyDecisions: row.policy_decisions,
    executionOrigin: row.execution_origin,
    dogfoodFixtureId: row.dogfood_fixture_id,
    preparedChangeId: row.prepared_change_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

export type ClaimAgentRunResult =
  | { ok: true; run: StoredAgentExecutionRun; alreadyExisted: boolean }
  | { ok: false; error: "already_active" }
  | { ok: false; error: "unknown"; message: string };

/**
 * Claims one agent execution before any provider call (§56).
 *
 * Claiming first is what makes the paid call idempotent: the row exists before
 * the agent runs, so a re-entry finds it and decides whether continuing is safe
 * rather than buying a second coding agent. The unique index does the deciding
 * — an application check cannot, because two clicks 20 ms apart both pass one.
 */
export async function claimAgentExecutionRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    operationRunId: string;
    executionSpecId: string;
    runIdentity: string;
    provider: string;
    harness: string;
    model: string;
    codingAgentPolicyVersion: string;
    promptCompilerVersion: string;
    budgetPolicyVersion: string;
    executionPolicyVersion: string;
    nonProductionEconomics: boolean;
    baseSha: string;
    creditReservationId: string | null;
    /**
     * Where this execution's step came from.
     *
     * Derived from the persisted spec by the caller, never supplied by a
     * browser or a fixture — a benchmark must be *visible* as one, so it cannot
     * be the thing that decides whether it is labelled as one.
     */
    executionOrigin: "planner" | "dogfood_fixture";
    /** The fixture id, when the origin is a benchmark. Null otherwise. */
    dogfoodFixtureId: string | null;
  },
): Promise<ClaimAgentRunResult> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      operation_run_id: params.operationRunId,
      execution_spec_id: params.executionSpecId,
      run_identity: params.runIdentity,
      provider: params.provider,
      harness: params.harness,
      model: params.model,
      coding_agent_policy_version: params.codingAgentPolicyVersion,
      prompt_compiler_version: params.promptCompilerVersion,
      budget_policy_version: params.budgetPolicyVersion,
      execution_policy_version: params.executionPolicyVersion,
      non_production_economics: params.nonProductionEconomics,
      base_sha: params.baseSha,
      credit_reservation_id: params.creditReservationId,
      execution_origin: params.executionOrigin,
      dogfood_fixture_id: params.dogfoodFixtureId,
      status: "queued",
    })
    .select(RUN_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_active" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, run: mapRun(data as unknown as RunRow), alreadyExisted: false };
}

export async function findAgentRunByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<StoredAgentExecutionRun | null> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .select(RUN_COLUMNS)
    .eq("operation_run_id", operationRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRun(data as unknown as RunRow) : null;
}

export async function findActiveAgentRunByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; runIdentity: string },
): Promise<StoredAgentExecutionRun | null> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .select(RUN_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("run_identity", params.runIdentity)
    .in("status", ["queued", "running", "needs_user_input", "succeeded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRun(data as unknown as RunRow) : null;
}

/**
 * Marks a run as having entered the paid loop.
 *
 * Scoped to `queued`, so it reports whether *this* call performed the
 * transition. That is the hinge of §37: a step that re-enters and finds the run
 * already `running` knows the provider may already have been billed, and
 * refuses to run a second agent rather than resolving the ambiguity in favour
 * of doing more work.
 */
export async function markAgentRunStarted(
  supabase: SupabaseClient,
  runId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Records the model responses observed so far, mid-run.
 *
 * Separate from `recordAgentRunObservations` because the two answer different
 * questions. That one writes the whole picture once the harness has stopped;
 * this one writes the single number that must survive the harness *not*
 * stopping.
 *
 * The first real run made that concrete: it reached Anthropic 27 times over
 * five minutes and the run row still read zero, because the step was
 * killed before the final write. A turn that happened is a fact about what a
 * customer was charged for, and it must not depend on a later step succeeding.
 *
 * Monotonic by construction — the count only ever climbs, so a poll that races
 * a stale read cannot walk it backwards.
 *
 * Writes `assistant_messages` and nothing else. `sdk_loop_iterations` has no
 * mid-run value: the harness reports it once, in its terminal message, and
 * filling the column with the message count in the meantime is precisely the
 * unit switch this rename exists to end.
 */
export async function recordAgentMessageProgress(
  supabase: SupabaseClient,
  runId: string,
  assistantMessages: number,
): Promise<void> {
  if (assistantMessages <= 0) return;

  const { error } = await supabase
    .from("agent_execution_runs")
    .update({ assistant_messages: assistantMessages })
    .eq("id", runId)
    .lt("assistant_messages", assistantMessages);

  if (error) throw error;
}

/**
 * What was observed about a run, in parts.
 *
 * Every field optional, because the observations are produced at different
 * moments by different durable steps and neither may clobber the other. The
 * tool trail exists when the harness is started; the message count, the change set and
 * the duration only exist when it has stopped — minutes and several function
 * invocations later (ADR 0029, A1).
 *
 * A writer that took the whole record would force each step to invent values
 * for the half it cannot know, and "zero" is not the same as "not yet".
 */
export type AgentRunObservations = {
  assistantMessages?: number;
  sdkLoopIterations?: number | null;
  toolCallsAllowed?: number;
  toolCallsDenied?: number;
  filesRead?: number;
  checkRuns?: number;
  repairAttempts?: number;
  observedPathCount?: number;
  changedFileCount?: number;
  changedBytes?: number;
  durationMs?: number;
  providerSessionId?: string | null;

  /*
   * What the run was told before it started, and what it read afterwards
   * (EXECUTION CONTEXT INTELLIGENCE, PART L).
   *
   * All optional and all nullable, because a brief is an optimisation that may
   * legitimately be absent. Null means "this run had no brief"; zero would
   * claim it had one that offered nothing.
   */
  contextBriefVersion?: string | null;
  contextFreshness?: FreshnessState | null;
  contextBytes?: number;
  contextFactsSent?: number;
  contextCandidatesSent?: number;
  contextCandidatesRead?: number;

  /*
   * How large the repository being compressed was (Sprint 0053).
   *
   * Separate from the context_* fields above on purpose: those measure what
   * Vibe *sent*, and this measures what it was selecting *from*. Run #9 cost
   * 2.16× what the same step cost in run #6 with no task change at all, and no
   * stored number could express why. Nullable throughout — a run without a
   * fresh snapshot has no size at its own commit, and null says so where zero
   * would claim an empty repository.
   */
  contextCandidatesAvailable?: number | null;
  repoTreeEntries?: number | null;
  repoFilesAnalyzed?: number | null;
  repoBytesAnalyzed?: number | null;
  repoRoutesDetected?: number | null;
  repoSurfacesDetected?: number | null;
  uniqueFilesRead?: number;
  repeatedFileReads?: number;
  filesReadOutsideContext?: number;

  /*
   * How much the run was allowed to check its own work, and what that cost
   * (Sprint 0042).
   *
   * Nullable throughout for the same reason the context columns are: a run may
   * legitimately have no plan, and null says so where zero would claim it had
   * one that permitted nothing.
   */
  verificationMode?: VerificationMode | null;
  verificationPlanVersion?: string | null;
  verificationCommands?: number;
  verificationRefusals?: number;
  verificationMs?: number | null;
  timeToFirstEditMs?: number | null;
  timeToLastEditMs?: number | null;

  /*
   * Where the run's time and money went after the code was written
   * (Sprint 0043). All nullable: a run with no completion budget, or one whose
   * boundary could not be established, records null rather than a zero that
   * would read as "nothing happened after the edit".
   */
  completionBudgetVersion?: string | null;
  postEditToolCalls?: number;
  postEditReads?: number;
  postEditReadsBeyondBrief?: number;
  postEditCommands?: number;
  postEditProviderCalls?: number;
  postEditProviderCostUsd?: number | null;
  completionRefusals?: number;
  repairCycles?: number;
  implementationMutations?: number;
  convergenceMutations?: number;
  requiredVerificationActions?: number;
  requiredVerificationOverrides?: number;
  policyDecisions?: number | null;
  contextSurfaceScopes?: string[] | null;
  contextSurfacePages?: number | null;
};

/** Records what Vibe observed, without deciding the run's fate. */
export async function recordAgentRunObservations(
  supabase: SupabaseClient,
  runId: string,
  observations: AgentRunObservations,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) patch[column] = value;
  };

  set("assistant_messages", observations.assistantMessages);
  set("sdk_loop_iterations", observations.sdkLoopIterations);
  set("tool_calls_allowed", observations.toolCallsAllowed);
  set("tool_calls_denied", observations.toolCallsDenied);
  set("files_read", observations.filesRead);
  set("check_runs", observations.checkRuns);
  set("repair_attempts", observations.repairAttempts);
  set("observed_path_count", observations.observedPathCount);
  set("changed_file_count", observations.changedFileCount);
  set("changed_bytes", observations.changedBytes);
  set("duration_ms", observations.durationMs);
  set("provider_session_id", observations.providerSessionId);
  set("context_brief_version", observations.contextBriefVersion);
  set("context_freshness", observations.contextFreshness);
  set("context_bytes", observations.contextBytes);
  set("context_facts_sent", observations.contextFactsSent);
  set("context_candidates_sent", observations.contextCandidatesSent);
  set("context_candidates_read", observations.contextCandidatesRead);
  set("context_candidates_available", observations.contextCandidatesAvailable);
  set("repo_tree_entries", observations.repoTreeEntries);
  set("repo_files_analyzed", observations.repoFilesAnalyzed);
  set("repo_bytes_analyzed", observations.repoBytesAnalyzed);
  set("repo_routes_detected", observations.repoRoutesDetected);
  set("repo_surfaces_detected", observations.repoSurfacesDetected);
  set("unique_files_read", observations.uniqueFilesRead);
  set("repeated_file_reads", observations.repeatedFileReads);
  set("files_read_outside_context", observations.filesReadOutsideContext);
  set("verification_mode", observations.verificationMode);
  set("verification_plan_version", observations.verificationPlanVersion);
  set("verification_commands", observations.verificationCommands);
  set("verification_refusals", observations.verificationRefusals);
  set("verification_ms", observations.verificationMs);
  set("time_to_first_edit_ms", observations.timeToFirstEditMs);
  set("time_to_last_edit_ms", observations.timeToLastEditMs);
  set("completion_budget_version", observations.completionBudgetVersion);
  set("post_edit_tool_calls", observations.postEditToolCalls);
  set("post_edit_reads", observations.postEditReads);
  set("post_edit_reads_beyond_brief", observations.postEditReadsBeyondBrief);
  set("post_edit_commands", observations.postEditCommands);
  set("post_edit_provider_calls", observations.postEditProviderCalls);
  set("post_edit_provider_cost_usd", observations.postEditProviderCostUsd);
  set("completion_refusals", observations.completionRefusals);
  set("repair_cycles", observations.repairCycles);
  set("implementation_mutations", observations.implementationMutations);
  set("convergence_mutations", observations.convergenceMutations);
  set("required_verification_actions", observations.requiredVerificationActions);
  set("required_verification_overrides", observations.requiredVerificationOverrides);
  set("policy_decisions", observations.policyDecisions);
  set("context_surface_scopes", observations.contextSurfaceScopes);
  set("context_surface_pages", observations.contextSurfacePages);

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("agent_execution_runs").update(patch).eq("id", runId);

  if (error) throw error;
}

/**
 * Terminal transitions report whether *this* call performed them.
 *
 * `false` means the run was already terminal — the signal a replayed step needs
 * in order to skip emitting a second completion event, and the reason a retried
 * settlement charges once.
 */
export async function completeAgentRun(
  supabase: SupabaseClient,
  params: { runId: string; preparedChangeId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .update({
      status: "succeeded",
      prepared_change_id: params.preparedChangeId,
      failure_code: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.runId)
    .in("status", ["queued", "running", "needs_user_input"])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function failAgentRun(
  supabase: SupabaseClient,
  params: { runId: string; failureCode: AgentFailureCode },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .update({
      status: "failed",
      failure_code: params.failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.runId)
    .in("status", ["queued", "running", "needs_user_input"])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function pauseAgentRunForUser(
  supabase: SupabaseClient,
  runId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .update({ status: "needs_user_input" })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function cancelAgentRun(supabase: SupabaseClient, runId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_execution_runs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running", "needs_user_input"])
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/* ---------------------------------------------------------------------------
 * agent_tool_events / agent_activity_events (§23, §24)
 * ------------------------------------------------------------------------ */

/**
 * Writes the tool trail, idempotently.
 *
 * `upsert` on `(run, sequence)` rather than `insert`, because this runs at the
 * end of a durable step that can be re-entered: a replay must not double every
 * row, and the sequence number already identifies each event uniquely within
 * its run.
 */
export async function recordAgentToolEvents(
  supabase: SupabaseClient,
  params: { runId: string; projectId: string; events: readonly AgentToolEvent[] },
): Promise<void> {
  if (params.events.length === 0) return;

  const { error } = await supabase.from("agent_tool_events").upsert(
    params.events.map((event) => ({
      agent_execution_run_id: params.runId,
      project_id: params.projectId,
      sequence: event.sequence,
      tool: event.tool,
      capability: event.capability,
      decision: event.decision,
      denial_reason: event.denialReason,
      path: event.path,
      command: event.command,
      started_at: event.startedAt,
      duration_ms: event.durationMs,
      success: event.success,
      exit_code: event.exitCode,
      bytes: event.bytes,
    })),
    { onConflict: "agent_execution_run_id,sequence" },
  );

  if (error) throw error;
}

export async function recordAgentActivity(
  supabase: SupabaseClient,
  params: { runId: string; projectId: string; records: readonly ExecutionActivityRecord[] },
): Promise<void> {
  if (params.records.length === 0) return;

  const { error } = await supabase.from("agent_activity_events").upsert(
    params.records.map((record, index) => ({
      agent_execution_run_id: params.runId,
      project_id: params.projectId,
      sequence: index + 1,
      event: record.event,
      occurred_at: record.at,
      files_read: record.filesRead ?? null,
      changed_paths: record.changedPaths ? [...record.changedPaths] : null,
      command: record.command ?? null,
    })),
    { onConflict: "agent_execution_run_id,sequence" },
  );

  if (error) throw error;
}

export type StoredAgentActivity = {
  event: ExecutionActivityEvent;
  occurredAt: string;
  filesRead: number | null;
  changedPaths: readonly string[] | null;
  command: string | null;
};

export async function listAgentActivity(
  supabase: SupabaseClient,
  params: { runId: string; projectId: string },
): Promise<StoredAgentActivity[]> {
  const { data, error } = await supabase
    .from("agent_activity_events")
    .select("event, occurred_at, files_read, changed_paths, command")
    .eq("agent_execution_run_id", params.runId)
    .eq("project_id", params.projectId)
    .order("sequence", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as {
    event: ExecutionActivityEvent;
    occurred_at: string;
    files_read: number | null;
    changed_paths: string[] | null;
    command: string | null;
  }[]).map((row) => ({
    event: row.event,
    occurredAt: row.occurred_at,
    filesRead: row.files_read,
    changedPaths: row.changed_paths,
    command: row.command,
  }));
}

/* ---------------------------------------------------------------------------
 * execution_interrupts (§25, §49)
 * ------------------------------------------------------------------------ */

export type StoredExecutionInterrupt = {
  id: string;
  projectId: string;
  userId: string;
  executionSpecId: string;
  agentExecutionRunId: string;
  type: ExecutionInterruptType;
  question: string;
  responseSchema: ExecutionInterruptResponseSchema;
  status: ExecutionInterruptStatus;
  answer: ExecutionInterruptAnswer | null;
  createdAt: string;
  answeredAt: string | null;
};

type InterruptRow = {
  id: string;
  project_id: string;
  user_id: string;
  execution_spec_id: string;
  agent_execution_run_id: string;
  interrupt_type: ExecutionInterruptType;
  question: string;
  response_schema: ExecutionInterruptResponseSchema;
  status: ExecutionInterruptStatus;
  answer: ExecutionInterruptAnswer | null;
  created_at: string;
  answered_at: string | null;
};

const INTERRUPT_COLUMNS =
  "id, project_id, user_id, execution_spec_id, agent_execution_run_id, interrupt_type, question, " +
  "response_schema, status, answer, created_at, answered_at";

function mapInterrupt(row: InterruptRow): StoredExecutionInterrupt {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    executionSpecId: row.execution_spec_id,
    agentExecutionRunId: row.agent_execution_run_id,
    type: row.interrupt_type,
    question: row.question,
    responseSchema: row.response_schema,
    status: row.status,
    answer: row.answer,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

/**
 * Persists one raised question, or returns the one already open (§25).
 *
 * The partial unique index makes "one open question per run" a database fact.
 * A run that could accumulate questions would be a chat, which CORE-3 §21
 * explicitly refuses.
 */
export async function raiseExecutionInterrupt(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    executionSpecId: string;
    agentExecutionRunId: string;
    interrupt: RaisedInterrupt;
  },
): Promise<StoredExecutionInterrupt | null> {
  const { data, error } = await supabase
    .from("execution_interrupts")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      execution_spec_id: params.executionSpecId,
      agent_execution_run_id: params.agentExecutionRunId,
      interrupt_type: params.interrupt.type,
      question: params.interrupt.question,
      response_schema: params.interrupt.responseSchema,
      status: "open",
    })
    .select(INTERRUPT_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return findOpenInterruptForRun(supabase, {
        projectId: params.projectId,
        agentExecutionRunId: params.agentExecutionRunId,
      });
    }
    throw error;
  }

  return mapInterrupt(data as unknown as InterruptRow);
}

export async function findOpenInterruptForRun(
  supabase: SupabaseClient,
  params: { projectId: string; agentExecutionRunId: string },
): Promise<StoredExecutionInterrupt | null> {
  const { data, error } = await supabase
    .from("execution_interrupts")
    .select(INTERRUPT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("agent_execution_run_id", params.agentExecutionRunId)
    .eq("status", "open")
    .maybeSingle();

  if (error) throw error;
  return data ? mapInterrupt(data as unknown as InterruptRow) : null;
}

export type AnswerInterruptResult =
  | { ok: true; interrupt: StoredExecutionInterrupt; alreadyAnswered: boolean }
  | { ok: false; reason: "not_found" | "invalid_answer" | "not_open" };

/**
 * Records one structured answer (§49).
 *
 * ## The three checks, and why each is here rather than in a route
 *
 * **Ownership** is the query. The interrupt is looked up by project *and* by
 * the caller's user id, so another user's question is invisible rather than
 * forbidden — a browser cannot answer an interrupt it cannot see, which is what
 * §49's "no client may forge another user's interrupt answer" asks for.
 *
 * **Shape** is `isValidInterruptAnswer`, the Core-3 contract, applied to the
 * stored schema rather than to whatever the client says the schema was.
 *
 * **Status** is the `eq("status", "open")` on the update. A double submission
 * updates nothing the second time and reports `alreadyAnswered`, so an answer
 * cannot be overwritten and a paused run cannot be resumed twice.
 */
export async function answerExecutionInterrupt(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    interruptId: string;
    answer: ExecutionInterruptAnswer;
  },
): Promise<AnswerInterruptResult> {
  const { data: existing, error: readError } = await supabase
    .from("execution_interrupts")
    .select(INTERRUPT_COLUMNS)
    .eq("id", params.interruptId)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (readError) throw readError;
  if (!existing) return { ok: false, reason: "not_found" };

  const interrupt = mapInterrupt(existing as unknown as InterruptRow);
  if (interrupt.status === "answered") {
    return { ok: true, interrupt, alreadyAnswered: true };
  }
  if (interrupt.status !== "open") return { ok: false, reason: "not_open" };

  if (!isValidInterruptAnswer(interrupt.responseSchema, params.answer)) {
    return { ok: false, reason: "invalid_answer" };
  }

  const { data, error } = await supabase
    .from("execution_interrupts")
    .update({
      status: "answered",
      answer: params.answer,
      answered_at: new Date().toISOString(),
    })
    .eq("id", params.interruptId)
    .eq("status", "open")
    .select(INTERRUPT_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    // Lost the race by milliseconds. The winner's answer is the answer.
    return { ok: true, interrupt, alreadyAnswered: true };
  }

  return { ok: true, interrupt: mapInterrupt(data as unknown as InterruptRow), alreadyAnswered: false };
}

/** Closes a question nothing is waiting on any more. */
export async function cancelOpenInterrupts(
  supabase: SupabaseClient,
  agentExecutionRunId: string,
): Promise<void> {
  const { error } = await supabase
    .from("execution_interrupts")
    .update({ status: "cancelled" })
    .eq("agent_execution_run_id", agentExecutionRunId)
    .eq("status", "open");

  if (error) throw error;
}
