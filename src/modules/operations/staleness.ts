import "server-only";
import { alertOperator } from "@/lib/observability/alert";

import { createServiceClient } from "@/lib/supabase/service";
import {
  ACTION_PLANNING_CONFIG,
  BUSINESS_READINESS_AUDIT_CONFIG,
  OPPORTUNITY_GENERATION_CONFIG,
  PRODUCT_UNDERSTANDING_CONFIG,
} from "@/modules/ai/operations";
import { PREVIEW_BUDGETS } from "@/modules/change-preview/budgets";
import { REVIEW_POLICY } from "@/modules/review/policy";
import { SANDBOX_BUDGETS } from "@/modules/validation/budgets";
import { releaseOperationBilling } from "./billing";
import { failOperationRun, getOperationRunById, type StoredOperationRun } from "./store";
import type { OperationType } from "./schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAgentHold } from "@/modules/coding-agent/hold";
import { findValidationRunByOperation } from "@/modules/validation/store";

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
 * ## Why `agent_execution` alone has no deadline here
 *
 * It has its own, more precise mechanism (`expireStaleAgentExecution`), keyed
 * off `agent_execution_runs.started_at` and the sandbox's own lifetime rather
 * than `operation_runs.started_at` — a different bound for a genuinely
 * different kind of operation.
 *
 * It is the **only** exemption, and the map is a total `Record` so that saying
 * so is a decision rather than an omission. That is VB-014: the map used to be
 * `Partial`, and eleven of the fifteen operation types were simply absent from
 * it. A workflow that died carrying a product scan, a validation, a preview, a
 * review, a merge or a measurement left its operation `running` forever — and
 * because `operation_runs` carries a partial unique index on the active state,
 * forever also meant the customer could never start that work again. Nothing
 * was billed and nothing was broken; the feature was simply gone for that
 * project, permanently, with the UI still showing a spinner.
 *
 * ## Where the numbers come from
 *
 * Where a family already declares its own ceiling, the deadline is derived from
 * it rather than invented beside it — the sandbox's leak bound, the preview's
 * TTL, the review session's timeout, the model call's timeout. Those move when
 * somebody changes the real thing, which is the point.
 *
 * The rest get {@link UNDECLARED_CEILING_MS}, and that is honestly a chosen
 * number. It is deliberately far above what any of them takes (the measured
 * runs are seconds: an outcome verification did 8 checks in 2.5 s) because
 * being late to notice a dead operation costs a spinner, and being early costs
 * a customer a run that was still working.
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

/**
 * For the families that declare no ceiling of their own.
 *
 * A backstop, not a timeout: nothing is expected to reach it, and the work it
 * covers is measured in seconds.
 */
const UNDECLARED_CEILING_MS = 10 * 60 * 1000;

/**
 * `null` means "not swept here", and there is exactly one.
 *
 * Total rather than partial, so a new operation type cannot arrive unswept by
 * being forgotten — the compiler asks.
 */
const OPERATION_STALE_DEADLINE_MS: Record<OperationType, number | null> = {
  // Derived from the one paid call each of these makes.
  business_audit: BUSINESS_READINESS_AUDIT_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,
  opportunity_generation: OPPORTUNITY_GENERATION_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,
  action_planning: ACTION_PLANNING_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,
  product_understanding: PRODUCT_UNDERSTANDING_CONFIG.timeoutMs + OPERATION_STALE_GRACE_MS,

  /**
   * The sandbox's own leak bound. If the workflow dies outright, that timeout
   * is what stops the paid VM — so an operation still `running` past it is one
   * whose sandbox is already gone.
   */
  change_validation: SANDBOX_BUDGETS.totalLifetimeMs + OPERATION_STALE_GRACE_MS,

  /** The preview's TTL: past it the environment it was creating no longer exists. */
  change_preview: PREVIEW_BUDGETS.ttlMs + OPERATION_STALE_GRACE_MS,

  /**
   * Two captures, each bounded by the remote browser session's own timeout.
   * Doubled because a review takes both sides before it is finished.
   */
  change_review: REVIEW_POLICY.sessionTimeoutSeconds * 2 * 1000 + OPERATION_STALE_GRACE_MS,

  // No declared ceiling of their own: GitHub reads and writes, HTTP probes,
  // a snapshot delete. All measured in seconds.
  product_scan: UNDECLARED_CEILING_MS,
  change_preparation: UNDECLARED_CEILING_MS,
  change_merge: UNDECLARED_CEILING_MS,
  preview_teardown: UNDECLARED_CEILING_MS,
  change_outcome_verification: UNDECLARED_CEILING_MS,
  business_measurement: UNDECLARED_CEILING_MS,

  /**
   * Erasure walks a delete cascade across roughly forty tables plus storage,
   * so it gets far more room than anything else — and it needs a sweep more
   * than anything else does. A died erasure leaves `operation_runs` holding
   * the account-level active index, and `startAccountErasure` answers every
   * later attempt with "already running": a person who asked to delete their
   * account could never ask again.
   */
  account_erasure: 30 * 60 * 1000,

  /** Its own mechanism — see the docblock. */
  agent_execution: null,
};

