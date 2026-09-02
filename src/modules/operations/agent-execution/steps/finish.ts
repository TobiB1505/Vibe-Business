import "server-only";
import { AgentExecutionDeps, recordLifecycle } from "./shared";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { startChangeValidation } from "@/modules/validation/service";
import type { OperationExecutor } from "../../executor";
import { agentSandboxNameFor } from "@/modules/coding-agent/identity";
import type { AgentFailureCode } from "@/modules/coding-agent/schema";
import {
  cancelOpenInterrupts,
  completeAgentRun,
  failAgentRun,
  findAgentRunByOperation,
} from "@/modules/coding-agent/store";
import { recordAgentSandboxUsage } from "@/modules/coding-agent/usage";
import { releaseOperationCredits } from "@/modules/credits/operation-billing";
import { resolveAgentHold, type AgentHoldOutcome } from "@/modules/coding-agent/hold";
import { type SandboxHandle } from "@/modules/validation/sandbox-port";
import type { OperationFailureCode } from "../../failures";
import { completeOperationRun, failOperationRun } from "../../store";
/* ---------------------------------------------------------------------------
 * Step 5 — cleanup, on every path (§20, §36)
 * ------------------------------------------------------------------------ */

export async function cleanupAgentWorkspaceStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<{ cleanup: string }> {
  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run) return { cleanup: "not_provisioned" };

  await recordLifecycle(deps, run, "sandbox_stopping", "Shutting down the workspace");

  let sandbox: SandboxHandle | null = null;
  try {
    sandbox = await deps.sandboxProvider.reconnect({ name: agentSandboxNameFor(run.id) });
  } catch {
    sandbox = null;
  }

  if (!sandbox) {
    await recordAgentSandboxUsage(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      provider: deps.sandboxProvider.id,
      runtime: null,
      usage: null,
      sandboxDurationMs: null,
      cleanupStatus: "not_provisioned",
      succeeded: false,
      failureCode: null,
    });
    return { cleanup: "not_provisioned" };
  }

  try {
    const usage = await sandbox.stop();
    await recordAgentSandboxUsage(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      provider: deps.sandboxProvider.id,
      runtime: sandbox.runtime,
      usage,
      sandboxDurationMs: run.durationMs,
      cleanupStatus: "stopped",
      succeeded: run.status !== "failed",
      failureCode: run.failureCode,
    });

    await recordLifecycle(deps, run, "sandbox_stopped", "Workspace shut down", {
      activeCpuMs: usage?.activeCpuDurationMs ?? null,
      networkEgressBytes: usage?.networkEgressBytes ?? null,
    });

    return { cleanup: "stopped" };
  } catch {
    await recordAgentSandboxUsage(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      provider: deps.sandboxProvider.id,
      runtime: sandbox.runtime,
      usage: null,
      sandboxDurationMs: run.durationMs,
      cleanupStatus: "stop_failed",
      succeeded: false,
      failureCode: run.failureCode,
    });
    return { cleanup: "stop_failed" };
  }
}

/* ---------------------------------------------------------------------------
 * Step 6 — settle (§18, §35)
 * ------------------------------------------------------------------------ */

/**
 * Finishes the run, and resolves its Credit hold **only on failure**.
 *
 * Every failure releases. That is CREDIT_ECONOMICS.md's approved failure policy
 * ("a Vibe/system failure, a provider failure, and an operation that produced
 * no usable result are all 0 charged, Vibe absorbs"), unchanged.
 *
 * ## What moved, and why (ADR 0073)
 *
 * Success no longer settles here. It used to, the moment a reviewable change
 * existed — three seconds before validation started, in production run
 * `c462c083`. But the price says what is being sold, and `credits/retail.ts`
 * says it plainly: validation carries no price of its own because *"a customer
 * bought a validated improvement, not a pipeline"*. Charging before the checks
 * ran meant a change Vibe would refuse to ship could still be paid for in full.
 *
 * So the hold survives this step and `coding-agent/hold.ts` resolves it from
 * the validation verdict. `enqueueValidationStep` below is where a run that
 * will never get one is released instead.
 *
 * Provider usage that really happened stays recorded either way. Internal cost
 * and customer price are separate facts, and a release does not pretend the
 * tokens were free.
 */
