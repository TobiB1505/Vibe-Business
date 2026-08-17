import "server-only";

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
import {
  defaultPlannedOpportunity,
  resolvePlannerSource,
  type PlannerSource,
} from "@/modules/action-plans/source";
import { trimPlannerEvidence } from "@/modules/action-plans/evidence";
import {
  completeActionPlanRun,
  computeActionPlanInputHash,
  createActionPlanRun,
  failActionPlanRun,
  getActionPlanById,
} from "@/modules/action-plans/store";
import {
  buildEvidencePackV3,
  type BuildEvidencePackV3Input,
  type EvidencePackV3,
} from "@/modules/business-audit/evidence-v3";
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
  getOperationRunById,
  markInferenceStarted,
  setOperationStage,
  type StoredOperationRun,
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
): Promise<StepOutcome<{ operation: StoredOperationRun }>> {
  const operation = await getOperationRunById(supabase, operationId);
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
  operation: StoredOperationRun,
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

  const move = defaultPlannedOpportunity(opportunitySet.opportunities);
  if (!move) return { ok: false, failureCode: "move_missing" };

  const inputHash = computeActionPlanInputHash({
    auditId: audit.id,
    auditInputHash: audit.inputHash,
    opportunitySetId: opportunitySet.id,
    opportunityId: move.id,
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

  const sources: BuildEvidencePackV3Input = {
    productProfile: profile.profile,
    founderIntent: founderIntent.intent,
    repository: repositorySnapshot.result,
    liveProduct: liveSnapshot.result,
    authenticatedProduct: authenticated?.result ?? null,
  };

  return {
    ok: true,
    source: resolvePlannerSource(audit.result, move),
    pack: buildEvidencePackV3(sources),
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
    rootProblem: resolved.source.conclusion?.rootProblem ?? null,
    lenses: resolved.source.conclusion?.lenses ?? [],
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

  const operation = await getOperationRunById(deps.supabase, operationId);
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

  const operation = await getOperationRunById(deps.supabase, operationId);
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
