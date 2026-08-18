import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { ZERO_CREDITS } from "@/modules/credits/units";
import { claimAgentExecutionRun, type ClaimAgentRunResult } from "@/modules/coding-agent/store";
import { authorizeOperationCredits, type AuthorizeOperationCreditsResult } from "@/modules/credits/operation-billing";
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
    operation: "agent_execution_dogfood",
    idempotencyKey: params.operationRunId,
    operationRunId: params.operationRunId,
  });
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
