import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { checkBudgetBinding } from "@/modules/execution-contract/budget";
import type { StoredExecutionSpec } from "@/modules/execution-contract/store";
import { findExecutionSpecByIdentity } from "@/modules/execution-contract/store";
import { getReservation } from "@/modules/credits/store";
import { releaseOperationBilling } from "@/modules/operations/billing";
import {
  claimAgentExecutionRunRow,
  expireStaleAgentExecution,
  holdAgentExecutionCredits,
  quoteAgentExecutionCredits,
} from "@/modules/operations/agent-execution/server-writes";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  attachExecutionRun,
  createOperationRun,
  failOperationRun,
  findActiveOperationByIdentity,
  getProjectOperationRunById,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import { AGENTIC_EXECUTION_CONFIG } from "@/modules/ai/operations";
import { resolveAgentEconomics } from "./authorization";
import { computeAgentRunIdentity } from "./identity";
import { executionOriginForStepKey } from "./dogfood/fixtures";
import {
  findActiveAgentRunByIdentity,
  type StoredAgentExecutionRun,
} from "./store";
import {
  AGENT_PROMPT_COMPILER_VERSION,
  CODING_AGENT_POLICY_VERSION,
} from "./schema";

/**
 * Starting and observing an agent execution (EXECUTION CORE-4 §18, §53, §55, §56).
 *
 * ## What the caller may decide
 *
 * A project id and an ExecutionSpec id. That is the complete list.
 *
 * Everything else — the repository, the base commit, the model, the policy, the
 * budget, the branch, the paths, the commands — is resolved from server state.
 * A client that could name its own repository or its own model would turn a
 * bounded execution into an arbitrary write primitive on someone else's bill,
 * so those are not parameters at all rather than parameters that get validated
 * (§53).
 *
 * ## The order, and why nothing may be reordered
 *
 * ```
 * 1. ownership          the project belongs to this user, by query
 * 2. the spec           by id, scoped to the project — never "the latest"
 * 3. economics          authorized at all? production has none; dogfood is allowlisted
 * 4. the reservation    Credits held BEFORE anything is spent (§18, §55)
 * 5. the claim          one run per identity, enforced by a unique index (§56)
 * 6. enqueue            durable, so no browser owns the lifecycle (§21)
 * ```
 *
 * Step 4 before step 6 is the whole of §55: if the reservation cannot be taken,
 * the provider call count is zero, because the enqueue never happens.
 */

export type StartAgentExecutionOutcome =
  | { kind: "started"; operation: OperationView; agentExecutionRunId: string }
  /** A matching execution is already running; the same one is returned (§56). */
  | { kind: "running"; operation: OperationView }
  /** This exact work already produced a change. Nothing runs again. */
  | { kind: "reused"; agentExecutionRunId: string; preparedChangeId: string }
  | { kind: "failed"; error: AgentStartRefusal };

export type AgentStartRefusal =
  | "project_not_found"
  | "execution_spec_not_found"
  | "spec_not_agentic"
  | "agentic_execution_not_authorized"
  | "insufficient_credits"
  | "credit_reservation_insufficient"
  | "execution_start_failed"
  | "agent_start_failed";

export type StartAgentExecutionParams = {
  projectId: string;
  userId: string;
  /** Must belong to the project. Ownership is the query, not a check. */
  executionSpecId: string;
  /**
   * Who is asking (VB-008). Defaults to `customer`, which is the safe
   * direction: a caller that forgets to say is rate-limited rather than
   * exempt.
   *
   * The only `system` caller is the billing concurrency harness, which drives
   * this primitive sixty times against one project on purpose. That is not the
   * loop the limit exists to stop, and a per-project window and a
   * single-project race gate cannot both be satisfied — so the harness says
   * what it is instead of the limit being loosened for everyone.
   */
  initiatedBy?: "customer" | "system";
};

function view(operation: StoredOperationRun): OperationView {
  return buildOperationView({
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failureCode: operation.failureCode,
    resultId: operation.resultId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    createdAt: operation.createdAt,
  });
}

