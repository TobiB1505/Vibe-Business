import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_UNDERSTANDING_CONFIG } from "@/modules/ai/operations";
import type { AIProvider } from "@/modules/ai/provider";
import { recordAIUsage } from "@/modules/ai/usage";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import {
  UNDERSTANDING_EVIDENCE_VERSION,
  buildUnderstandingPack,
  trimUnderstandingPack,
  type BuildUnderstandingPackInput,
} from "@/modules/product-understanding/evidence";
import { PROMPT_VERSION } from "@/modules/product-understanding/prompt";
import {
  buildUnderstandingRequest,
  runProductUnderstanding,
} from "@/modules/product-understanding/runner";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
} from "@/modules/product-understanding/schema";
import {
  completeProfileRun,
  computeProfileInputHash,
  createProfileRun,
  failProfileRun,
  getProfileById,
} from "@/modules/product-understanding/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
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
 * Product Understanding's durable step bodies (CORE-1 §22).
 *
 * Plain async functions taking their dependencies as arguments, exactly as the
 * Business Audit's do. The workflow file wraps each in a `"use step"` shim and
 * nothing else, which keeps the understanding pipeline testable without a
 * workflow platform.
 *
 * ## What crosses a step boundary
 *
 * An operation id, a token count, and a profile id. Nothing else. Every step
 * re-reads the operation row and rebuilds what it needs from the database, so
 * no evidence, prompt, or model output is ever written into the execution
 * provider's durable log (ADR 0013, CLAUDE.md rule 52).
 *
 * ## The one place this differs from the audit
 *
 * The audit fails when inference fails. This does not. The deterministic layer
 * has already produced a usable profile before the paid call, so a provider
 * failure is recorded, billed honestly if tokens were spent, and the
 * deterministic profile is persisted anyway (CORE-1 §43). The operation
 * completes; `synthesized` is false; the screen says what is missing.
 *
 * A failure that means we never had anything to understand — no repository
 * snapshot at all — is a different case and does fail the operation.
 */

export type ExecutionDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  provider: AIProvider;
};

export type StepOutcome<T> = ({ ok: true } & T) | { ok: false; failureCode: OperationFailureCode };

/**
 * Loads the operation and re-establishes ownership.
 *
 * With RLS out of the picture this is the security boundary: the project's
 * owner must still be the operation's owner (CLAUDE.md rule 53).
 */
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

type UnderstandingIdentity = {
  repositorySnapshotId: string | null;
  liveSnapshotId: string | null;
  authenticatedSnapshotId: string | null;
  inputHash: string;
};

/**
 * Loads every evidence source and derives the profile's input identity.
 *
 * Deterministic — the same rows produce the same pack and the same hash — so
 * each step calls it rather than receiving evidence through workflow state.
 */
export async function loadUnderstandingSources(
  supabase: SupabaseClient,
  projectId: string,
): Promise<
  StepOutcome<{ sources: BuildUnderstandingPackInput; identity: UnderstandingIdentity }>
> {
  const [repositorySnapshot, liveSnapshot, authenticatedSnapshot] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
  ]);

  // The one hard prerequisite. A profile with neither code nor a public site
  // behind it would be a page of "not found" rows presented as understanding.
  if (!repositorySnapshot?.result && !liveSnapshot?.result) {
    return { ok: false, failureCode: "repository_intelligence_missing" };
  }

  const repository = repositorySnapshot?.result ? repositorySnapshot : null;
  const live = liveSnapshot?.result ? liveSnapshot : null;
  const authenticated = authenticatedSnapshot?.result ? authenticatedSnapshot : null;

  return {
    ok: true,
    sources: {
      repository: repository?.result ?? null,
      liveProduct: live?.result ?? null,
      signedInProduct: authenticated?.result ?? null,
    },
    identity: {
      repositorySnapshotId: repository?.id ?? null,
      liveSnapshotId: live?.id ?? null,
      authenticatedSnapshotId: authenticated?.id ?? null,
      inputHash: computeProfileInputHash({
        repositorySnapshotId: repository?.id ?? null,
        liveSnapshotId: live?.id ?? null,
        authenticatedSnapshotId: authenticated?.id ?? null,
        schemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
        builderVersion: PROFILE_BUILDER_VERSION,
        evidenceVersion: UNDERSTANDING_EVIDENCE_VERSION,
        promptVersion: PROMPT_VERSION,
        provider: "anthropic",
        model: PRODUCT_UNDERSTANDING_CONFIG.model,
      }),
    },
  };
}

