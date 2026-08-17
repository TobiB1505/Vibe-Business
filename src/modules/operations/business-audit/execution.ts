import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider } from "@/modules/ai/provider";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { recordAIUsage } from "@/modules/ai/usage";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  EVIDENCE_PACK_V3_VERSION,
  buildEvidencePackV3,
  trimEvidencePackV3,
  type BuildEvidencePackV3Input,
} from "@/modules/business-audit/evidence-v3";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import { buildAuditRequest, runBusinessReadinessAudit } from "@/modules/business-audit/runner";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "@/modules/business-audit/schema";
import { consumesIncludedEntitlement } from "@/modules/business-audit/entitlement";
import {
  completeAuditRun,
  computeAuditInputHash,
  createAuditRun,
  failAuditRun,
  adoptResumedAuditIdentity,
  getAskedIntents,
  getAuditById,
  getLatestSuccessfulAudit,
  pauseAuditForQuestion,
  recordFreeAuditGrant,
} from "@/modules/business-audit/store";
import { selectBlockingQuestion } from "@/modules/business-audit/needs-user";
import type { FounderQuestionIntent } from "@/modules/business-audit/founder-questions";
import { authorizeProjectAudit, getConnectedRepositoryId } from "@/modules/business-audit/service";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
} from "@/modules/product-understanding/schema";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { OperationFailureCode } from "../failures";
import {
  claimResultForOperation,
  completeOperationRun,
  failOperationRun,
  getOperationRunById,
  markInferenceStarted,
  pauseOperationForUser,
  setOperationStage,
  type StoredOperationRun,
} from "../store";

/**
 * The Business Audit's durable step bodies (Sprint 7 §10).
 *
 * Plain async functions taking their dependencies as arguments. The workflow
 * file wraps each one in a `"use step"` shim and nothing else, which is what
 * keeps the audit pipeline testable without a workflow platform and keeps
 * provider vocabulary out of the domain (§32).
 *
 * ## What crosses a step boundary
 *
 * An operation id, and a token count. Nothing else (§14).
 *
 * Every step re-reads the operation row and rebuilds what it needs from the
 * database. Rebuilding is deterministic — the same snapshot rows produce the
 * same evidence pack — so this costs a few indexed reads and buys the property
 * that no evidence, no prompt and no model output is ever written into the
 * execution provider's durable log.
 *
 * ## Failure convention
 *
 * Expected domain failures are **returned**, never thrown. That is the whole
 * retry policy (§11): the platform retries a step that throws, so anything we
 * return is by construction not retried. A provider auth error, a refusal, a
 * budget rejection and a validation failure are all outcomes, not exceptions.
 * Only genuinely unexpected infrastructure errors throw, and only where a
 * retry is safe.
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
 * owner must still be the operation's owner. A mismatch means something is
 * wrong with data we generated, and the safe response is to refuse rather than
 * to run inference against another user's project.
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

type AuditIdentity = {
  repositorySnapshotId: string;
  liveSnapshotId: string;
  authenticatedSnapshotId: string | null;
  /** The Product Profile this audit reasons from (CORE-2 §3, §7). */
  productProfileId: string;
  founderIntentHash: string;
  inputHash: string;
};

/**
 * Loads every evidence source and derives the audit's input identity.
 *
 * Each step calls this rather than receiving evidence through workflow state.
 * It is deterministic — the same rows produce the same pack and the same
 * hash — so the cost is a few indexed reads and the benefit is that no
 * customer evidence is ever written into the execution provider's log (§14).
 */
