import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  checkOperationAffordability,
  holdOperationCredits,
} from "./billing";
import { EVIDENCE_PACK_V3_VERSION } from "@/modules/business-audit/evidence-v3";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "@/modules/business-audit/schema";
import { computeAuditInputHash, findReusableAudit } from "@/modules/business-audit/store";
import { authorizeProjectAudit } from "@/modules/business-audit/service";
import { resolveOpportunityIdentity } from "@/modules/opportunities/service";
import { resolveActionPlanIdentity } from "@/modules/action-plans/service";
import { findReusableActionPlan } from "@/modules/action-plans/store";
import { findReusableProfile } from "@/modules/product-understanding/store";
import { loadUnderstandingSources } from "./product-understanding/execution";
import { findReusableOpportunitySet } from "@/modules/opportunities/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
} from "@/modules/product-understanding/schema";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { OperationExecutor } from "./executor";
import type { OperationFailureCode } from "./failures";
import type { OperationType } from "./schema";
import {
  attachExecutionRun,
  createOperationRun,
  failOperationRun,
  findActiveOperation,
  findActiveOperationByIdentity,
  findLatestOperation,
  findPausedOperationForAudit,
  requeueAnsweredOperation,
  getOperationRun,
  type StoredOperationRun,
} from "./store";
import { expireStaleOperation } from "./staleness";
import { buildOperationView, type OperationView } from "./view";

/**
 * Starting and observing durable operations (Sprint 7 §16, §17).
 *
 * The start path is where cost is protected, so it is deliberately a sequence
 * of refusals before it is a sequence of actions:
 *
 *   own the project → resolve evidence → identical audit exists? reuse it
 *   → identical operation live? return it → claim → enqueue
 *
 * Only the last two steps create anything, and the claim is guarded by a
 * database constraint so two simultaneous clicks cannot both pass (§8).
 *
 * Everything here runs on the caller's own RLS-scoped client. The service-role
 * client belongs to workflow steps alone (ADR 0013).
 */

export type StartOperationOutcome =
  /** An identical audit already exists; nothing was started and nothing spent. */
  | { kind: "reused"; auditId: string }
  /** A matching operation was already running; the same one is returned. */
  | { kind: "active"; operation: OperationView }
  /** New durable work is now enqueued. */
  | { kind: "started"; operation: OperationView }
  | { kind: "failed"; error: OperationFailureCode };

export type StartBusinessAuditParams = {
  projectId: string;
  userId: string;
  /** A deliberate re-run: skips audit reuse, never skips the active-run check. */
  force?: boolean;
};