/**
 * Loads sources and refuses if the evidence no longer matches the identity the
 * operation was created for.
 *
 * Evidence can change between the click and the step — a live check finishing,
 * a new commit analysed. Understanding the new evidence under the old
 * operation would produce a profile the user never asked for and corrupt reuse
 * for both identities.
 */
async function resolveInputs(
  supabase: SupabaseClient,
  operation: StoredOperationRun,
): Promise<
  StepOutcome<{ sources: BuildUnderstandingPackInput; identity: UnderstandingIdentity }>
> {
  const loaded = await loadUnderstandingSources(supabase, operation.projectId);
  if (!loaded.ok) return loaded;

  if (loaded.identity.inputHash !== operation.inputIdentity) {
    return { ok: false, failureCode: "inputs_changed" };
  }

  return loaded;
}

/**
 * Step 1 — read the code.
 *
 * Verifies prerequisites, confirms the evidence still matches, and claims the
 * profile row. Claiming here rather than at inference time makes the profile
 * table's own in-flight unique index a second, independent guard against two
 * derivations for one input.
 */
export async function readCodeStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ profileId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  // A replay after the claim already happened: reuse it, never claim twice.
  if (operation.resultId) return { ok: true, profileId: operation.resultId };

  await setOperationStage(deps.supabase, { operationId, stage: "reading_code", markRunning: true });

  const resolved = await resolveInputs(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const run = await createProfileRun(deps.supabase, {
    projectId: operation.projectId,
    repositorySnapshotId: resolved.identity.repositorySnapshotId,
    liveSnapshotId: resolved.identity.liveSnapshotId,
    authenticatedSnapshotId: resolved.identity.authenticatedSnapshotId,
    inputHash: resolved.identity.inputHash,
    promptVersion: PROMPT_VERSION,
    provider: "anthropic",
    model: PRODUCT_UNDERSTANDING_CONFIG.model,
  });

  if (!run.ok) {
    return {
      ok: false,
      failureCode: run.error === "already_running" ? "already_running" : "understanding_failed",
    };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: run.profileId });

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "product_understanding.started",
    metadata: {
      projectId: operation.projectId,
      profileId: run.profileId,
      operationId,
      model: PRODUCT_UNDERSTANDING_CONFIG.model,
      promptVersion: PROMPT_VERSION,
    },
  });

  return { ok: true, profileId: run.profileId };
}

/**
 * Step 2 — look at the public product, and count what the call will cost.
 *
 * Two things under one stage on purpose. The user-facing half is "Vibe is
 * looking at your public product"; the engineering half is the budget gate
 * that sits before the paid step. Splitting them would add a stage that means
 * nothing to anyone watching.
 */
export async function readPublicProductStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ estimatedInputTokens: number }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "reading_public_product" });

  const sources = await loadUnderstandingSources(deps.supabase, loaded.operation.projectId);
  if (!sources.ok) return sources;

  const config = PRODUCT_UNDERSTANDING_CONFIG;
  const pack = buildUnderstandingPack(sources.sources);
  const counted = await deps.provider.countInputTokens(buildUnderstandingRequest(pack, config));
  if (!counted.ok) return { ok: false, failureCode: counted.error };

  if (counted.inputTokens > config.maxInputTokens) {
    // Only a pack that cannot fit even after the runner drops everything
    // droppable is genuinely over budget. Checking the floor costs one extra
    // unbilled count, and only in the case already going wrong.
    const floor = await deps.provider.countInputTokens(
      buildUnderstandingRequest(trimUnderstandingPack(pack, 1), config),
    );
    if (!floor.ok) return { ok: false, failureCode: floor.error };
    if (floor.inputTokens > config.maxInputTokens) {
      return { ok: false, failureCode: "understanding_input_budget_exceeded" };
    }
  }

  return { ok: true, estimatedInputTokens: counted.inputTokens };
}