async function loadSpec(
  supabase: SupabaseClient,
  params: StartAgentExecutionParams,
): Promise<StoredExecutionSpec | null> {
  const { data, error } = await supabase
    .from("execution_specs")
    .select("spec_identity")
    .eq("id", params.executionSpecId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return findExecutionSpecByIdentity(supabase, {
    projectId: params.projectId,
    specIdentity: (data as { spec_identity: string }).spec_identity,
  });
}

export async function startAgentExecution(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartAgentExecutionParams,
): Promise<StartAgentExecutionOutcome> {
  // Ownership is the query. Another user's project is invisible rather than
  // forbidden, and a spec belonging to it is unreachable from here (§53).
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  const stored = await loadSpec(supabase, params);
  if (!stored) return { kind: "failed", error: "execution_spec_not_found" };
  if (stored.mode !== "agentic") return { kind: "failed", error: "spec_not_agentic" };

  // The class the spec was built at, never a fresh classification. The customer
  // was shown a price for *this* tier and a reservation was taken against it;
  // re-deriving the class here could disagree with both and would bound a run
  // by a ceiling nobody authorized.
  const pricingClass = stored.spec.pricingClass;
  if (!pricingClass) return { kind: "failed", error: "agentic_execution_not_authorized" };

  // Resolved against the policy in force *now*, not against the one baked into
  // the spec: a lapsed policy must stop a start, which is what
  // `agentic_pricing_not_configured` exists to say. Under `launch-v1-budget`
  // this resolves for any project; the dogfood policy remains reachable only
  // for a project on the operator-managed allowlist, and is what makes a run
  // non-production.
  const economics = resolveAgentEconomics({ projectId: params.projectId, pricingClass });
  if (!economics) return { kind: "failed", error: "agentic_execution_not_authorized" };

  const runIdentity = computeAgentRunIdentity({
    projectId: params.projectId,
    executionSpecIdentity: stored.specIdentity,
    codingAgentPolicyVersion: CODING_AGENT_POLICY_VERSION,
    promptCompilerVersion: AGENT_PROMPT_COMPILER_VERSION,
    model: AGENTIC_EXECUTION_CONFIG.model,
    budgetPolicyVersion: economics.budget.budgetPolicyVersion,
  });

  // Cheapest answer first: this exact work already ran. A succeeded run is the
  // answer; a live one is the answer too. Neither buys a second agent (§56).
  const existing = await findActiveAgentRunByIdentity(supabase, {
    projectId: params.projectId,
    runIdentity,
  });

  if (existing?.status === "succeeded" && existing.preparedChangeId) {
    return {
      kind: "reused",
      agentExecutionRunId: existing.id,
      preparedChangeId: existing.preparedChangeId,
    };
  }

  if (existing) {
    const operation = await getProjectOperationRunById(supabase, existing.operationRunId);
    if (operation) return { kind: "running", operation: view(operation) };
  }

  const active = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "agent_execution",
    inputIdentity: runIdentity,
  });
  if (active) return { kind: "running", operation: view(active) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "agent_execution",
    inputIdentity: runIdentity,
    subjectId: stored.id,
    initiatedBy: params.initiatedBy ?? "customer",
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      // Lost the race by milliseconds — the other click's operation is the
      // right answer, not an error.
      const winner = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "agent_execution",
        inputIdentity: runIdentity,
      });
      if (winner) return { kind: "running", operation: view(winner) };
    }
    return { kind: "failed", error: "agent_start_failed" };
  }

  const operation = created.operation;

  // Money before work (§18, §55). Keyed on the operation run id, so a retried
  // request finds the same hold rather than taking a second one.
  /*
   * Service-role, like every other hold in the product (Rule 53, §64).
   *
   * `billing_credit_reservations`, `billing_credit_ledger` and
   * `billing_credit_allocations` each carry a select policy and deliberately no
   * write policy for any authenticated client, so a hold taken with the
   * caller's `supabase` is refused with `42501` — which is exactly what Run
   * with Vibe did. Ownership was established against the persisted project row
   * above, and `holdAgentExecutionCredits` re-establishes it rather than
   * trusting that.
   */
  // Recorded before the hold, because a quote is what the customer was shown
  // and the hold is what acts on it. Writing it afterwards would record an
  // agreement reached after the money moved. It authorizes nothing and cannot
  // fail the start — see `quoteAgentExecutionCredits`.
  const quoteId = await quoteAgentExecutionCredits({
    projectId: params.projectId,
    userId: params.userId,
    operationRunId: operation.id,
    credits: economics.budget.maxCredits,
    pricingClass,
    pricingClassReason: stored.spec.pricingClassReason,
    policyVersion: economics.nonProduction ? "internal-dogfood-v1" : "launch-v1",
    budgetPolicyVersion: economics.budget.budgetPolicyVersion,
  });

  const authorized = await holdAgentExecutionCredits({
    projectId: params.projectId,
    userId: params.userId,
    operationRunId: operation.id,
    pricingClass,
    nonProduction: economics.nonProduction,
    quoteId,
  });

  if (!authorized.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "insufficient_credits",
    });
    return { kind: "failed", error: "insufficient_credits" };
  }

  const reservationId = authorized.billable ? authorized.reservationId : null;

  // The reservation must actually cover the spec's authorized maximum. A hold
  // for less would let the run discover that half way through, which is the
  // surprise overage Core-3 §26 forbids.
  if (reservationId) {
    const reservation = await getReservation(supabase, reservationId);
    const binding = checkBudgetBinding({
      budget: economics.budget,
      reservation: reservation
        ? {
            id: reservation.id,
            status: reservation.status,
            reservedCredits: reservation.reservedCredits,
          }
        : null,
    });

    if (!binding.ok) {
      await failOperationRun(supabase, {
        operationId: operation.id,
        failureCode: "agent_reservation_invalid",
      });
      // The run never started, so no settlement is coming for this hold and
      // nothing else will ever close it. Leaving it active suppressed capacity
      // the customer could spend, indefinitely — there is no reservation
      // sweeper, and Sprint 0057 established that a terminal operation status
      // cannot safely authorize one (`completeOperationRun` runs *before*
      // `settleOperationBilling`, so terminal does not imply finalized).
      //
      // This release is safe precisely because it does not reason about time or
      // about operation state: the binding check refused, so the work has not
      // begun and cannot begin. `releaseOperationBilling` is itself guarded on
      // an active reservation, so a hold already closed is untouched.
      await releaseOperationBilling(supabase, { operationRunId: operation.id });
      return { kind: "failed", error: "credit_reservation_insufficient" };
    }
  }

  // Server-owned for the same reason: `agent_execution_runs` accepts no insert
  // from a client, because the unique index on the run identity is what makes a
  // double-click one run rather than two.
  const claim = await claimAgentExecutionRunRow({
    projectId: params.projectId,
    userId: params.userId,
    operationRunId: operation.id,
    executionSpecId: stored.id,
    runIdentity,
    provider: "anthropic",
    harness: "claude_agent_sdk",
    model: AGENTIC_EXECUTION_CONFIG.model,
    codingAgentPolicyVersion: CODING_AGENT_POLICY_VERSION,
    promptCompilerVersion: AGENT_PROMPT_COMPILER_VERSION,
    budgetPolicyVersion: economics.budget.budgetPolicyVersion,
    executionPolicyVersion: stored.policyVersion,
    nonProductionEconomics: economics.nonProduction,
    baseSha: stored.baseSha,
    creditReservationId: reservationId,
    /*
     * Provenance, derived from the immutable spec rather than passed in.
     *
     * The step key is what the spec was built with and what durable execution
     * resolves the step from, so reading the origin off it is reading the same
     * fact the pipeline itself acts on. A caller cannot mislabel a run, and a
     * fixture cannot hide that it is one.
     */
    ...executionOriginForStepKey(stored.stepKey),
  });

  if (!claim.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "already_running",
    });
    return { kind: "failed", error: "agent_start_failed" };
  }

  const started = await executor.start({
    operationId: operation.id,
    operationType: "agent_execution",
  });

  if (!started.ok) {
    // The rows exist but nothing is carrying them. Failing immediately keeps
    // the identity free so the user can simply try again — and releases the
    // hold, because nothing was spent.
    //
    // Unlike the `agent_reservation_invalid` branch above, this point is
    // reached *after* `claimAgentExecutionRunRow` succeeded — a run row
    // exists, so `expireStaleAgentExecution` or a retried call to this same
    // function could in principle race this exact release. Release is
    // therefore gated on winning the terminal-transition CAS, the same
    // pattern class D (Sprint 0057 E2b) established is required wherever
    // `settleOperationCredits`/`releaseOperationCredits` could be reached
    // concurrently for one reservation — not on `executor.start`'s own
    // `!ok` result, which only says this attempt failed, not that no other
    // path could also be finalizing this operation right now.
    const failed = await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    if (failed) await releaseOperationBilling(supabase, { operationRunId: operation.id });
    return { kind: "failed", error: "execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    projectId: params.projectId,
    eventType: "agent_execution.started",
    metadata: {
      projectId: params.projectId,
      operationId: operation.id,
      agentExecutionRunId: claim.run.id,
      executionSpecId: stored.id,
      model: AGENTIC_EXECUTION_CONFIG.model,
      nonProductionEconomics: economics.nonProduction,
      disclosure: economics.disclosure,
    },
  });

  return {
    kind: "started",
    operation: view(operation),
    agentExecutionRunId: claim.run.id,
  };
}

