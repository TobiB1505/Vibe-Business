import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPPORTUNITY_GENERATION_CONFIG } from "@/modules/ai/operations";
import { recordAIUsage } from "@/modules/ai/usage";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  buildEvidencePackV3,
  trimEvidencePackV3,
  type BuildEvidencePackV3Input,
} from "@/modules/business-audit/evidence-v3";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { OPPORTUNITY_PROMPT_VERSION } from "@/modules/opportunities/prompt";
import { OPPORTUNITY_RUBRIC_VERSION } from "@/modules/opportunities/rubric";
import {
  buildOpportunityRequest,
  runOpportunityGeneration,
} from "@/modules/opportunities/runner";
import {
  OPPORTUNITY_ENGINE_VERSION,
  OPPORTUNITY_SET_SCHEMA_VERSION,
} from "@/modules/opportunities/schema";
import {
  completeOpportunitySetRun,
  computeOpportunityInputHash,
  createOpportunitySetRun,
  failOpportunitySetRun,
  getOpportunitySetById,
} from "@/modules/opportunities/store";
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
import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";

/**
 * Durable step bodies for opportunity generation (Sprint 8 §24, §26).
 *
 * The same four-step shape as the Business Audit, and for the same reasons —
 * this sprint reuses the execution foundation rather than building a second
 * one. What differs is only what the steps load and what they persist.
 *
 * The safety properties are unchanged and are not re-argued here: expected
 * failures are returned rather than thrown so the platform cannot retry them,
 * inference and persistence share one non-retried step, and
 * `inference_started_at` is written before the paid call so an ambiguous
 * re-entry fails instead of buying a second one. See
 * `../business-audit/execution.ts` for the full reasoning.
 */

type OpportunitySources = {
  audit: BusinessReadinessAudit;
  auditId: string;
  sources: BuildEvidencePackV3Input;
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
 * Rebuilds the audit and the evidence pack it came from.
 *
 * The pack is rebuilt from the snapshots rather than carried through workflow
 * state, so no evidence is written into the execution provider's durable log
 * (Sprint 7 §14). Rebuilding is deterministic: the same rows produce the same
 * pack and therefore the same evidence ids the audit cited.
 */
async function loadSources(
  supabase: SupabaseClient,
  operation: StoredOperationRun,
): Promise<StepOutcome<OpportunitySources>> {
  const audit = await getLatestSuccessfulAudit(supabase, operation.projectId);
  if (!audit?.result) return { ok: false, failureCode: "audit_missing" };

  const [repositorySnapshot, liveSnapshot, profile, founderIntent, authenticatedSnapshot] =
    await Promise.all([
      getLatestSuccessfulSnapshot(supabase, operation.projectId),
      getLatestSuccessfulLiveSnapshot(supabase, operation.projectId),
      getLatestProfile(supabase, operation.projectId),
      getFounderIntent(supabase, operation.projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, operation.projectId),
    ]);

  if (!repositorySnapshot?.result) return { ok: false, failureCode: "repository_intelligence_missing" };
  if (!liveSnapshot?.result) return { ok: false, failureCode: "live_product_intelligence_missing" };
  // The same profile requirement as the audit, and for a sharper reason: this
  // rebuilds the audit's evidence pack so citations resolve against the same
  // ids the audit saw. Without the profile the pack would be a different pack.
  if (!profile) return { ok: false, failureCode: "product_profile_missing" };

  const inputHash = computeOpportunityInputHash({
    auditId: audit.id,
    auditInputHash: audit.inputHash,
    evidencePackVersion: audit.result.evidencePackVersion,
    engineVersion: OPPORTUNITY_ENGINE_VERSION,
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    rubricVersion: OPPORTUNITY_RUBRIC_VERSION,
    schemaVersion: OPPORTUNITY_SET_SCHEMA_VERSION,
    provider: "anthropic",
    model: OPPORTUNITY_GENERATION_CONFIG.model,
  });

  // The audit can be superseded between the click and the step. Prioritizing
  // a different diagnosis than the operation was created for would produce
  // advice the user never asked for, so it ends the operation instead.
  if (inputHash !== operation.inputIdentity) {
    return { ok: false, failureCode: "inputs_changed" };
  }

  return {
    ok: true,
    audit: audit.result,
    auditId: audit.id,
    inputHash,
    sources: {
      productProfile: profile.profile,
      founderIntent: founderIntent.intent,
      repository: repositorySnapshot.result,
      liveProduct: liveSnapshot.result,
      authenticatedProduct: authenticatedSnapshot?.result ?? null,
    },
  };
}

/** Step 1 — verify ownership and the audit, and claim the set row. */
export async function prepareOpportunitiesStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ setId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  if (operation.resultId) return { ok: true, setId: operation.resultId };

  await setOperationStage(deps.supabase, { operationId, stage: "preparing", markRunning: true });

  const resolved = await loadSources(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const config = OPPORTUNITY_GENERATION_CONFIG;
  const run = await createOpportunitySetRun(deps.supabase, {
    projectId: operation.projectId,
    businessAuditId: resolved.auditId,
    inputHash: resolved.inputHash,
    schemaVersion: OPPORTUNITY_SET_SCHEMA_VERSION,
    engineVersion: OPPORTUNITY_ENGINE_VERSION,
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    rubricVersion: OPPORTUNITY_RUBRIC_VERSION,
    evidencePackVersion: resolved.audit.evidencePackVersion,
    provider: "anthropic",
    model: config.model,
  });

  if (!run.ok) {
    return {
      ok: false,
      failureCode: run.error === "already_running" ? "already_running" : "opportunity_generation_failed",
    };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: run.setId });

  return { ok: true, setId: run.setId };
}

