import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { ZERO_CREDITS, type CreditUnits } from "@/modules/credits/units";
import { quoteCredits } from "@/modules/credits/service";
import {
  EXECUTION_PRICING_CLASS_POLICY_VERSION,
  type ExecutionPricingClass,
  type ExecutionPricingClassReason,
} from "@/modules/economy/execution-class";
import { AGENT_SANDBOX_LIFETIME_MS } from "@/modules/coding-agent/budget";
import {
  claimAgentExecutionRun,
  failAgentRun,
  type ClaimAgentRunResult,
} from "@/modules/coding-agent/store";
import {
  authorizeOperationCredits,
  releaseOperationCredits,
  type AuthorizeOperationCreditsResult,
} from "@/modules/credits/operation-billing";
import { failOperationRun } from "../store";
import { recordExecutionSpec } from "@/modules/execution-contract/service";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";

/**
 * Every write an agent-execution start makes that RLS refuses to a customer
 * (Rule 53).
 *
 * ## The shape of the problem
 *
 * Starting a run touches six tables. Exactly two of them accept a write from an
 * authenticated client, and it is worth writing down which:
 *
 * ```
 * operation_runs                 INSERT · SELECT · UPDATE · DELETE   ← the caller writes
 * audit_events                   INSERT · SELECT                     ← the caller writes
 * execution_specs                SELECT                              ← here
 * billing_credit_reservations    SELECT                              ← here
 * billing_credit_ledger          SELECT                              ← here (via the reservation)
 * agent_execution_runs           SELECT                              ← here
 * ```
 *
 * None of those four is an oversight. A client that could insert a spec could
 * forge a mode, a base SHA, a tool policy and a Credit ceiling; a client that
 * could insert a reservation could hold Credits it does not have; a client that
 * could insert a run row could claim one for a spec it never resolved. RLS
 * cannot tell a Server Action from a browser holding the public anon key, so
 * "add an insert policy for the owner" hands all three to anyone with a console
 * open.
 *
 * The sanctioned answer is the service-role client, which Rule 53 confines to
 * `src/modules/operations/`. So this file exists, and it is the only place the
 * agent path bypasses RLS.
 *
 * ## Why the caller still verifies ownership first
 *
 * A service-role client bypasses RLS, so every function below re-establishes
 * the check RLS would have made — against the **persisted project row**, never
 * against anything passed alongside it. `startAgentExecution` verifies
 * ownership with the caller's own client before it reaches any of this; these
 * do it again rather than trusting that, because a bypassing client that
 * assumes an upstream check is one refactor away from writing anything.
 *
 * ## How this was found
 *
 * By clicking Run with Vibe. The spec insert failed silently and was reported
 * as "not agentic"; once that was fixed the reservation insert threw
 * `42501 — new row violates row-level security policy for
 * billing_credit_reservations`; behind it the run-row insert would have thrown
 * next. The full policy table above was read from production rather than
 * discovered one refusal at a time.
 *
 * ## Persisting an ExecutionSpec
 *
 * ### Why this is here rather than beside the preflight that builds the spec
 *
 * Because `execution_specs` has a select policy and **no insert policy at all**,
 * on purpose. The migration says why:
 *
 * > a client cannot forge a mode, a base SHA, a tool policy or a Credit
 * > ceiling; a client cannot raise its own Credit ceiling; a client cannot turn
 * > a blocked step into a ready one.
 *
 * RLS cannot tell a Server Action apart from a browser holding the public anon
 * key, so an owner insert policy would hand exactly those four forgeries to
 * anyone with a console open. The only sanctioned way to write server-owned
 * state is the service-role client, and Rule 53 confines that to
 * `src/modules/operations/`. So the write lives here, and the module that
 * *builds* the spec stays a pure read path.
 *
 * The same migration comment already specified this design — "specs are created
 * by the server-only service using the service-role client … with ownership
 * taken from the persisted project row rather than from a caller". The website
 * gate shipped pointing at the caller's own client instead, so every insert was
 * silently refused and the surface reported the step as not eligible while
 * simultaneously saying Vibe could build it. Nothing caught it because the
 * in-memory test double has no RLS: the write "succeeded" in every test and had
 * never once succeeded in production.
 *
 * ## The ownership check is the whole safety argument
 *
 * A service-role client bypasses RLS, so the check RLS would have made has to
 * be made here, explicitly, against the **persisted project row** — never
 * against anything the caller passed alongside it. A spec for a project the
 * session does not own is refused before a row exists.
 */