/** Resolves the exact identity the audit would run under, or why it cannot. */
async function resolveAuditIdentity(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ ok: true; inputHash: string } | { ok: false; error: OperationFailureCode }> {
  const [repositorySnapshot, liveSnapshot, profile, founderIntent, authenticatedSnapshot] =
    await Promise.all([
      getLatestSuccessfulSnapshot(supabase, projectId),
      getLatestSuccessfulLiveSnapshot(supabase, projectId),
      getLatestProfile(supabase, projectId),
      getFounderIntent(supabase, projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    ]);

  if (!repositorySnapshot?.result) return { ok: false, error: "repository_intelligence_missing" };
  if (!liveSnapshot?.result) return { ok: false, error: "live_product_intelligence_missing" };
  if (!profile) return { ok: false, error: "product_profile_missing" };

  const authenticated = authenticatedSnapshot?.result ? authenticatedSnapshot : null;

  return {
    ok: true,
    // The Business Audit's own identity, unchanged in principle (§7). A second
    // identity system would immediately disagree with audit reuse.
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
  };
}

function view(operation: StoredOperationRun): OperationView {
  return buildOperationView({
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failureCode: operation.failureCode,
    resultId: operation.resultId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    createdAt: operation.createdAt,
  });
}

/**
 * Puts a paused audit back to work after its question is answered (CORE-2a.4).
 *
 * Not a new operation. The same run re-enters its workflow from the top, and
 * every step above the pause is already replay-safe — `prepareEvidenceStep`
 * returns the claimed audit row rather than claiming a second one — so nothing
 * expensive is repeated and no second slot is taken.
 *
 * Idempotent through `requeueAnsweredOperation`, which matches on `needs_user`.
 * A double submission finds the operation already re-queued, changes nothing,
 * and starts no second workflow.
 */
export async function resumeAnsweredAuditOperation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: { projectId: string; userId: string; auditId: string },
): Promise<{ ok: boolean }> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false };

  const paused = await findPausedOperationForAudit(supabase, {
    projectId: params.projectId,
    auditId: params.auditId,
  });
  if (!paused) return { ok: false };

  const requeued = await requeueAnsweredOperation(supabase, paused.id);
  if (!requeued.requeued) return { ok: true };

  const started = await executor.start({
    operationId: paused.id,
    operationType: "business_audit",
  });

  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: paused.id,
      failureCode: "execution_start_failed",
    });
    return { ok: false };
  }

  await attachExecutionRun(supabase, {
    operationId: paused.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  return { ok: true };
}

/**
 * Returns a hold when an operation never got off the ground.
 *
 * A separate helper only so the start paths read as one sequence; it is the
 * same release every other failure uses, and it is idempotent, so calling it
 * for a free operation with no reservation does nothing.
 */
async function releaseHoldForFailedStart(operationRunId: string): Promise<void> {
  const { releaseOperationBilling } = await import("./billing");
  // Service-role client (§53, §64): the hold this releases was taken with one,
  // and every billing table's write policy is the same absence for every
  // authenticated client regardless of which write is being undone.
  await releaseOperationBilling(createServiceClient(), { operationRunId, providerUsageOccurred: false });
}

export async function startBusinessAuditOperation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartBusinessAuditParams,
): Promise<StartOperationOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  const identity = await resolveAuditIdentity(supabase, params.projectId);
  if (!identity.ok) return { kind: "failed", error: identity.error };

  /*
   * The entitlement gate (CORE-2 §16), enforced here rather than in the Server
   * Action, so it covers every caller rather than the one that happens to
   * remember.
   *
   * Its absence is what the first dogfood found, and the failure was the
   * expensive shape rather than the harmless one: a re-run on a project whose
   * free audit was already consumed started, paid for inference, and only then
   * failed — at `persisting`, when the completed row collided with the
   * one-included-audit unique index. Money spent, nothing produced.
   *
   * Placed after reuse resolution but before anything is claimed, and after
   * `resolveAuditIdentity` so a missing prerequisite still reports as itself
   * rather than as a billing refusal.
   */
  const authorization = await authorizeProjectAudit(supabase, {
    projectId: params.projectId,
    userId: params.userId,
  });

  // Cheapest possible answer first: the work is already done (§9).
  if (!params.force) {
    const reusable = await findReusableAudit(supabase, {
      projectId: params.projectId,
      inputHash: identity.inputHash,
    });
    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "business_audit.reused",
        metadata: {
          projectId: params.projectId,
          auditId: reusable.id,
          model: BUSINESS_READINESS_AUDIT_CONFIG.model,
          promptVersion: PROMPT_VERSION,
          overallScore: reusable.overallScore,
        },
      });
      return { kind: "reused", auditId: reusable.id };
    }
  }

  // Second cheapest: the work is already happening. Checked even under
  // `force`, because a forced re-run must still never start a second
  // simultaneous inference for the same inputs.
  const alreadyActive = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "business_audit",
    inputIdentity: identity.inputHash,
  });
  if (alreadyActive) return { kind: "active", operation: view(alreadyActive) };

  /*
   * Everything above this line is free: reusing a stored audit costs nothing
   * and must keep working after the entitlement is spent. Everything below it
   * spends money, so the refusal goes exactly here.
   *
   * `credits_required` is no longer terminal (BILLING CORE-2 §39). It means the
   * included audit is spent, which since Core-2 is a route into paying with
   * Credits rather than the end of the road — every other denial still is.
   */
  let payWithCredits = false;

  if (!authorization.allowed) {
    if (authorization.reason !== "credits_required") {
      return { kind: "failed", error: authorization.reason };
    }

    // A cheap read before anything is created, so the common refusal leaves no
    // failed operation row behind. The reservation below is the real gate.
    const affordable = await checkOperationAffordability(supabase, {
      projectId: params.projectId,
      operation: "business_audit",
    });
    if ("refusal" in affordable) return { kind: "failed", error: "insufficient_credits" };

    payWithCredits = true;
  }

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "business_audit",
    inputIdentity: identity.inputHash,
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      // Lost the race by milliseconds — the other click's operation is the
      // right answer, not an error. This is the double-click path, and the
      // reason the unique index exists (§8).
      const existing = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "business_audit",
        inputIdentity: identity.inputHash,
      });
      if (existing) return { kind: "active", operation: view(existing) };
    }
    return { kind: "failed", error: "audit_failed" };
  }

  const operation = created.operation;

  /*
   * The price is held before any provider work is enqueued (§39, §43).
   *
   * Discovering an empty wallet after paying Anthropic is both a cost leak and
   * an insult, so the hold goes here — after the operation row exists (its id
   * is the reservation's idempotency key, which is what makes a double-click
   * safe) and before anything can spend money.
   */
  if (payWithCredits) {
    // Service-role client (§53, §64): every billing table has a select policy
    // and deliberately no write policy for any authenticated client, so a
    // reservation held with the caller's cookie-scoped `supabase` would be
    // silently refused by RLS. Ownership was already verified above, against
    // `params.userId` from the caller's own session — never from a value this
    // client could be tricked into writing on someone else's behalf.
    const held = await holdOperationCredits(createServiceClient(), {
      projectId: params.projectId,
      operationRunId: operation.id,
      operation: "business_audit",
    });

    if (!held.ok) {
      await failOperationRun(supabase, {
        operationId: operation.id,
        failureCode: "insufficient_credits",
      });
      return { kind: "failed", error: "insufficient_credits" };
    }
  }

  const started = await executor.start({ operationId: operation.id, operationType: "business_audit" });

  if (!started.ok) {
    // The row exists but nothing is carrying it. Failing it immediately keeps
    // the identity's unique index free, so the user can simply try again. The
    // hold is returned by the same terminal-failure path every other failure
    // uses, so nothing stays reserved for work that never started.
    await failOperationRun(supabase, { operationId: operation.id, failureCode: "execution_start_failed" });
    await releaseHoldForFailedStart(operation.id);
    return { kind: "failed", error: "execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "operation.started",
    metadata: {
      projectId: params.projectId,
      operationId: operation.id,
      operationType: "business_audit",
      executionProvider: executor.name,
    },
  });

  return { kind: "started", operation: view(operation) };
}