/**
 * Step 3 — the paid call, its validation, and its persistence, as one step.
 *
 * Not three steps: splitting them would either put model output across the
 * durable boundary or let a validation failure re-enter a step that calls the
 * provider again. One step means one billable call committed with its result,
 * and the retry policy for that unit is: never.
 *
 * `inference_started_at` is written before the call and never cleared, so a
 * re-entry can tell "not yet attempted" from "may already have been billed".
 * Ambiguity resolves to failure, never to a second call.
 *
 * A provider failure here does **not** fail the operation. The deterministic
 * profile is persisted with `synthesized: false`, because a founder whose
 * provider was rate-limited should still see what Vibe found (CORE-1 §43).
 */
export async function understandProductStep(
  deps: ExecutionDeps,
  operationId: string,
  estimatedInputTokens: number,
): Promise<StepOutcome<{ profileId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  if (!operation.resultId) return { ok: false, failureCode: "understanding_failed" };

  const existing = await getProfileById(deps.supabase, operation.resultId);

  // A replay of a step that completed: report the same result, never a second.
  if (existing?.status === "completed") return { ok: true, profileId: existing.id };
  if (existing?.status === "failed") {
    return {
      ok: false,
      failureCode: (existing.failureCode as OperationFailureCode) ?? "understanding_failed",
    };
  }

  // The ambiguous case this whole design exists for: a provider call was
  // started and its outcome was never recorded. It may have been billed.
  if (operation.inferenceStartedAt !== null) {
    return { ok: false, failureCode: "inference_interrupted" };
  }

  const resolved = await resolveInputs(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const config = PRODUCT_UNDERSTANDING_CONFIG;

  await setOperationStage(deps.supabase, { operationId, stage: "understanding_product" });
  await markInferenceStarted(deps.supabase, operationId);

  const outcome = await runProductUnderstanding({
    provider: deps.provider,
    config,
    now: () => new Date().toISOString(),
    ...resolved.sources,
  });

  // Recorded for successes and failures alike, and only when tokens were
  // genuinely billed (CLAUDE.md rule 47).
  await recordAIUsage(deps.supabase, {
    userId: operation.userId,
    projectId: operation.projectId,
    operation: config.operation,
    provider: deps.provider.name,
    model: config.model,
    jobId: operation.resultId,
    status: outcome.synthesized ? "succeeded" : "failed",
    usage: outcome.usage,
    estimatedInputTokens: outcome.estimatedInputTokens ?? estimatedInputTokens,
    latencyMs: outcome.latencyMs,
    failureCode: outcome.error ?? null,
  });

  await completeProfileRun(deps.supabase, {
    profileId: operation.resultId,
    profile: outcome.profile,
    synthesized: outcome.synthesized,
  });

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: outcome.synthesized
      ? "product_understanding.completed"
      : "product_understanding.completed_without_synthesis",
    metadata: {
      projectId: operation.projectId,
      profileId: operation.resultId,
      operationId,
      model: config.model,
      promptVersion: PROMPT_VERSION,
      completeness: outcome.profile.completeness,
      capabilityCount: outcome.profile.capabilities.length,
      ...(outcome.error ? { reason: outcome.error } : {}),
      ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
    },
  });

  return { ok: true, profileId: operation.resultId };
}

/** Step 4 — finish. Idempotent, so a replay emits no second completion event. */
export async function completeOperationStep(
  deps: ExecutionDeps,
  operationId: string,
  profileId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, { operationId, resultId: profileId });
  if (!transitioned) return;

  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.completed",
    metadata: { projectId: operation.projectId, operationId, operationType: operation.operationType },
  });
}

/** Terminal failure path, idempotent for the same reason. */
export async function failOperationStep(
  deps: ExecutionDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  const operation = await getOperationRunById(deps.supabase, operationId);

  // A claimed profile row must not be left `analyzing` forever: the partial
  // unique index would block every future attempt at the same input.
  if (operation?.resultId) {
    const profile = await getProfileById(deps.supabase, operation.resultId);
    if (profile && profile.status !== "completed" && profile.status !== "failed") {
      await failProfileRun(deps.supabase, operation.resultId, failureCode);
    }
  }

  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned || !operation) return;

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