export type PersistExecutionSpecResult =
  | { ok: true; executionSpecId: string; alreadyExisted: boolean }
  | { ok: false; error: "project_not_found" | "spec_not_persisted" };

export async function persistAgentExecutionSpec(params: {
  spec: ExecutionSpec;
  userId: string;
  repositoryConnectionId: string;
  creditQuoteId?: string | null;
}): Promise<PersistExecutionSpecResult> {
  const supabase = createServiceClient();

  // Ownership is the query, and it runs against the stored row. Another user's
  // project is invisible rather than forbidden, exactly as `startAgentExecution`
  // establishes it one step later.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.spec.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "project_not_found" };

  const created = await recordExecutionSpec(supabase, {
    spec: params.spec,
    userId: params.userId,
    repositoryConnectionId: params.repositoryConnectionId,
    creditQuoteId: params.creditQuoteId ?? null,
  });

  if (!created.ok) {
    // Loud, because the silent version of this is what shipped: a swallowed
    // insert failure became "this step isn't the kind of change Vibe can
    // attempt", and no log line existed to contradict it.
    console.error("[agent-execution.spec] could not persist an ExecutionSpec", {
      projectId: params.spec.projectId,
      specIdentity: params.spec.identity,
      reason: created.error,
    });
    return { ok: false, error: "spec_not_persisted" };
  }

  return {
    ok: true,
    executionSpecId: created.stored.id,
    alreadyExisted: created.alreadyExisted,
  };
}


/**
 * Holds the Credits a run may spend, before any work is enqueued (§18, §55).
 *
 * The reservation, its ledger entry and its lot allocations are all server-owned
 * financial state: `billing_credit_reservations`, `billing_credit_ledger` and
 * `billing_credit_allocations` each carry a select policy and no write policy at
 * all. A hold taken with the caller's cookie-scoped client is refused with
 * `42501`, which is exactly what Run with Vibe did.
 *
 * `operations/service.ts` already takes every other hold this way, with the same
 * reasoning in a comment beside it. The agent path simply never did.
 *
 * Idempotent on the operation run id, so a retried request finds the existing
 * hold rather than taking a second one.
 */
export async function holdAgentExecutionCredits(params: {
  projectId: string;
  userId: string;
  operationRunId: string;
  /** The class the spec was built at, and the class the price is taken from. */
  pricingClass: ExecutionPricingClass;
  /**
   * Which book governs this run, taken from the resolved economics rather than
   * inferred here.
   *
   * `credits/internal.ts` and `credits/retail.ts` are deliberately separate
   * books, and the caller has already asked `resolveAgentEconomics` which one
   * applies. Re-deciding it here would be a second answer to a question that
   * already has one, and the failure mode is a customer charged out of the
   * internal dogfood ceiling — or, worse, a dogfood run charged at retail.
   */
  nonProduction: boolean;
  /** The quote recorded immediately before this hold, when one was written. */
  quoteId?: string | null;
  now?: Date;
}): Promise<AuthorizeOperationCreditsResult> {
  const supabase = createServiceClient();

  const owned = await ownsProject(supabase, { projectId: params.projectId, userId: params.userId });
  if (!owned) {
    return {
      ok: false,
      refusal: "account_not_found",
      requiredCredits: ZERO_CREDITS,
      availableCredits: ZERO_CREDITS,
    };
  }

  return authorizeOperationCredits(supabase, {
    projectId: params.projectId,
    operation: params.nonProduction ? "agent_execution_dogfood" : "agent_execution",
    pricingClass: params.pricingClass,
    quoteId: params.quoteId ?? null,
    idempotencyKey: params.operationRunId,
    operationRunId: params.operationRunId,
    now: params.now,
  });
}