export async function finishAgentExecutionStep(
  deps: AgentExecutionDeps,
  operationId: string,
  outcome:
    | { kind: "succeeded"; preparedChangeId: string }
    | { kind: "paused" }
    | { kind: "failed"; failureCode: OperationFailureCode },
): Promise<void> {
  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run) return;

  if (outcome.kind === "paused") {
    // The interrupt boundary owns release of this attempt's reservation.
    // Finalization deliberately does nothing here: it must neither charge nor
    // invent a resume. Resolution later cancels this run, and a fresh attempt
    // goes through admission with its own hold.
    return;
  }

  if (outcome.kind === "succeeded") {
    const transitioned = await completeAgentRun(deps.supabase, {
      runId: run.id,
      preparedChangeId: outcome.preparedChangeId,
    });

    // Whoever wins the status swap owns the billing finalization.
    //
    // `expireStaleAgentExecution` can finalize this same run from a web request
    // process — it runs on every status poll — so "the workflow is here" is not
    // evidence that the workflow is entitled to charge. Without this gate both
    // processes finalize: E2b measured the result 20 times out of 20 against
    // real PostgreSQL, a charge standing against a hold recorded as released.
    //
    // Nothing new is invented. This is the pattern the three deterministic
    // families already use on `operation_runs.status` — see
    // `business-audit/execution.ts`, where `settleOperationBilling` sits behind
    // `if (!transitioned) return`. Agent execution had the same primitive
    // available, returning the same boolean, and discarded it.
    //
    // The cost of returning here rather than gating the charge alone: an
    // attempt that wins the swap and then dies before `completeOperationRun`
    // leaves an operation row nothing finishes, because the retry loses the
    // swap and stops. That window exists today for the same reason — a crash
    // between two adjacent writes — and is narrower than the alternative, which
    // is letting a process that lost the swap keep writing.
    if (!transitioned) return;

    /*
     * The hold is deliberately left open (ADR 0073).
     *
     * Winning the swap still carries billing authority — it is what entitles
     * *this* process to resolve the hold rather than a sweep racing it — and
     * what that authority now does on success is nothing. The verdict settles
     * it, or `enqueueValidationStep` releases it when no verdict is coming.
     */

    await completeOperationRun(deps.supabase, {
      operationId,
      resultId: outcome.preparedChangeId,
    });

    // No longer conditional: reaching this line *is* having won the swap, so a
    // second guard on the same fact would only suggest there is a path where
    // the two disagree.
    await recordAuditEvent(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      eventType: "agent_execution.completed",
      metadata: {
        projectId: run.projectId,
        operationId,
        agentExecutionRunId: run.id,
        preparedChangeId: outcome.preparedChangeId,
        model: run.model,
        nonProductionEconomics: run.nonProductionEconomics,
      },
    });

    await recordLifecycle(deps, run, "execution_completed", "Ready for review", {
      preparedChangeId: outcome.preparedChangeId,
    });
    return;
  }

  await cancelOpenInterrupts(deps.supabase, run.id);
  const failed = await failAgentRun(deps.supabase, {
    runId: run.id,
    failureCode: toAgentFailureCode(outcome.failureCode),
  });

  // The same authority, in the other direction. Releasing a hold whose
  // settlement belongs to whoever won the swap is how Vibe loses the charge for
  // work it delivered.
  if (!failed) return;

  if (run.creditReservationId) {
    await releaseOperationCredits(deps.supabase, {
      reservationId: run.creditReservationId,
      // Names the honest shape: Vibe paid the provider, the customer did not
      // pay Vibe. Internal cost and customer price stay separate facts.
      reason: "abandoned_with_usage",
    });
  }

  await failOperationRun(deps.supabase, { operationId, failureCode: outcome.failureCode });

  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.failed",
    metadata: {
      projectId: run.projectId,
      operationId,
      agentExecutionRunId: run.id,
      reason: outcome.failureCode,
    },
  });

  await recordLifecycle(deps, run, "execution_failed", "The run stopped without a change", {
    failureCode: outcome.failureCode,
  });
}

/**
 * Maps an operation failure onto the agent run's own vocabulary (§34).
 *
 * Two vocabularies rather than one, because they answer different questions:
 * the operation code is what the *product* tells a user, and the agent code is
 * what the *execution* recorded about itself. A run that failed because the
 * sandbox vanished and one that failed because the diff was illegal are the
 * same "operation failed" to a user and completely different findings to
 * whoever reads the dogfood.
 */
function toAgentFailureCode(code: OperationFailureCode): AgentFailureCode {
  switch (code) {
    case "repository_changed":
      return "agent_source_drift";
    case "agent_change_rejected":
      return "agent_change_rejected";
    case "agent_produced_no_change":
      return "agent_produced_no_change";
    case "sandbox_unavailable":
    case "sandbox_lost":
    case "credential_scrub_failed":
      return "agent_workspace_unavailable";
    case "validation_not_supported":
      return "agent_validation_unsupported";
    case "agentic_pricing_not_configured":
      return "agent_execution_not_authorized";
    case "insufficient_credits":
      return "agent_budget_exhausted";
    default:
      return "agent_provider_failed";
  }
}

/* ---------------------------------------------------------------------------
 * Handing a finished change to Independent Validation (Sprint 0048)
 * ------------------------------------------------------------------------ */