async function loadAuditSources(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StepOutcome<{ sources: BuildEvidencePackV3Input; identity: AuditIdentity }>> {
  const [repositorySnapshot, liveSnapshot, profile, founderIntent, authenticatedSnapshot] =
    await Promise.all([
      getLatestSuccessfulSnapshot(supabase, projectId),
      getLatestSuccessfulLiveSnapshot(supabase, projectId),
      getLatestProfile(supabase, projectId),
      getFounderIntent(supabase, projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    ]);

  if (!repositorySnapshot?.result) return { ok: false, failureCode: "repository_intelligence_missing" };
  if (!liveSnapshot?.result) return { ok: false, failureCode: "live_product_intelligence_missing" };

  // The CORE-2 contract, enforced where it cannot be routed around: no Product
  // Profile, no audit. There is deliberately no fallback that would rebuild
  // product understanding from raw evidence here — that second pipeline is
  // exactly what CORE-2 §8 forbids, and a fallback is how it would arrive.
  if (!profile) return { ok: false, failureCode: "product_profile_missing" };

  const authenticated = authenticatedSnapshot?.result ? authenticatedSnapshot : null;

  return {
    ok: true,
    sources: {
      // The corrected profile, not the raw derived one. `getLatestProfile`
      // overlays corrections on read, which is what carries a founder's
      // "actually, my customers are solo founders who already launched" into
      // the audit as a confirmed fact (CORE-2 §5).
      productProfile: profile.profile,
      founderIntent: founderIntent.intent,
      repository: repositorySnapshot.result,
      liveProduct: liveSnapshot.result,
      authenticatedProduct: authenticated?.result ?? null,
    },
    identity: {
      repositorySnapshotId: repositorySnapshot.id,
      liveSnapshotId: liveSnapshot.id,
      authenticatedSnapshotId: authenticated?.id ?? null,
      productProfileId: profile.stored.id,
      founderIntentHash: founderIntent.intentHash,
      inputHash: computeAuditInputHash({
        repositorySnapshotId: repositorySnapshot.id,
        liveSnapshotId: liveSnapshot.id,
        productProfileId: profile.stored.id,
        founderIntentHash: founderIntent.intentHash,
        authenticatedSnapshotId: authenticated?.id ?? null,
        schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
        auditVersion: BUSINESS_AUDIT_VERSION,
        evidencePackVersion: EVIDENCE_PACK_V3_VERSION,
        promptVersion: PROMPT_VERSION,
        rubricVersion: RUBRIC_VERSION,
        profileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
        profileBuilderVersion: PROFILE_BUILDER_VERSION,
        provider: "anthropic",
        model: BUSINESS_READINESS_AUDIT_CONFIG.model,
      }),
    },
  };
}

/**
 * Loads sources and refuses if the evidence no longer matches the identity the
 * operation was created for.
 *
 * Evidence can change between the click and the step — a Deep Scan finishing,
 * a context edit. Auditing the new evidence under the old operation would
 * produce a result the user never asked for and would corrupt reuse for both
 * identities, so a mismatch ends the operation instead.
 */
async function resolveInputs(
  supabase: SupabaseClient,
  operation: StoredOperationRun,
): Promise<StepOutcome<{ sources: BuildEvidencePackV3Input; identity: AuditIdentity }>> {
  const loaded = await loadAuditSources(supabase, operation.projectId);
  if (!loaded.ok) return loaded;

  if (loaded.identity.inputHash === operation.inputIdentity) return loaded;

  /*
   * The identity moved. Usually that ends the run — but not when this run is
   * the reason it moved (CORE-2a.4).
   *
   * The audit's input hash includes the founder intent hash. So a run that
   * pauses, asks the founder something, and receives an answer has *by
   * construction* invalidated its own identity: the answer is stored, the hash
   * changes, and the next step refuses to proceed. The first real interruption
   * did exactly that — two questions answered, then `inputs_changed` at
   * `counting_tokens`, with the founder's answers safely persisted and the
   * audit they were collected for dead.
   *
   * The feature was self-defeating in the most literal way: the answer that
   * makes the audit better is what stops it running.
   *
   * So a run that actually asked something adopts the new identity instead of
   * failing on it. The guard still protects everything it was written for —
   * a Deep Scan finishing mid-run, an unrelated edit — for every run that did
   * not ask. What it deliberately no longer catches is evidence that changed
   * while the founder was thinking, on a run they explicitly re-triggered by
   * answering: using the newest evidence there is the better answer, and the
   * user asked for the run to continue.
   */
  const askedSomething = operation.resultId
    ? (await getAskedIntents(supabase, operation.resultId)).length > 0
    : false;

  if (!askedSomething) return { ok: false, failureCode: "inputs_changed" };

  const adopted = await adoptResumedAuditIdentity(supabase, {
    operationId: operation.id,
    auditId: operation.resultId!,
    inputHash: loaded.identity.inputHash,
  });

  // A collision means another audit already holds this exact identity — the
  // reuse path, not an error to hide. Ending here leaves that one to answer.
  if (!adopted.ok) return { ok: false, failureCode: "inputs_changed" };

  return loaded;
}

/**
 * Step 1 — prepare.
 *
 * Verifies prerequisites, confirms the evidence still matches the identity the
 * operation was created for, and claims the audit row. Claiming here rather
 * than at inference time is deliberate: the audit table's own in-flight unique
 * index becomes a second, independent guard against two audits for one input.
 */
export async function prepareEvidenceStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ auditId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  // A replay after the claim already happened: reuse it, never claim twice.
  if (operation.resultId) return { ok: true, auditId: operation.resultId };

  await setOperationStage(deps.supabase, { operationId, stage: "preparing", markRunning: true });

  const resolved = await resolveInputs(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  /*
   * Re-decided here rather than carried across the step boundary.
   *
   * The workflow step runs after the request that started it, and the mode
   * decides how the run is funded — so it is read from current server state at
   * the moment the row is claimed, exactly like every other input this step
   * rebuilds instead of receiving (Sprint 7 §14).
   */
  const authorization = await authorizeProjectAudit(deps.supabase, {
    projectId: operation.projectId,
    userId: operation.userId,
  });
  if (!authorization.allowed) {
    return { ok: false, failureCode: authorization.reason };
  }

  const config = BUSINESS_READINESS_AUDIT_CONFIG;
  const run = await createAuditRun(deps.supabase, {
    projectId: operation.projectId,
    repositorySnapshotId: resolved.identity.repositorySnapshotId,
    liveSnapshotId: resolved.identity.liveSnapshotId,
    productProfileId: resolved.identity.productProfileId,
    profileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    profileBuilderVersion: PROFILE_BUILDER_VERSION,
    founderIntentHash: resolved.identity.founderIntentHash,
    inputHash: resolved.identity.inputHash,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V3_VERSION,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: "anthropic",
    model: config.model,
    // Decided by the server-side gate, not assumed here. A refresh Vibe owes
    // the user because its own contract moved is funded differently from the
    // customer's included audit, and must not spend or restore it
    // (CORE-2a.2 §19, §27).
    accessMode: authorization.accessMode,
  });

  if (!run.ok) {
    return { ok: false, failureCode: run.error === "already_running" ? "already_running" : "audit_failed" };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: run.auditId });

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "business_audit.started",
    metadata: {
      projectId: operation.projectId,
      auditId: run.auditId,
      operationId,
      model: config.model,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      // CORE-2 §52/§53: the activation funnel has to be measurable without a
      // second analytics platform. `accessMode` is what makes "free audit
      // started" answerable from the existing audit log, and the profile id is
      // what makes an audit traceable back to the understanding it used (§7).
      //
      // Taken from the decision rather than hardcoded (CORE-2a.2 §27, §35).
      // A literal here would log every system contract refresh as if it were
      // the customer's included audit — false, and it would quietly corrupt
      // the one number that says how much Vibe spends on its own upgrades.
      accessMode: authorization.accessMode,
      productProfileId: resolved.identity.productProfileId,
      productProfileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    },
  });

  return { ok: true, auditId: run.auditId };
}