/**
 * Records what the customer was quoted, immediately before the hold (ADR 0024 §4).
 *
 * ## Why a quote at all, when the price is fixed
 *
 * Because "200 Credits" and "200 Credits, because this step touches one named
 * business surface" are the same number and different claims, and only the
 * second is one a customer can check. The `assumptions` carry the class and the
 * classifier's own reason, so a run's price stays explainable after the policy
 * that produced it has been superseded.
 *
 * `estimated` equals `maximum` on purpose. A class price is knowable before the
 * agent spends anything and does not move with how the run goes — that is the
 * whole point of pricing a class rather than a cost (ADR 0038). A quote whose
 * ceiling exceeded its estimate would imply a variability this price does not
 * have.
 *
 * A quote authorizes nothing; the reservation does. Failing to write one must
 * therefore never fail the run, which is why this returns null rather than
 * throwing — the customer's money is governed by the hold that follows.
 */
export async function quoteAgentExecutionCredits(params: {
  projectId: string;
  userId: string;
  operationRunId: string;
  credits: CreditUnits;
  pricingClass: ExecutionPricingClass;
  pricingClassReason: ExecutionPricingClassReason;
  policyVersion: string;
  budgetPolicyVersion: string;
}): Promise<string | null> {
  const supabase = createServiceClient();

  const owned = await ownsProject(supabase, { projectId: params.projectId, userId: params.userId });
  if (!owned) return null;

  try {
    const quote = await quoteCredits(supabase, {
      userId: params.userId,
      projectId: params.projectId,
      operationType: "agent_execution",
      estimatedCredits: params.credits,
      maximumCredits: params.credits,
      rateCardVersion: params.policyVersion,
      assumptions: {
        pricingClass: params.pricingClass,
        pricingClassReason: params.pricingClassReason,
        pricingClassPolicyVersion: EXECUTION_PRICING_CLASS_POLICY_VERSION,
        budgetPolicyVersion: params.budgetPolicyVersion,
        operationRunId: params.operationRunId,
      },
    });

    return quote.id;
  } catch {
    // Deliberately swallowed. A quote is a record of what was shown, not an
    // authority over what is spent — see the docblock. Losing one costs
    // explainability, and failing the run over it would cost the customer the
    // work they asked for.
    return null;
  }
}

/**
 * Claims the one agent run row for this operation (§56).
 *
 * `agent_execution_runs` has a select policy and no insert policy: a client that
 * could write one could claim a run for a spec it never resolved, against a
 * budget policy it chose. The row's unique index on the run identity is what
 * makes a double-click one run, and that guarantee is only worth anything if the
 * row is server-written.
 */
export async function claimAgentExecutionRunRow(
  params: Omit<Parameters<typeof claimAgentExecutionRun>[1], never>,
): Promise<ClaimAgentRunResult> {
  const supabase = createServiceClient();

  const owned = await ownsProject(supabase, {
    projectId: params.projectId,
    userId: params.userId,
  });
  // `unknown` rather than a bespoke code: the caller turns any refusal into a
  // failed operation, and inventing a fourth outcome for "you do not own this"
  // would leak the existence of somebody else's project.
  if (!owned) return { ok: false, error: "unknown", message: "project not found for this session" };

  return claimAgentExecutionRun(supabase, params);
}

/**
 * The check RLS would have made, made explicitly.
 *
 * Against the stored project row and the session's own user id — never against
 * a value the caller supplied alongside the thing being written.
 */
async function ownsProject(
  supabase: ReturnType<typeof createServiceClient>,
  params: { projectId: string; userId: string },
): Promise<boolean> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  return Boolean(data);
}

/* ---------------------------------------------------------------------------
 * The backstop: a run that nothing is carrying any more (ADR 0029, A1)
 * ------------------------------------------------------------------------ */

/**
 * How long past its own wall clock a run may sit before it is presumed dead.
 *
 * Generous, because being wrong in one direction is much worse than the other:
 * failing a run that was merely slow throws away work a customer paid for,
 * while leaving a genuinely dead one a few minutes longer costs nothing. The
 * sandbox is bounded independently and expires on its own.
 */