/** Status for a page that may have been left and returned to (§21). */
export async function getAgentExecutionStatus(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; operationId: string },
): Promise<(OperationView & { agentExecutionRunId: string | null }) | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return null;

  /*
   * The backstop for a workflow that stopped carrying its run (ADR 0029, A1).
   *
   * The polling loop terminates every run it is watching, but it cannot survive
   * the workflow itself dying — which is what happened to the first real run:
   * the step was killed at 300 seconds, nothing reached cleanup, and hours
   * later the run still read `running` with 100 Credits held.
   *
   * A read is the right moment for the repair because it is the moment somebody
   * cares, and it needs no scheduler this product has not decided to introduce
   * (rule 24). Idempotent and bounded to one operation, so a hundred page loads
   * repair it once.
   */
  await expireStaleAgentExecution({ operationRunId: params.operationId });

  const operation = await getProjectOperationRunById(supabase, params.operationId);
  if (!operation || operation.projectId !== params.projectId) return null;

  const { data } = await supabase
    .from("agent_execution_runs")
    .select("id")
    .eq("operation_run_id", operation.id)
    .maybeSingle();

  return {
    ...view(operation),
    agentExecutionRunId: (data as { id: string } | null)?.id ?? null,
  };
}

export type { StoredAgentExecutionRun };