/**
 * Enqueues validation for the change this run just prepared.
 *
 * ## Why this calls the same function the button does
 *
 * `startChangeValidation` is the only entry point to validation, and it carries
 * every guard: project ownership, prepared-change readiness, snapshot presence,
 * profile support, depth resolution, identity reuse, in-flight detection and
 * the unique index that settles a double submit. Reproducing any part of that
 * here would create a second validation path — one that could drift from the
 * one a user's click takes, and would be exactly the wrong thing to have two of.
 *
 * So this step resolves three identifiers and calls it. Nothing else.
 *
 * ## Why it is safe against a retry it does not have
 *
 * Not by new code. A second call for the same artifact finds either a reusable
 * passed run or an active operation with the same input identity, and returns
 * `reused` or `running` without provisioning anything. The idempotency is the
 * existing guards', which is the only kind worth relying on.
 *
 * ## Why a failure here cannot fail the run
 *
 * The agent execution is already complete: the branch is written, the prepared
 * change exists and the run row says `succeeded`. Validation not starting is a
 * missing convenience, not a broken execution — the user can still click
 * "Validate change" and get exactly what they would have got before this
 * sprint. So every outcome is recorded and none is propagated.
 *
 * ## Why it is nonetheless where the hold is decided (ADR 0073)
 *
 * Because this is the only place that knows whether a verdict is coming. Since
 * settlement moved to the validation verdict, a run whose validation never
 * starts would otherwise hold a customer's Credits open forever — reserved
 * against a purchase nothing will ever complete.
 *
 * `reused` is the one outcome that settles here: it means this exact artifact
 * has already passed under this exact policy, so the validated improvement
 * exists and there is no second verdict to wait for.
 *
 * A failure releases, and it cannot mean "this repository has no validation":
 * eligibility refuses admission on `validation_not_supported` before a run
 * begins. It means something moved underneath a run that had already started,
 * which the approved failure policy absorbs.
 *
 * ## Ownership
 *
 * `projectId` and `userId` come from the persisted run row, never from an
 * argument. This runs under the service-role client, which bypasses RLS, so the
 * ownership it filters on must be the ownership the database already recorded
 * (Rule 53).
 */
/**
 * Resolves the hold when the hand-off already knows the answer.
 *
 * `null` is "a verdict is coming" and does nothing, which is the ordinary path.
 * A failure to resolve is swallowed for the same reason the enqueue itself is:
 * this step must never fail a completed execution. What it must not do is stay
 * silent — an unresolved hold is money, so the outcome is recorded either way.
 */
async function resolveHoldFor(
  deps: AgentExecutionDeps,
  run: { id: string; projectId: string; userId: string; preparedChangeId: string | null },
  outcome: AgentHoldOutcome | null,
): Promise<void> {
  if (outcome === null || run.preparedChangeId === null) return;

  let resolution: string;
  try {
    const resolved = await resolveAgentHold(deps.supabase, {
      projectId: run.projectId,
      preparedChangeId: run.preparedChangeId,
      outcome,
    });
    resolution = resolved.kind;
  } catch {
    resolution = "error";
  }

  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.hold_resolved",
    metadata: {
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      preparedChangeId: run.preparedChangeId,
      outcome,
      resolution,
      decidedBy: "validation_handoff",
    },
  });
}

export async function enqueueValidationStep(
  deps: AgentExecutionDeps,
  executor: OperationExecutor,
  operationId: string,
): Promise<void> {
  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run?.preparedChangeId) return;

  let outcome: string;
  let detail: string | null = null;

  try {
    const started = await startChangeValidation(deps.supabase, executor, {
      projectId: run.projectId,
      userId: run.userId,
      preparedChangeId: run.preparedChangeId,
    });

    outcome = started.kind;
    if (started.kind === "failed") detail = started.error;
  } catch {
    // A provider or database fault. Not inspected — the value is untyped and
    // may carry third-party prose — and deliberately not rethrown.
    outcome = "failed";
    detail = "execution_start_failed";
  }

  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.validation_enqueued",
    metadata: {
      projectId: run.projectId,
      operationId,
      agentExecutionRunId: run.id,
      preparedChangeId: run.preparedChangeId,
      outcome,
      ...(detail ? { detail } : {}),
    },
  });

  /*
   * And only now the hold, so the trail reads in the order things happened:
   * Vibe handed the change over, and *therefore* the money did or did not move.
   *
   * `reused` is the only outcome that settles — the artifact has already passed
   * under this exact policy, so the validated improvement exists. `failed`
   * releases. `started` and `running` leave it held for the verdict.
   */
  await resolveHoldFor(
    deps,
    run,
    outcome === "reused" ? "validated" : outcome === "failed" ? "unvalidated" : null,
  );
}
