import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { checkBudgetBinding, type BoundReservation, type ExecutionBudget } from "./budget";
import { buildExecutionSpec, type BuildExecutionSpecInput, type ExecutionSpec } from "./spec";
import { insertExecutionSpec, type StoredExecutionSpec } from "./store";
import { type ExecutionAdmission, type ExecutionResolution } from "./schema";

/**
 * The execution-contract domain API (EXECUTION CORE-3 §35, §54).
 *
 * Callers get these two operations and nothing lower level. There is
 * deliberately no exported way to write a spec row directly, and no exported
 * way to widen a policy: the invariants belong to `spec.ts` and `policy.ts`,
 * and an API that let a caller assemble a row by hand would make both advisory.
 *
 * ## Server-only, and reachable from no client
 *
 * `execution_specs` has no insert policy, so a browser holding an authenticated
 * anon-key token cannot create a spec even if a route handler were added by
 * mistake. This module is the other half of that: it is `server-only`, it
 * derives every stored field from the validated spec document, and it takes no
 * caller-supplied mode, SHA, policy or Credit ceiling.
 */

export type CreateExecutionSpecResult =
  | { ok: true; stored: StoredExecutionSpec; alreadyExisted: boolean }
  | { ok: false; error: string };

/**
 * Builds and records one immutable spec (§10, §35).
 *
 * The ordering matters: the spec is *built* first — which is where the mode
 * check, the secret guard and the policy compilation happen — and only a
 * successfully built spec is written. A row can therefore never exist for work
 * that was not resolvable, and the document and its indexed columns can never
 * disagree, because the columns are read off the document.
 *
 * The audit event carries identifiers, versions and a Credit ceiling. Never the
 * objective's text, never the policy, never a base SHA's contents, and never
 * anything a model produced (§35).
 */
export async function createExecutionSpec(
  supabase: SupabaseClient,
  params: BuildExecutionSpecInput & {
    userId: string;
    repositoryConnectionId: string;
    creditQuoteId?: string | null;
  },
): Promise<CreateExecutionSpecResult> {
  return recordExecutionSpec(supabase, { ...params, spec: buildExecutionSpec(params) });
}

/**
 * Records a spec that has already been built (§10, §35).
 *
 * Split out from {@link createExecutionSpec} because building and persisting
 * are different acts with different costs. Building is pure — it runs the mode
 * check, the secret guard and the policy compiler, and produces the document a
 * screen can render in full. Persisting writes an immutable, permanently
 * auditable row.
 *
 * The internal dogfood surface conflated them: it persisted a spec on every
 * page *render*, which is both a write on a read path and a write the caller's
 * cookie-scoped client can never perform — `execution_specs` has a select
 * policy and deliberately no insert policy, so a browser cannot forge a mode, a
 * base SHA, a policy or a Credit ceiling. Rendering a preview now builds; only
 * a start persists, through the service-role writer in
 * `operations/agent-execution/spec.ts`.
 */
export async function recordExecutionSpec(
  supabase: SupabaseClient,
  params: {
    spec: ExecutionSpec;
    userId: string;
    repositoryConnectionId: string;
    creditQuoteId?: string | null;
    budget?: BuildExecutionSpecInput["budget"];
  },
): Promise<CreateExecutionSpecResult> {
  const { spec } = params;

  const result = await insertExecutionSpec(supabase, {
    spec,
    repositoryConnectionId: params.repositoryConnectionId,
    creditQuoteId: params.creditQuoteId ?? null,
    // Read off the spec rather than off a second argument: the document is the
    // authority, and a column that could disagree with it is a column that
    // eventually will.
    maxAuthorizedCredits: spec.budget?.maxCredits ?? null,
  });

  if (!result.ok) return result;

  if (!result.alreadyExisted) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      projectId: spec.projectId,
      eventType: "execution.spec_created",
      metadata: {
        projectId: spec.projectId,
        executionSpecId: result.spec.id,
        specIdentity: spec.identity,
        actionPlanId: spec.actionPlanId,
        stepOrder: spec.stepOrder,
        mode: spec.mode,
        riskClass: spec.riskClass,
        maxAuthorizedCredits: spec.budget?.maxCredits ?? null,
        resolverVersion: spec.resolverVersion,
        policyVersion: spec.policyVersion,
      },
    });
  }

  return { ok: true, stored: result.spec, alreadyExisted: result.alreadyExisted };
}

/**
 * Whether a spec may actually start right now (§24, §26, §49).
 *
 * Two independent authorities, and neither substitutes for the other — the same
 * shape ADR 0019 requires for a merge:
 *
 * ```
 * the resolution's admission   live external state: HEAD, snapshot, plan currency
 * the budget binding           money: an active reservation covering the ceiling
 * ```
 *
 * A resolution alone would start work nobody funded; a reservation alone would
 * start work against a repository that has moved. Both are re-read here, at the
 * moment of asking, rather than inherited from whatever produced the spec.
 */
export function admitExecutionSpec(params: {
  spec: ExecutionSpec;
  resolution: ExecutionResolution;
  budget: ExecutionBudget | null;
  reservation: BoundReservation | null;
}): ExecutionAdmission {
  if (!params.resolution.admission.admissible) return params.resolution.admission;

  // Deterministic capability execution is not agent work and is not
  // quote-based: it is Vibe's own generator, already priced as part of the
  // operation that runs it. Only agentic work needs a Credit ceiling bound
  // here (§24).
  if (params.spec.mode !== "agentic") return { admissible: true };

  const binding = checkBudgetBinding({
    budget: params.budget,
    reservation: params.reservation,
  });

  return binding.ok ? { admissible: true } : { admissible: false, refusal: binding.refusal };
}