const STALE_RUN_GRACE_MS = 10 * 60 * 1000;

/**
 * Fails a run whose workflow stopped carrying it, and releases its Credits.
 *
 * ## Why this exists at all
 *
 * The polling loop terminates every run it is watching. What it cannot do is
 * survive the *workflow itself* dying — and that is exactly what happened to
 * the first real run: the step was killed at 300 seconds, nothing reached
 * cleanup, and hours later the run still read `running` with 100 Credits held.
 *
 * A durable execution that can leave a customer's Credits reserved forever is
 * not one, so there has to be an answer that does not depend on the workflow
 * being alive to give it. This is that answer: a read path notices, and repairs.
 *
 * ## Why on a read rather than a schedule
 *
 * Because the read is the moment it matters. Somebody is looking at this run's
 * status; the alternative is a cron this product does not have and would need a
 * decision to introduce (rule 24). It is bounded, idempotent and scoped to one
 * operation — `failAgentRun` and `releaseOperationCredits` are both no-ops on a
 * run that is already terminal, so a hundred page loads repair it once.
 *
 * Service-role, because `agent_execution_runs` and the billing tables accept no
 * write from a browser's client and must not (Rule 53).
 */
export async function expireStaleAgentExecution(params: {
  operationRunId: string;
  /** Injected so a test can be explicit about time rather than sleeping. */
  now?: () => number;
}): Promise<{ expired: boolean }> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("agent_execution_runs")
    .select("id, project_id, status, started_at, credit_reservation_id")
    .eq("operation_run_id", params.operationRunId)
    .maybeSingle();

  const run = data as
    | {
        id: string;
        project_id: string;
        status: string;
        started_at: string | null;
        credit_reservation_id: string | null;
      }
    | null;

  // Only a run that is genuinely mid-flight can be stale. `queued` is not: it
  // has taken no provider call yet and its workflow may simply not have picked
  // it up, and failing that would race a run that is about to start.
  if (!run || run.status !== "running" || !run.started_at) return { expired: false };

  const startedAt = Date.parse(run.started_at);
  if (!Number.isFinite(startedAt)) return { expired: false };

  /*
   * The bound is the sandbox's lifetime, not the agent's wall clock.
   *
   * Reading the run's own budget here would mean loading its spec on every
   * status render. The sandbox is the outer bound on any run — the harness
   * cannot outlive the VM it is in — so a run past that plus grace is dead
   * whatever its budget said.
   */
  const deadline = startedAt + AGENT_SANDBOX_LIFETIME_MS + STALE_RUN_GRACE_MS;
  if ((params.now ?? Date.now)() < deadline) return { expired: false };

  console.error("[agent-execution] expiring a run nothing is carrying", {
    operationRunId: params.operationRunId,
    agentExecutionRunId: run.id,
    startedAt: run.started_at,
  });

  const failed = await failAgentRun(supabase, {
    runId: run.id,
    failureCode: "agent_provider_failed",
  });

  /*
   * Losing the swap means the workflow was alive after all and finished first.
   *
   * The status read above is a read-then-act across three writes, and the
   * workflow finalizes from its own process — so between that read and this
   * swap the run can legitimately complete. Whoever wins the swap owns the
   * billing finalization; this attempt lost, so it releases nothing and reports
   * that it expired nothing.
   *
   * Without this, both processes finalized: E2b measured a charge standing
   * against a hold recorded as released, 20 times out of 20, against real
   * PostgreSQL.
   */
  if (!failed) return { expired: false };

  await failOperationRun(supabase, {
    operationId: params.operationRunId,
    failureCode: "agent_wall_clock_exceeded",
  });

  // Nothing was delivered, so nothing is charged. Release is idempotent: a
  // reservation already settled or released stays as it is.
  if (run.credit_reservation_id) {
    await releaseOperationCredits(supabase, {
      reservationId: run.credit_reservation_id,
      reason: "abandoned_with_usage",
    });
  }

  return { expired: true };
}
