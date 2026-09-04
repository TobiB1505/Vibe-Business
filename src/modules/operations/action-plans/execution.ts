import "server-only";
import { releaseOperationBilling, settleOperationBilling } from "../billing";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTION_PLANNING_CONFIG } from "@/modules/ai/operations";
import { recordAIUsage } from "@/modules/ai/usage";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { ACTION_PLANNER_PROMPT_VERSION } from "@/modules/action-plans/prompt";
import { ACTION_PLANNER_RUBRIC_VERSION } from "@/modules/action-plans/rubric";
import {
  ACTION_PLANNER_CONTRACT_VERSION,
  ACTION_PLANNER_VERSION,
  ACTION_PLAN_SCHEMA_VERSION,
} from "@/modules/action-plans/schema";
import {
  buildActionPlanRequest,
  buildPlannerPack,
  runActionPlanning,
} from "@/modules/action-plans/runner";
import { resolvePlannerSource, type PlannerSource } from "@/modules/action-plans/source";
import { trimPlannerEvidence } from "@/modules/action-plans/evidence";
import {
  completeActionPlanRun,
  computeActionPlanInputHash,
  createActionPlanRun,
  failActionPlanRun,
  getActionPlanById,
} from "@/modules/action-plans/store";
import {
  buildEvidencePackForVersion,
  type BuildEvidencePackV3Input,
  type EvidencePackV3,
} from "@/modules/business-audit/evidence-v3";
import { verifyPackProvenance } from "@/modules/business-audit/pack-provenance";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestCompletedOpportunitySet } from "@/modules/opportunities/store";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { ExecutionDeps, StepOutcome } from "../business-audit/execution";
import type { OperationFailureCode } from "../failures";
import {
  claimResultForOperation,
  completeOperationRun,
  failOperationRun,
  getProjectOperationRunById,
  markInferenceStarted,
  setOperationStage,
  type ProjectOperationRun,
} from "../store";

/**
 * Durable step bodies for action planning (CORE-2b §51, §54, §55).
 *
 * The same four-step shape as the Business Audit and the Opportunity Engine,
 * for the same reasons — this is the fourth consumer of one execution
 * foundation, not a fourth mechanism. What differs is only what the steps load
 * and what they persist.
 *
 * The safety properties are unchanged and are not re-argued here: expected
 * failures are returned rather than thrown so the platform cannot retry them,
 * inference and persistence share one non-retried step, and
 * `inference_started_at` is written before the paid call so an ambiguous
 * re-entry fails rather than buying a second one. See
 * `../business-audit/execution.ts` for the full reasoning.
 *
 * Crossing the durable boundary: an operation id, a token count, a plan id, a
 * typed failure code. No evidence, no prompt, no plan text (Rule 52).
 */

type PlanSources = {
  source: PlannerSource;
  pack: EvidencePackV3;
  repository: RepositoryIntelligenceSnapshot;
  auditId: string;
  opportunitySetId: string;
  productProfileId: string;
  founderIntentHash: string;
  evidencePackVersion: string;
  inputHash: string;
};

async function loadOperation(
  supabase: SupabaseClient,
  operationId: string,
): Promise<StepOutcome<{ operation: ProjectOperationRun }>> {
  const operation = await getProjectOperationRunById(supabase, operationId);
  if (!operation) return { ok: false, failureCode: "operation_not_found" };

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", operation.projectId)
    .maybeSingle();

  if (!project || (project as { user_id: string }).user_id !== operation.userId) {
    return { ok: false, failureCode: "project_not_found" };
  }

  return { ok: true, operation };
}

/**
 * Rebuilds the Move, the audit judgment under it, and the evidence pack.
 *
 * Rebuilt from the stored rows rather than carried through workflow state, so
 * no evidence and no plan text is written into the execution provider's durable
 * log (Rule 52). Rebuilding is deterministic: the same rows produce the same
 * pack, and therefore the same evidence ids the audit and the Move cited.
 */