/**
 * Whether a run looks like one nothing is carrying any more.
 *
 * ## Why this is separate from the sweep
 *
 * Because it answers the cheap question, and the sweep opens a service-role
 * client and reads a row by primary key to answer it. `getOperationStatus`
 * called the sweep before its own read on every poll, for every polling
 * surface, for every signed-in person at once — a round trip whose answer was
 * "no" essentially always (PERF-020).
 *
 * A caller that has already read the run can ask here first for nothing. What
 * it must not do is act on the answer: this is a filter in front of the sweep,
 * never a substitute for it. `expireStaleOperation` still re-reads the row
 * under its own authority before it writes, because a row read a moment ago
 * through somebody else's client is evidence, not permission.
 *
 * Only `running` counts, mirroring the sweep's original guard: `queued` may
 * simply not have been picked up yet, and `needs_user` is not a staleness
 * question at all.
 */
export function isPastStaleDeadline(
  operation: Pick<StoredOperationRun, "status" | "startedAt" | "operationType">,
  now: (() => number) | undefined = Date.now,
): boolean {
  if (operation.status !== "running" || !operation.startedAt) return false;

  const deadlineMs = OPERATION_STALE_DEADLINE_MS[operation.operationType];
  if (deadlineMs === null) return false;

  const startedAt = Date.parse(operation.startedAt);
  if (!Number.isFinite(startedAt)) return false;

  return (now ?? Date.now)() >= startedAt + deadlineMs;
}

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

  /*
   * Read by id alone, not through the project-scoped getter (VB-014).
   *
   * That getter refuses a row whose `project_id` is null, which is exactly and
   * only the account-level operations ADR 0057 introduced — so erasure, the one
   * family where being wedged means a person cannot delete their account, was
   * the one family this sweep could not see. Ownership is not what that filter
   * was providing here: this function acts on the row it reads and reports to
   * nobody, and the caller's own read is RLS-scoped separately.
   */
  const operation = await getOperationRunById(supabase, params.operationId);
  if (!operation || !isPastStaleDeadline(operation, params.now)) return { expired: false };

  // VB-012 — a swept operation means a workflow died, which is worth knowing
  // about before the pattern becomes a customer's report.
  await alertOperator("[operations] expiring an operation nothing is carrying", {
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

  /*
   * A swept validation also owes an answer to somebody else's hold (ADR 0073).
   *
   * Since settlement moved to the validation verdict, the Credits an agent run
   * reserved sit open until one arrives. A validation that dies is a verdict
   * that never comes — and the release above cannot reach that hold, because it
   * is keyed to *this* operation and the hold belongs to the agent's.
   *
   * Without this, a customer's balance would carry a reservation against a
   * purchase nothing will ever complete, and no other path would ever close it.
   * The verdict is the honest one: no validated improvement exists, so nothing
   * is charged.
   */
  if (operation.operationType === "change_validation") {
    await releaseAgentHoldBehindValidation(supabase, operation);
  }

  return { expired: true };
}

/**
 * Releases the agent hold behind a validation that will never answer.
 *
 * Reached through the validation run's own `prepared_change_id`, which is the
 * link the database records — an operation id alone cannot find the hold.
 *
 * Never throws: this is a backstop, and a billing fault inside it must not stop
 * an operation from being expired. `resolveAgentHold` is idempotent and refuses
 * a reservation that is already terminal, so a sweep racing a verdict that
 * settled first reports `already_closed` and takes nothing back.
 */
async function releaseAgentHoldBehindValidation(
  supabase: SupabaseClient,
  operation: { id: string; projectId: string | null },
): Promise<void> {
  if (operation.projectId === null) return;

  try {
    const run = await findValidationRunByOperation(supabase, operation.id);
    if (!run) return;

    await resolveAgentHold(supabase, {
      projectId: operation.projectId,
      preparedChangeId: run.preparedChangeId,
      outcome: "unvalidated",
    });
  } catch {
    // Reported by the operator alert this function's caller already sent.
  }
}