/**
 * Step 2 — does this need the founder before it needs the model? (CORE-2a.4)
 *
 * Deliberately positioned here: after the audit row is claimed, and **before**
 * anything is counted or spent. Everything the decision needs — the current
 * profile, the founder's stated intent, and the previous audit's lens
 * assessments — is already structured data, so this step makes no provider call
 * and a pause therefore costs nothing.
 *
 * That ordering is what makes the whole feature affordable. Asking after
 * inference would mean paying for an audit, discarding it, and paying again;
 * asking during it is impossible, because all nine lenses come from a single
 * structured response.
 *
 * Returns `paused` rather than a failure. A run waiting for its founder has not
 * gone wrong, and routing it through the failure path would put an error on a
 * screen that should be inviting an answer.
 */
export async function checkFounderQuestionStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ paused: boolean }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  const auditId = operation.resultId;
  if (auditId === null) return { ok: false, failureCode: "audit_failed" };

  const [profile, founderIntent, previous, askedIntents] = await Promise.all([
    getLatestProfile(deps.supabase, operation.projectId),
    getFounderIntent(deps.supabase, operation.projectId),
    getLatestSuccessfulAudit(deps.supabase, operation.projectId),
    getAskedIntents(deps.supabase, auditId),
  ]);

  // The profile is a hard prerequisite of the audit itself, so its absence is
  // handled upstream; there is simply nothing to reason from here.
  if (profile === null) return { ok: true, paused: false };

  /*
   * Whether the previous audit's lens assessments still describe this business.
   *
   * They were assessed against one specific profile and one specific set of
   * founder answers — and this feature exists to change both. Comparing the
   * recorded identity rather than timestamps makes staleness a fact: a resumed
   * run must not re-read a materiality that was decided before the answer it
   * just received.
   */
  const lensesReflectCurrentFacts =
    previous !== null &&
    previous.productProfileId === profile.stored.id &&
    previous.founderIntentHash === founderIntent.intentHash;

  const decision = selectBlockingQuestion({
    profile: profile.profile,
    intent: founderIntent.intent,
    lenses: previous?.result?.synthesis?.lenses ?? [],
    lensesReflectCurrentFacts,
    askedIntents: askedIntents as FounderQuestionIntent[],
  });

  if (!decision.ask) return { ok: true, paused: false };

  await setOperationStage(deps.supabase, { operationId, stage: "asking_founder" });
  await pauseAuditForQuestion(deps.supabase, { auditId, question: decision.question });
  await pauseOperationForUser(deps.supabase, operationId);

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "business_audit.needs_user",
    metadata: {
      projectId: operation.projectId,
      auditId,
      operationId,
      // The intent and the areas it affects, never the founder's own words —
      // the audit log is not the place for free-form personal content.
      questionIntent: decision.question.intent,
      affectedLenses: decision.question.affectedLenses,
      materiality: decision.question.materiality,
    },
  });

  return { ok: true, paused: true };
}