async function loadSources(
  supabase: SupabaseClient,
  operation: ProjectOperationRun,
): Promise<StepOutcome<PlanSources>> {
  const audit = await getLatestSuccessfulAudit(supabase, operation.projectId);
  if (!audit?.result) return { ok: false, failureCode: "audit_missing" };

  const [opportunitySet, repositorySnapshot, liveSnapshot, profile, founderIntent, authenticated] =
    await Promise.all([
      getLatestCompletedOpportunitySet(supabase, operation.projectId),
      getLatestSuccessfulSnapshot(supabase, operation.projectId),
      getLatestSuccessfulLiveSnapshot(supabase, operation.projectId),
      getLatestProfile(supabase, operation.projectId),
      getFounderIntent(supabase, operation.projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, operation.projectId),
    ]);

  if (!opportunitySet) return { ok: false, failureCode: "move_missing" };
  if (!repositorySnapshot?.result) {
    return { ok: false, failureCode: "repository_intelligence_missing" };
  }
  if (!liveSnapshot?.result) return { ok: false, failureCode: "live_product_intelligence_missing" };
  // The pack is rebuilt so citations resolve against the same ids the audit
  // saw. Without the profile it would be a different pack.
  if (!profile) return { ok: false, failureCode: "product_profile_missing" };

  // The operation carries the Move it was created for (§83, mirrors
  // `change-preparation/execution.ts`) — re-resolved from the *current* set
  // rather than trusted from creation time, so a Move that has since
  // disappeared blocks instead of silently resolving to whatever is rank 1
  // now.
  if (!operation.subjectId) return { ok: false, failureCode: "move_missing" };
  const move = opportunitySet.opportunities.find((entry) => entry.id === operation.subjectId);
  if (!move) return { ok: false, failureCode: "move_not_found" };

  /*
   * The source gate, re-checked inside the durable step (FIX §7, §9).
   *
   * Readiness already refused an unresolvable Move before this operation was created,
   * and this is not that check repeated for tidiness: the audit or the Move set can be
   * superseded between the click and the step, and a plan must never be produced for a
   * Move whose business problem cannot be named. It runs in step 1, before token
   * counting and long before the paid call.
   */
  const source = resolvePlannerSource(audit.result, move);
  if (!source.resolved) return { ok: false, failureCode: "planner_source_unresolved" };

  const inputHash = computeActionPlanInputHash({
    auditId: audit.id,
    auditInputHash: audit.inputHash,
    opportunitySetId: opportunitySet.id,
    opportunityId: move.id,
    conclusionKey: source.source.conclusionKey,
    productProfileId: profile.stored.id,
    founderIntentHash: founderIntent.intentHash,
    evidencePackVersion: audit.result.evidencePackVersion,
    contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    plannerVersion: ACTION_PLANNER_VERSION,
    promptVersion: ACTION_PLANNER_PROMPT_VERSION,
    rubricVersion: ACTION_PLANNER_RUBRIC_VERSION,
    schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
    provider: "anthropic",
    model: ACTION_PLANNING_CONFIG.model,
  });

  // The audit or the Moves can be superseded between the click and the step.
  // Planning a different Move than the operation was created for would produce
  // a plan the user never asked for, so it ends the operation instead.
  if (inputHash !== operation.inputIdentity) {
    return { ok: false, failureCode: "inputs_changed" };
  }

  /*
   * And the *evidence* can be superseded without the audit being.
   *
   * The hash above carries the profile and the founder intent, so it catches
   * those moving between the click and this step. It carries no snapshot id, so
   * it does not catch a scan finishing — and the pack rebuilt below is built
   * from whatever `getLatestSuccessfulSnapshot` returns now, not from what the
   * audit reasoned over. Planning against one run's diagnosis using another
   * run's evidence is a paid call about a state that no longer exists. See
   * `business-audit/pack-provenance.ts`.
   */
  const provenance = verifyPackProvenance(audit, {
    repositorySnapshotId: repositorySnapshot.id,
    liveSnapshotId: liveSnapshot.id,
    productProfileId: profile.stored.id,
    founderIntentHash: founderIntent.intentHash,
    // Null when no Deep Scan exists, which is a real state and not a gap. The
    // audit's own identity hash distinguishes it from every possible id.
    authenticatedSnapshotId: authenticated?.id ?? null,
  });
  if (!provenance.matches) return { ok: false, failureCode: "inputs_changed" };

  const sources: BuildEvidencePackV3Input = {
    productProfile: profile.profile,
    founderIntent: founderIntent.intent,
    repository: repositorySnapshot.result,
    liveProduct: liveSnapshot.result,
    authenticatedProduct: authenticated?.result ?? null,
  };

  return {
    ok: true,
    source: source.source,
    /*
     * The audit's own version, so its citations resolve — read from the
     * **document**, exactly as the two lines below it and the Opportunity
     * engine do.
     *
     * This read `audit.evidencePackVersion`, the row column, while
     * `evidencePackVersion` three lines down recorded `audit.result`'s. The two
     * disagreed from 2026-08-24: the column said v3 while the pack the model
     * had seen was v4. So the planner rebuilt a pack with no contradictions and
     * polarity-free surface ids for an audit that cited one contradiction id
     * and seven absence ids, and then stamped the plan v4. Both stored plans
     * cite zero ids from either namespace, across twenty-six citations.
     */
    pack: buildEvidencePackForVersion(sources, audit.result.evidencePackVersion),
    repository: repositorySnapshot.result,
    auditId: audit.id,
    opportunitySetId: opportunitySet.id,
    productProfileId: profile.stored.id,
    founderIntentHash: founderIntent.intentHash,
    evidencePackVersion: audit.result.evidencePackVersion,
    inputHash,
  };
}

