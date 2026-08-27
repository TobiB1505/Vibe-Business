import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  ACTION_PLANNING_CONFIG,
  BUSINESS_READINESS_AUDIT_CONFIG,
  OPPORTUNITY_GENERATION_CONFIG,
} from "@/modules/ai/operations";
import { releaseOperationBilling } from "./billing";
import { failOperationRun, getProjectOperationRunById } from "./store";
import type { OperationType } from "./schema";

/**
 * The backstop for a durable operation nothing is carrying any more (ADR 0042
 * §P2), generalizing `expireStaleAgentExecution`
 * (`agent-execution/server-writes.ts`) — the first, working precedent for this
 * exact shape — to the three deterministic operation families that share
 * `operation_runs` and have no per-family staleness sweep of their own:
 * `business_audit`, `opportunity_generation`, `action_planning`.
 *
 * ## Why on a read rather than a schedule
 *
 * Because the read is the moment it matters — the same reasoning
 * `expireStaleAgentExecution`'s own docblock gives. Somebody is looking at
 * this operation's status; the alternative is a cron this product does not
 * have and would need its own ADR to introduce (rule 24). Bounded, idempotent
 * and scoped to one operation: `failOperationRun` and `releaseOperationBilling`
 * are both no-ops on an operation that is already terminal, so a hundred page
 * loads repair it once.
 *
 * ## Why `agent_execution` is not in the deadline map
 *
 * It already has its own, more precise mechanism (`expireStaleAgentExecution`),
 * keyed off `agent_execution_runs.started_at` and the sandbox's own lifetime
 * rather than `operation_runs.started_at` and an AI call's timeout — a
 * different bound for a genuinely different kind of operation. An
 * `operationType` with no entry here is a deliberate no-op, not an omission:
 * this is what keeps `agent_execution` and the never-billed families
 * (`product_understanding`, every `change_*`, `business_measurement`) untouched.
 *
 * ## Why the deadline is `startedAt + timeoutMs + grace`, not a flat number
 *
 * Each of these three operations already declares how long its one paid call
 * may run before it is abandoned (`OperationConfig.timeoutMs`,
 * `modules/ai/operations.ts`) — measured per operation, not guessed, and
 * already generous (the audit's is "roughly double the longest successful
 * run"). A workflow step alive past that timeout would have already thrown and
 * failed the operation itself; this sweep exists for the case the *workflow*
 * died, not the case the call was merely slow. The grace margin on top is
 * family-agnostic overhead — network, Vercel Workflow scheduling, service
 * resumption lag — not variance in the call itself, so one shared constant
 * covers all three.
 */
const OPERATION_STALE_GRACE_MS = 5 * 60 * 1000;

const OPERATION_STALE_DEADLINE_MS: Partial<Record<OperationType, number>> = {
  business_audit: BUSINESS_READINESS_AUDIT_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,
  opportunity_generation: OPPORTUNITY_GENERATION_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,
  action_planning: ACTION_PLANNING_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,
};

/**
 * Fails an operation whose workflow stopped carrying it, and releases its
 * Credits.
 *
 * Only `running` is treated as genuinely mid-flight, mirroring
 * `expireStaleAgentExecution`: `queued` may simply not have been picked up
 * yet, and failing that would race a run about to start. `needs_user` is never
 * reached here regardless of age — it is not a staleness question at all (ADR
 * 0042 §P2); its Credits are released at the moment of pause, not swept later.
 *
 * Service-role, because `operation_runs` and the billing tables accept no
 * write from a browser's client and must not (Rule 53).
 */
export async function expireStaleOperation(params: {
  operationId: string;
  /** Injected so a test can be explicit about time rather than sleeping. */
  now?: () => number;
}): Promise<{ expired: boolean }> {
  const supabase = createServiceClient();

  const operation = await getProjectOperationRunById(supabase, params.operationId);
  if (!operation || operation.status !== "running" || !operation.startedAt) {
    return { expired: false };
  }

  const deadlineMs = OPERATION_STALE_DEADLINE_MS[operation.operationType];
  if (deadlineMs === undefined) return { expired: false };

  const startedAt = Date.parse(operation.startedAt);
  if (!Number.isFinite(startedAt)) return { expired: false };

  if ((params.now ?? Date.now)() < startedAt + deadlineMs) return { expired: false };

  console.error("[operations] expiring an operation nothing is carrying", {
    operationId: params.operationId,
    operationType: operation.operationType,
    startedAt: operation.startedAt,
  });

  const failed = await failOperationRun(supabase, {
    operationId: params.operationId,
    failureCode: "operation_wall_clock_exceeded",
  });

  /*
   * Losing the swap means the workflow was alive after all and finished first.
   *
   * The read above and this write are a read-then-act across two calls, and
   * the workflow finalizes from its own process — so between them the
   * operation can legitimately complete. Whoever wins the swap owns billing
   * finalization; this attempt lost, so it releases nothing and reports that
   * it expired nothing. Without this, a workflow finishing at the same moment
   * this sweep fires could both finalize — exactly the `charge_without_hold`
   * race `agent_execution`'s own version of this function was built to close
   * (Sprint 0057 E2b).
   */
  if (!failed) return { expired: false };

  // Nothing was delivered, so nothing is charged. Release is idempotent: an
  // operation with no reservation, or one already settled or released, is a
  // no-op either way.
  await releaseOperationBilling(supabase, {
    operationRunId: params.operationId,
    providerUsageOccurred: true,
  });

  return { expired: true };
}