/**
 * Step 3 — count tokens.
 *
 * A budget gate that sits *before* the paid step, so an oversized pack fails
 * without the paid path ever being entered. The runner counts again for the
 * request it actually sends; token counting is unbilled, and paying a second
 * free call is a better trade than reshaping the audit pipeline around the
 * execution engine (§32).
 */
export async function countTokensStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ estimatedInputTokens: number }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "counting_tokens" });

  const sources = await loadAuditSources(deps.supabase, loaded.operation.projectId);
  if (!sources.ok) return sources;

  const config = BUSINESS_READINESS_AUDIT_CONFIG;
  const pack = buildEvidencePackV3(sources.sources);
  const counted = await deps.provider.countInputTokens(buildAuditRequest(pack, config));
  if (!counted.ok) return { ok: false, failureCode: counted.error };

  if (counted.inputTokens > config.maxInputTokens) {
    // Only a pack that cannot fit even after the runner drops everything
    // droppable is genuinely over budget. Checking the floor costs one extra
    // unbilled count, and only in the case that is already going wrong.
    const floor = await deps.provider.countInputTokens(
      buildAuditRequest(trimEvidencePackV3(pack, 1), config),
    );
    if (!floor.ok) return { ok: false, failureCode: floor.error };
    if (floor.inputTokens > config.maxInputTokens) {
      return { ok: false, failureCode: "audit_input_budget_exceeded" };
    }
  }

  return { ok: true, estimatedInputTokens: counted.inputTokens };
}

/**
 * Step 3 — the paid call, its validation, and its persistence, as one step.
 *
 * These are deliberately not three steps. Splitting them would mean either the
 * model's output crosses the durable boundary — which §14 forbids — or a
 * validation failure re-enters a step that would call the provider again. One
 * step means one billable call with its result committed in the same unit of
 * work, and the retry policy for that unit is simply: never.
 *
 * `inference_started_at` is written *before* the call and never cleared, so a
 * re-entry can tell "not yet attempted" from "may already have been billed"
 * (§11). Ambiguity resolves to failure, never to a second call.
 */