/** Step 1 — verify ownership and the source judgment, and claim the plan row. */
export async function prepareActionPlanStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ planId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  if (operation.resultId) return { ok: true, planId: operation.resultId };

  await setOperationStage(deps.supabase, { operationId, stage: "preparing", markRunning: true });

  const resolved = await loadSources(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const run = await createActionPlanRun(deps.supabase, {
    projectId: operation.projectId,
    businessAuditId: resolved.auditId,
    opportunitySetId: resolved.opportunitySetId,
    opportunityId: resolved.source.opportunity.id,
    inputHash: resolved.inputHash,
    rootProblem: resolved.source.conclusion.rootProblem,
    lenses: resolved.source.conclusion.lenses,
    // The exact conclusion this plan was built to move, and how it was established.
    // Recorded at claim time so the chain is queryable even for a run that fails (§24).
    sourceConclusionKey: resolved.source.conclusionKey,
    sourceConclusionLineage: resolved.source.lineage,
    productProfileId: resolved.productProfileId,
    founderIntentHash: resolved.founderIntentHash,
    schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
    contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    plannerVersion: ACTION_PLANNER_VERSION,
    promptVersion: ACTION_PLANNER_PROMPT_VERSION,
    rubricVersion: ACTION_PLANNER_RUBRIC_VERSION,
    evidencePackVersion: resolved.evidencePackVersion,
    provider: "anthropic",
    model: ACTION_PLANNING_CONFIG.model,
  });

  if (!run.ok) {
    return {
      ok: false,
      failureCode: run.error === "already_running" ? "already_running" : "action_planning_failed",
    };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: run.planId });

  return { ok: true, planId: run.planId };
}

/** Step 2 — the budget gate, measuring the exact request that will be billed. */
export async function countActionPlanTokensStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ estimatedInputTokens: number }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "counting_tokens" });

  const resolved = await loadSources(deps.supabase, loaded.operation);
  if (!resolved.ok) return resolved;

  const config = ACTION_PLANNING_CONFIG;
  const pack = buildPlannerPack({ source: resolved.source, pack: resolved.pack });
  const counted = await deps.provider.countInputTokens(
    buildActionPlanRequest(resolved.source, pack, config),
  );
  if (!counted.ok) return { ok: false, failureCode: counted.error };

  if (counted.inputTokens > config.maxInputTokens) {
    const floor = await deps.provider.countInputTokens(
      buildActionPlanRequest(resolved.source, trimPlannerEvidence(pack), config),
    );
    if (!floor.ok) return { ok: false, failureCode: floor.error };
    if (floor.inputTokens > config.maxInputTokens) {
      return { ok: false, failureCode: "action_plan_input_budget_exceeded" };
    }
  }

  return { ok: true, estimatedInputTokens: counted.inputTokens };
}