/**
 * Status for polling (§17).
 *
 * Ownership is enforced by the query itself: an operation id belonging to
 * another project simply does not exist for this caller, and RLS makes that
 * true for another user's project even if the ids were guessed.
 *
 * ## The backstop for a workflow that stopped carrying its run (ADR 0041 §P2)
 *
 * The same repair `getAgentExecutionStatus` already runs before its own read
 * (`expireStaleAgentExecution`), generalized: a read is the moment somebody
 * cares, so it is the right moment to notice and repair an operation nothing
 * is carrying any more, and it needs no scheduler this product has not decided
 * to introduce (rule 24). Idempotent and bounded to one operation — a hundred
 * page loads repair it once — and a no-op for `agent_execution` and every
 * never-billed operation type, which either have their own mechanism or none
 * to run (`staleness.ts`).
 */
export async function getOperationStatus(
  supabase: SupabaseClient,
  params: { projectId: string; operationId: string },
): Promise<OperationView | null> {
  await expireStaleOperation({ operationId: params.operationId });

  const operation = await getOperationRun(supabase, params);
  return operation ? view(operation) : null;
}

/** The live operation a reloaded project page should display (§19). */
export async function getActiveBusinessAuditOperation(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OperationView | null> {
  const operation = await findActiveOperation(supabase, {
    projectId,
    operationType: "business_audit",
  });
  return operation ? view(operation) : null;
}

/**
 * Starting a durable opportunity generation (Sprint 8 §23, §24, §26).
 *
 * The same sequence of refusals as the audit, against the same guarantees —
 * this is the second consumer of one execution foundation, not a second
 * mechanism. What differs is only what identity means: a prioritization is
 * identified by the diagnosis it reasons from, not by the raw evidence.
 */
export async function startOpportunityOperation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: {
    projectId: string;
    userId: string;
    force?: boolean;
    /**
     * Who asked for this run, and therefore whether it is billable
     * (BILLING CORE-2 §40).
     *
     * `bundled_with_free_audit` is the generation that runs inside onboarding,
     * as part of the flow that delivers the free first audit. CREDIT_ECONOMICS.md
     * §Free usage keeps that one bundled and unpriced — decoupling it would
     * make a brand-new user's first guided run cost Credits they have not been
     * introduced to yet.
     *
     * `customer_requested` is the deliberate regeneration from the project
     * workspace, which costs 20 Credits.
     *
     * Required rather than defaulted: whether a customer is charged is not a
     * thing to get by omission.
     */
    requestedBy: "bundled_with_free_audit" | "customer_requested";
  },
): Promise<StartOperationOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  // Refuses outright when the audit is missing or stale (§34): prioritizing a
  // diagnosis we already know is out of date produces confident advice about a
  // product that has since changed, and nothing on screen would say so.
  const identity = await resolveOpportunityIdentity(supabase, params.projectId);
  if (!identity.ok) return { kind: "failed", error: identity.error };

  if (!params.force) {
    const reusable = await findReusableOpportunitySet(supabase, {
      projectId: params.projectId,
      inputHash: identity.inputHash,
    });
    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "opportunities.reused",
        metadata: {
          projectId: params.projectId,
          opportunitySetId: reusable.id,
          auditId: identity.auditId,
        },
      });
      return { kind: "reused", auditId: reusable.id };
    }
  }

  const alreadyActive = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "opportunity_generation",
    inputIdentity: identity.inputHash,
  });
  if (alreadyActive) return { kind: "active", operation: view(alreadyActive) };

  // Everything above is free — reusing a stored set and returning a live run
  // both cost nothing and must keep working with an empty balance (§42, §81).
  const payWithCredits = params.requestedBy === "customer_requested";

  if (payWithCredits) {
    const affordable = await checkOperationAffordability(supabase, {
      projectId: params.projectId,
      operation: "opportunity_generation",
    });
    if ("refusal" in affordable) return { kind: "failed", error: "insufficient_credits" };
  }

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "opportunity_generation",
    inputIdentity: identity.inputHash,
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      const existing = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "opportunity_generation",
        inputIdentity: identity.inputHash,
      });
      if (existing) return { kind: "active", operation: view(existing) };
    }
    return { kind: "failed", error: "opportunity_generation_failed" };
  }

  const operation = created.operation;

  if (payWithCredits) {
    // Service-role client — see the same reservation in
    // `startBusinessAuditOperation` for why.
    const held = await holdOperationCredits(createServiceClient(), {
      projectId: params.projectId,
      operationRunId: operation.id,
      operation: "opportunity_generation",
    });

    if (!held.ok) {
      await failOperationRun(supabase, {
        operationId: operation.id,
        failureCode: "insufficient_credits",
      });
      return { kind: "failed", error: "insufficient_credits" };
    }
  }

  const started = await executor.start({
    operationId: operation.id,
    operationType: "opportunity_generation",
  });

  if (!started.ok) {
    await failOperationRun(supabase, { operationId: operation.id, failureCode: "execution_start_failed" });
    await releaseHoldForFailedStart(operation.id);
    return { kind: "failed", error: "execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "operation.started",
    metadata: {
      projectId: params.projectId,
      operationId: operation.id,
      operationType: "opportunity_generation",
      executionProvider: executor.name,
    },
  });

  return { kind: "started", operation: view(operation) };
}