export async function runInferenceStep(
  deps: ExecutionDeps,
  operationId: string,
  estimatedInputTokens: number,
): Promise<StepOutcome<{ auditId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  if (!operation.resultId) return { ok: false, failureCode: "audit_failed" };

  const existing = await getAuditById(deps.supabase, operation.resultId);

  // Already finished: a replay of a step that completed. Report the same
  // result rather than producing a second one.
  if (existing?.status === "completed") return { ok: true, auditId: existing.id };
  if (existing?.status === "failed") {
    return { ok: false, failureCode: (existing.failureCode as OperationFailureCode) ?? "audit_failed" };
  }

  // The ambiguous case, and the one this whole design exists for: a provider
  // call was started and we never recorded its outcome. It may have been
  // billed. Refuse.
  if (operation.inferenceStartedAt !== null) {
    return { ok: false, failureCode: "inference_interrupted" };
  }

  const resolved = await resolveInputs(deps.supabase, operation);
  if (!resolved.ok) return resolved;

  const config = BUSINESS_READINESS_AUDIT_CONFIG;

  await setOperationStage(deps.supabase, { operationId, stage: "running_ai" });
  await markInferenceStarted(deps.supabase, operationId);

  const outcome = await runBusinessReadinessAudit({
    provider: deps.provider,
    config,
    ...resolved.sources,
  });

  // Usage is recorded for successes and failures alike, and only when tokens
  // were genuinely billed (Sprint 4 §25, §27). The ledger's unique job index
  // makes a second write a no-op rather than a duplicate (§12).
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
    await failAuditRun(deps.supabase, operation.resultId, outcome.error);
    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: "business_audit.failed",
      metadata: {
        projectId: operation.projectId,
        auditId: operation.resultId,
        operationId,
        reason: outcome.error,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
      },
    });
    return { ok: false, failureCode: outcome.error };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "validating" });
  await setOperationStage(deps.supabase, { operationId, stage: "persisting" });
  await completeAuditRun(deps.supabase, operation.resultId, outcome.audit);

  // Entitlement consumption, recorded *after* the audit is committed and only
  // on success (CORE-2 §16, §17).
  //
  // The ordering is the policy. Everything above this line can fail — a
  // provider outage, a validation rejection, our own persistence — and none of
  // it reaches here, so none of it costs the user their free audit. There is
  // no refund path because there is nothing to refund.
  const completedAudit = await getAuditById(deps.supabase, operation.resultId);
  const accessMode = completedAudit?.accessMode ?? "included_first_audit";

  // Only the included entitlement is spendable. A system refresh writes no
  // grant, so the customer's free audit is neither consumed a second time nor
  // handed back (CORE-2a.2 §19, §36).
  if (consumesIncludedEntitlement({ accessMode, auditCompleted: true })) {
    const repositoryId = await getConnectedRepositoryId(deps.supabase, operation.projectId);
    if (repositoryId !== null) {
      await recordFreeAuditGrant(deps.supabase, {
        userId: operation.userId,
        githubRepositoryId: repositoryId,
        auditId: operation.resultId,
      });
    }
  }

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "business_audit.completed",
    metadata: {
      projectId: operation.projectId,
      auditId: operation.resultId,
      operationId,
      model: config.model,
      promptVersion: PROMPT_VERSION,
      overallScore: outcome.audit.overall.score,
      coverage: `${outcome.audit.overall.assessedDimensions}/${outcome.audit.overall.totalDimensions}`,
      // The completion half of the funnel step, and the point at which the
      // free audit is provably consumed — for an included run. A refresh
      // completes here too and consumes nothing, which is why the mode is read
      // from the row rather than assumed (CORE-2a.2 §27).
      accessMode,
      productProfileId: resolved.identity.productProfileId,
    },
  });

  return { ok: true, auditId: operation.resultId };
}

/**
 * Step 4 — finish.
 *
 * The transition returns whether *this* call performed it, so a replay emits
 * no second completion event (§23).
 */
export async function completeOperationStep(
  deps: ExecutionDeps,
  operationId: string,
  auditId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, { operationId, resultId: auditId });
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
  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned) return;

  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  /*
   * The audit row dies with the operation carrying it (CORE-2a.4 follow-up).
   *
   * `runInferenceStep` fails its own row, so failures *at* inference were
   * always recorded. Everything between claiming the row and reaching
   * inference was not: the operation failed, the audit stayed `analyzing`, and
   * because both the in-flight and one-included indexes count that status, the
   * project was left unable to start another audit at all.
   *
   * A real run found it. A resumed audit failed at `counting_tokens`, and the
   * screen then offered "Run business audit" over a row that would refuse
   * every attempt — the worst kind of stuck, because nothing on it looked
   * broken.
   *
   * Idempotent: `failAuditRun` on an already-failed or completed row is a
   * no-op, so the inference step failing its own row first changes nothing.
   */
  if (operation.resultId) {
    await failAuditRun(deps.supabase, operation.resultId, failureCode);
  }

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