/** Step 2 — the budget gate, measuring the exact request that will be billed. */
export async function countOpportunityTokensStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ estimatedInputTokens: number }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "counting_tokens" });

  const resolved = await loadSources(deps.supabase, loaded.operation);
  if (!resolved.ok) return resolved;

  const config = OPPORTUNITY_GENERATION_CONFIG;
  const pack = buildEvidencePackV3(resolved.sources);
  const counted = await deps.provider.countInputTokens(
    buildOpportunityRequest(resolved.audit, pack, config),
  );
  if (!counted.ok) return { ok: false, failureCode: counted.error };

  if (counted.inputTokens > config.maxInputTokens) {
    const floor = await deps.provider.countInputTokens(
      buildOpportunityRequest(resolved.audit, trimEvidencePackV3(pack, 1), config),
    );
    if (!floor.ok) return { ok: false, failureCode: floor.error };
    if (floor.inputTokens > config.maxInputTokens) {
      return { ok: false, failureCode: "opportunity_input_budget_exceeded" };
    }
  }

  return { ok: true, estimatedInputTokens: counted.inputTokens };
}

/** Step 3 — the paid call, its validation, and its persistence, as one step. */
export async function runPrioritizationStep(
  deps: ExecutionDeps,
  operationId: string,
  estimatedInputTokens: number,
): Promise<StepOutcome<{ setId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  if (!operation.resultId) return { ok: false, failureCode: "opportunity_generation_failed" };

  const existing = await getOpportunitySetById(deps.supabase, operation.resultId);
  if (existing?.status === "completed") return { ok: true, setId: existing.id };
  if (existing?.status === "failed") {
    return {
      ok: false,
      failureCode: (existing.failureCode as OperationFailureCode) ?? "opportunity_generation_failed",
    };
  }

  // A paid call was started and its outcome never recorded. It may have been
  // billed. Refuse rather than buy a second one.
  if (operation.inferenceStartedAt !== null) {
    return { ok: false, failureCode: "inference_interrupted" };
  }

  const resolved = await loadSources(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const config = OPPORTUNITY_GENERATION_CONFIG;

  await setOperationStage(deps.supabase, { operationId, stage: "prioritizing" });
  await markInferenceStarted(deps.supabase, operationId);

  const outcome = await runOpportunityGeneration({
    provider: deps.provider,
    config,
    audit: resolved.audit,
    auditId: resolved.auditId,
    ...resolved.sources,
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
    await failOpportunitySetRun(deps.supabase, operation.resultId, outcome.error);
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "opportunities.failed",
      metadata: {
        projectId: operation.projectId,
        opportunitySetId: operation.resultId,
        operationId,
        reason: outcome.error,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
      },
    });
    return { ok: false, failureCode: outcome.error };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "validating" });
  await setOperationStage(deps.supabase, { operationId, stage: "persisting" });
  await completeOpportunitySetRun(deps.supabase, operation.resultId, outcome.set);

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "opportunities.completed",
    metadata: {
      projectId: operation.projectId,
      opportunitySetId: operation.resultId,
      operationId,
      auditId: resolved.auditId,
      model: config.model,
      promptVersion: OPPORTUNITY_PROMPT_VERSION,
      opportunityCount: outcome.set.opportunities.length,
    },
  });

  return { ok: true, setId: operation.resultId };
}

/** Step 4 — finish, idempotently. */
export async function completeOpportunityOperationStep(
  deps: ExecutionDeps,
  operationId: string,
  setId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, { operationId, resultId: setId });
  if (!transitioned) return;

  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.completed",
    metadata: { projectId: operation.projectId, operationId, operationType: operation.operationType },
  });
}

export async function failOpportunityOperationStep(
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