/**
 * Starting a durable Product Understanding run (CORE-1 §22).
 *
 * The same sequence of refusals as the audit — own the project, resolve
 * evidence, reuse an identical profile, return a live operation, claim,
 * enqueue — against the same database guarantees. This is the third consumer
 * of one execution foundation, not a third mechanism.
 *
 * What differs is what counts as enough evidence. The audit refuses without
 * both snapshots *and* business context; this runs on either snapshot alone,
 * because a product with no public site yet is exactly the kind of product
 * this flow exists to describe (CORE-1 §43).
 */
export async function startProductUnderstandingOperation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: { projectId: string; userId: string; force?: boolean },
): Promise<StartOperationOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  const identity = await loadUnderstandingSources(supabase, params.projectId);
  if (!identity.ok) return { kind: "failed", error: identity.failureCode };

  const inputHash = identity.identity.inputHash;

  // Cheapest possible answer first: the work is already done. This is what
  // stops a page render costing an inference call (CORE-1 §21).
  if (!params.force) {
    const reusable = await findReusableProfile(supabase, { projectId: params.projectId, inputHash });
    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "product_understanding.reused",
        metadata: { projectId: params.projectId, profileId: reusable.id },
      });
      return { kind: "reused", auditId: reusable.id };
    }
  }

  // Second cheapest: the work is already happening. Checked even under
  // `force`, so a re-run never starts a second simultaneous inference.
  const alreadyActive = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "product_understanding",
    inputIdentity: inputHash,
  });
  if (alreadyActive) return { kind: "active", operation: view(alreadyActive) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "product_understanding",
    inputIdentity: inputHash,
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      // Lost the race by milliseconds — the other click's operation is the
      // right answer, not an error.
      const existing = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "product_understanding",
        inputIdentity: inputHash,
      });
      if (existing) return { kind: "active", operation: view(existing) };
    }
    return { kind: "failed", error: "understanding_failed" };
  }

  const operation = created.operation;
  const started = await executor.start({
    operationId: operation.id,
    operationType: "product_understanding",
  });

  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    return { kind: "failed", error: "execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "operation.started",
    metadata: {
      projectId: params.projectId,
      operationId: operation.id,
      operationType: "product_understanding",
      executionProvider: executor.name,
    },
  });

  return { kind: "started", operation: view(operation) };
}

