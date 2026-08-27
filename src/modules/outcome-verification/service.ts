import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  attachExecutionRun,
  createOperationRun,
  failOperationRun,
  findActiveOperationByIdentity,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import { evaluateOutcomeEligibility } from "./eligibility";
import { outcomeFailureMessage } from "./messages";
import {
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OUTCOME_POLICY_VERSION,
  type OutcomeFailureCode,
} from "./schema";
import {
  createOutcomeVerification,
  findVerificationByIdentity,
  getLatestVerificationForPreparedChange,
} from "./store";
import { buildOutcomeCard, type OutcomeCard } from "./view";

/**
 * Requesting and observing a production outcome (Sprint 12A §24, §25, §26, §27).
 *
 * ## What the client is allowed to say
 *
 * Two identifiers: which project, which prepared change. That is the entire
 * surface.
 *
 * It cannot name the production URL, the hostname, the protocol, a path, a
 * redirect target, the endpoints to fetch, the expected outcome, the profile,
 * the policy version or the observation window. Not because those are validated
 * and rejected — because there is no parameter to put them in (§11). A caller
 * who could name the origin could point Vibe's outbound requests at any host
 * reachable from its network, which is the threat this reuses the safe-fetch
 * boundary to close.
 *
 * ## Why it is explicit, and why there is no confirmation dialog
 *
 * Explicit because this is a new product operation and its semantics should be
 * observable before it is automated: nothing starts an observation just because
 * a merge finished (§25). A dialog because there is nothing to warn about —
 * verification is read-only, makes a handful of public GETs against the
 * customer's own website, and has no side effect to be sorry about. Adding
 * ceremony where none is needed devalues the ceremony that is (§26).
 *
 * ## What it costs
 *
 * Zero AI calls, zero sandboxes, zero browser sessions, zero GitHub writes, and
 * — notably — zero GitHub *reads*. Everything a verification needs about the
 * merge is already on the immutable merge record (§28, §52).
 */

export type StartOutcomeVerificationParams = {
  projectId: string;
  userId: string;
  preparedChangeId: string;
};

export type StartOutcomeVerificationOutcome =
  /** Durable observation is now enqueued. */
  | { kind: "started"; operation: OperationView; verificationId: string }
  /** This exact question is already being answered, or already has been (§27). */
  | { kind: "active"; operation: OperationView | null; verificationId: string }
  | { kind: "blocked"; reason: OutcomeFailureCode };

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

async function ownsProject(
  supabase: SupabaseClient,
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

/**
 * Starts a durable outcome verification (§18, §27).
 *
 * A sequence of refusals before it is a sequence of actions:
 *
 *   own the project? → merged and read back? → verifier exists? → safe origin?
 *   → already answered? → freeze the expectation → claim → enqueue
 *
 * **Nothing in this function makes an outbound request.** The expectation is
 * computed from persisted evidence and frozen onto the row *before* the durable
 * observation starts, which is what makes §9 true: production cannot influence
 * what Vibe said it was looking for.
 */
export async function startOutcomeVerification(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartOutcomeVerificationParams,
): Promise<StartOutcomeVerificationOutcome> {
  if (!(await ownsProject(supabase, params))) {
    // The same answer for "no such project" and "not yours".
    return { kind: "blocked", reason: "outcome_not_authorized" };
  }

  const eligibility = await evaluateOutcomeEligibility(supabase, params);
  if (!eligibility.eligible) return { kind: "blocked", reason: eligibility.reason };

  // Already asked. Returning the existing record is the honest answer to a
  // double click and to a deliberate re-request alike: the question has an
  // answer, or is being answered, and asking again would not make it truer
  // (§27).
  const existing = await findVerificationByIdentity(supabase, {
    projectId: params.projectId,
    verificationIdentity: eligibility.verificationIdentity,
  });

  if (existing) {
    const active = existing.operationRunId
      ? await findActiveOperationByIdentity(supabase, {
          projectId: params.projectId,
          operationType: "change_outcome_verification",
          inputIdentity: eligibility.verificationIdentity,
        })
      : null;

    return { kind: "active", operation: active ? view(active) : null, verificationId: existing.id };
  }

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "change_outcome_verification",
    inputIdentity: eligibility.verificationIdentity,
    initiatedBy: "customer",
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      const active = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "change_outcome_verification",
        inputIdentity: eligibility.verificationIdentity,
      });
      const row = await findVerificationByIdentity(supabase, {
        projectId: params.projectId,
        verificationIdentity: eligibility.verificationIdentity,
      });
      if (active && row) {
        return { kind: "active", operation: view(active), verificationId: row.id };
      }
    }
    return { kind: "blocked", reason: "outcome_verification_failed" };
  }

  const operation = created.operation;

  const verification = await createOutcomeVerification(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    changeMergeId: eligibility.changeMergeId,
    preparedChangeId: eligibility.preparedChangeId,
    changeApprovalId: eligibility.changeApprovalId,
    mergedCommitSha: eligibility.mergedCommitSha,
    capability: eligibility.capability,
    capabilityVersion: eligibility.capabilityVersion,
    outcomeProfile: eligibility.outcomeProfile,
    outcomeProfileVersion: eligibility.outcomeProfileVersion,
    outcomePolicyVersion: OUTCOME_POLICY_VERSION,
    evidenceSchemaVersion: OUTCOME_EVIDENCE_SCHEMA_VERSION,
    publicOrigin: eligibility.publicOrigin,
    // Frozen here, before anything is observed (§9).
    expectedOutcome: eligibility.expected,
    verificationIdentity: eligibility.verificationIdentity,
    operationRunId: operation.id,
  });

  if (!verification.ok) {
    // Either the identity index refused, or RLS refused the linkage — which on
    // this table means the merge is not what the caller believes. Failing the
    // operation now releases the identity so a corrected attempt is possible.
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "outcome_verification_failed",
    });
    return { kind: "blocked", reason: "outcome_verification_failed" };
  }

  const started = await executor.start({
    operationId: operation.id,
    operationType: "change_outcome_verification",
  });

  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    return { kind: "blocked", reason: "outcome_execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_outcome.started",
    metadata: {
      project_id: params.projectId,
      change_merge_id: eligibility.changeMergeId,
      change_outcome_verification_id: verification.verification.id,
      prepared_change_id: eligibility.preparedChangeId,
      operation_id: operation.id,
      // A public content identifier, exactly as the merge events carry.
      merged_commit_sha: eligibility.mergedCommitSha,
      capability: eligibility.capability,
      outcome_profile: eligibility.outcomeProfile,
      outcome_profile_version: eligibility.outcomeProfileVersion,
      outcome_policy_version: OUTCOME_POLICY_VERSION,
      // Origin only — never a full URL with a query string (CLAUDE.md rule 37).
      public_origin: eligibility.publicOrigin,
      expected_check_count: eligibility.expected.checks.length,
    },
  });

  return { kind: "started", operation: view(operation), verificationId: verification.verification.id };
}

/**
 * The outcome state for one prepared change (§29).
 *
 * ## What this costs
 *
 * Two database reads and nothing else. No provider call, no GitHub call, and
 * **no outbound HTTP** — opening a project page must never contact a customer's
 * production website, and must never create an observation operation (§43).
 */
export async function getOutcomeCard(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<OutcomeCard> {
  const [latest, eligibility] = await Promise.all([
    getLatestVerificationForPreparedChange(supabase, params),
    evaluateOutcomeEligibility(supabase, params),
  ]);

  return buildOutcomeCard({
    latest,
    eligibility,
    resolveFailureMessage: outcomeFailureMessage,
  });
}

export type { OutcomeCard };