/** Step 3 — the paid call, its validation, and its persistence, as one step. */
export async function runPlanningStep(
  deps: ExecutionDeps,
  operationId: string,
  estimatedInputTokens: number,
): Promise<StepOutcome<{ planId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  if (!operation.resultId) return { ok: false, failureCode: "action_planning_failed" };

  const existing = await getActionPlanById(deps.supabase, operation.resultId);
  if (existing?.status === "completed") return { ok: true, planId: existing.id };
  if (existing?.status === "failed") {
    return {
      ok: false,
      failureCode: (existing.failureCode as OperationFailureCode) ?? "action_planning_failed",
    };
  }

  // A paid call was started and its outcome never recorded. It may have been
  // billed. Refuse rather than buy a second one (§55).
  if (operation.inferenceStartedAt !== null) {
    return { ok: false, failureCode: "inference_interrupted" };
  }

  const resolved = await loadSources(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const config = ACTION_PLANNING_CONFIG;

  await setOperationStage(deps.supabase, { operationId, stage: "planning" });
  await markInferenceStarted(deps.supabase, operationId);

  const outcome = await runActionPlanning({
    provider: deps.provider,
    config,
    source: resolved.source,
    pack: resolved.pack,
    repository: resolved.repository,
  });

  await recordAIUsage(deps.supabase, {
    userId: operation.userId,
    projectId: operation.projectId,
    operation: config.operation,
    provider: deps.provider.name,
    model: config.model,
    jobId: operation.resultId,
    status: outcome.ok ? "succeeded" : "failed",
    usage: outcome.usage,
    estimatedInputTokens: outcome.estimatedInputTokens ?? estimatedInputTokens,
    latencyMs: outcome.latencyMs,
    failureCode: outcome.ok ? null : outcome.error,
  });

  if (!outcome.ok) {
    // The audit, the Move and any previous plan are untouched: this run owns
    // only its own row, and failing it leaves nothing half-valid current (§55).
    await failActionPlanRun(deps.supabase, operation.resultId, outcome.error);
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "action_plan.failed",
      metadata: {
        projectId: operation.projectId,
        actionPlanId: operation.resultId,
        operationId,
        reason: outcome.error,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
      },
    });
    return { ok: false, failureCode: outcome.error };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "validating" });
  await setOperationStage(deps.supabase, { operationId, stage: "persisting" });
  await completeActionPlanRun(
    deps.supabase,
    operation.resultId,
    outcome.plan,
    outcome.findings,
  );

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "action_plan.completed",
    metadata: {
      projectId: operation.projectId,
      actionPlanId: operation.resultId,
      operationId,
      auditId: resolved.auditId,
      opportunityId: resolved.source.opportunity.id,
      conclusionKey: resolved.source.conclusionKey,
      conclusionLineage: resolved.source.lineage,
      model: config.model,
      promptVersion: ACTION_PLANNER_PROMPT_VERSION,
      stepCount: outcome.plan.steps.length,
      // Codes, never prose. Enough to spot a planner regression across runs
      // without putting plan text into the audit log.
      validationFindings: outcome.findings,
    },
  });

  return { ok: true, planId: operation.resultId };
}

/** Step 4 — finish, idempotently. */
export async function completeActionPlanOperationStep(
  deps: ExecutionDeps,
  operationId: string,
  planId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, { operationId, resultId: planId });
  if (!transitioned) return;

  /*
   * The customer is charged here, and only here (BILLING CORE-2 §39, §79).
   *
   * After the terminal transition, which is guarded so it happens at most once
   * — so the charge inherits exactly-once from the state machine rather than
   * needing its own guard, and is idempotent underneath it regardless. A free
   * or entitlement-funded run has no reservation and this does nothing.
   */
  await settleOperationBilling(deps.supabase, { operationRunId: operationId });

  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.completed",
    metadata: {
      projectId: operation.projectId,
      operationId,
      operationType: operation.operationType,
    },
  });
}

export async function failActionPlanOperationStep(
  deps: ExecutionDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned) return;

  /*
   * The hold goes back (BILLING CORE-2 §45, §80).
   *
   * The approved V1 failure policy: a Vibe failure, a provider failure and a
   * run that produced nothing usable are all 0 charged. Vibe absorbs whatever
   * it already paid the provider, and `abandoned_with_usage` records that this
   * is what happened rather than pretending the run was free to Vibe too.
   *
   * No reservation is ever left stranded: this runs on every terminal failure.
   */
  await releaseOperationBilling(deps.supabase, {
    operationRunId: operationId,
    providerUsageOccurred: true,
  });

  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.failed",
    metadata: {
      projectId: operation.projectId,
      operationId,
      operationType: operation.operationType,
      reason: failureCode,
    },
  });
}