/** The live understanding run a reloaded page should display. */
export async function getActiveProductUnderstandingOperation(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OperationView | null> {
  const operation = await findActiveOperation(supabase, {
    projectId,
    operationType: "product_understanding",
  });
  return operation ? view(operation) : null;
}

/**
 * The last attempt of a type, but only if it ended badly (UI-S1 §15).
 *
 * Returns null when the latest attempt is live or succeeded, so a caller can
 * treat a non-null result as "the last thing this founder tried did not work,
 * and they have not been told". Anything older than the latest attempt is
 * deliberately invisible: a failure two runs ago that a later run fixed is
 * history, not a state to render.
 */
export async function getLastFailedOperation(
  supabase: SupabaseClient,
  params: { projectId: string; operationType: OperationType },
): Promise<OperationView | null> {
  const operation = await findLatestOperation(supabase, params);
  if (!operation || operation.status !== "failed") return null;
  return view(operation);
}

/**
 * Starting a durable Action Plan run (CORE-2b §53, §54).
 *
 * The same sequence of refusals as every operation before it — own the project,
 * resolve identity, reuse an identical plan, return a live operation, claim,
 * enqueue — against the same database guarantees. This is the fourth consumer
 * of one execution foundation, not a fourth mechanism.
 *
 * What identity means here is the interesting part: a plan is identified by the
 * *Move* it carries through as well as the audit behind it. Planning a
 * different Move from the same audit is correctly a different plan, and
 * replanning the same Move from the same evidence is correctly a reuse rather
 * than a second paid call (§53, §86, §87).
 */
export async function startActionPlanOperation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: {
    projectId: string;
    userId: string;
    force?: boolean;
    /** An explicit founder choice of Move (§83). Absent, and unconditionally rank 1, for every existing caller. */
    requestedOpportunityId?: string | null;
  },
): Promise<StartOperationOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  // Refuses outright when the audit or the Moves are missing or stale: planning
  // from a judgment we already know is out of date produces a confident plan
  // for a business that has since changed, and nothing on screen would say so.
  const identity = await resolveActionPlanIdentity(
    supabase,
    params.projectId,
    params.requestedOpportunityId ?? null,
  );
  if (!identity.ok) return { kind: "failed", error: identity.error };

  if (!params.force) {
    const reusable = await findReusableActionPlan(supabase, {
      projectId: params.projectId,
      inputHash: identity.inputHash,
    });
    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "action_plan.reused",
        metadata: {
          projectId: params.projectId,
          actionPlanId: reusable.id,
          auditId: identity.auditId,
          opportunityId: identity.opportunityId,
        },
      });
      return { kind: "reused", auditId: reusable.id };
    }
  }

  const alreadyActive = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "action_planning",
    inputIdentity: identity.inputHash,
  });
  if (alreadyActive) return { kind: "active", operation: view(alreadyActive) };

  // Everything above is free (§41, §81): opening a persisted plan, its Timeline
  // and Start Here, and every bit of Planner navigation reuse this path and
  // return before reaching a reservation.
  const affordable = await checkOperationAffordability(supabase, {
    projectId: params.projectId,
    operation: "action_plan",
  });
  if ("refusal" in affordable) return { kind: "failed", error: "insufficient_credits" };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "action_planning",
    inputIdentity: identity.inputHash,
    // The Move this run is for, whether that is rank 1 by default or a
    // founder's explicit choice — so the durable step below resolves against
    // the exact Move the operation was created for, not "whatever rank 1 is
    // by the time the step runs" (§83, mirrors `change_preparation`).
    subjectId: identity.opportunityId,
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      // Lost the race by milliseconds — the other click's operation is the
      // right answer, not an error.
      const existing = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "action_planning",
        inputIdentity: identity.inputHash,
      });
      if (existing) return { kind: "active", operation: view(existing) };
    }
    return { kind: "failed", error: "action_planning_failed" };
  }

  const operation = created.operation;

  // Service-role client — see the same reservation in
  // `startBusinessAuditOperation` for why.
  const held = await holdOperationCredits(createServiceClient(), {
    projectId: params.projectId,
    operationRunId: operation.id,
    operation: "action_plan",
  });

  if (!held.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "insufficient_credits",
    });
    return { kind: "failed", error: "insufficient_credits" };
  }

  const started = await executor.start({
    operationId: operation.id,
    operationType: "action_planning",
  });

  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    await releaseHoldForFailedStart(operation.id);
    return { kind: "failed", error: "execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "operation.started",
    metadata: {
      projectId: params.projectId,
      operationId: operation.id,
      operationType: "action_planning",
      executionProvider: executor.name,
    },
  });

  return { kind: "started", operation: view(operation) };
}

/** The live planning run a reloaded page should display. */
export async function getActiveActionPlanOperation(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OperationView | null> {
  const operation = await findActiveOperation(supabase, {
    projectId,
    operationType: "action_planning",
  });
  return operation ? view(operation) : null;
}

/** The live generation a reloaded project page should display (Sprint 7 §19). */
export async function getActiveOpportunityOperation(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OperationView | null> {
  const operation = await findActiveOperation(supabase, {
    projectId,
    operationType: "opportunity_generation",
  });
  return operation ? view(operation) : null;
}
