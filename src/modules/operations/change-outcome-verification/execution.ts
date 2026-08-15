import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import type { SafeFetchDependencies } from "@/modules/live-product-intelligence/net/safe-fetch";
import { DEFAULT_OUTCOME_BUDGETS, type OutcomeBudgets } from "@/modules/outcome-verification/budgets";
import {
  allChecksPassed,
  classifyOutcome,
  evaluateObservation,
} from "@/modules/outcome-verification/evaluate";
import { observePublicProduct } from "@/modules/outcome-verification/observe";
import { windowDeadline, withinWindow } from "@/modules/outcome-verification/schedule";
import type {
  ChangeOutcomeVerification,
  OutcomeCheckResult,
  OutcomeFailureCode,
  OutcomeStatus,
} from "@/modules/outcome-verification/schema";
import {
  completeOutcomeVerification,
  failOutcomeVerification,
  findVerificationByOperation,
  openObservationWindow,
  recordObservationAttempt,
} from "@/modules/outcome-verification/store";
import { completeOperationRun, failOperationRun, getOperationRunById, setOperationStage } from "../store";

/**
 * Durable steps for outcome verification (Sprint 12A §18, §19, §20, §42).
 *
 * ```
 * openWindow ─▶ observe(0) ─▶ … ─▶ observe(n) ─▶ conclude
 *      │            │                   │
 *      └────────────┴───────────────────┴────▶ fail (Vibe could not observe)
 * ```
 *
 * ## Why retries are allowed here, when the merge forbade them
 *
 * Because the acts are different in kind. `writeDefaultRef` moved a customer's
 * branch, and a platform retry there cannot distinguish "the request never
 * arrived" from "it arrived and succeeded", so ambiguity had to resolve to *not
 * doing it again*. A `GET /robots.txt` is idempotent, read-only and free —
 * repeating it under the schedule's budget is exactly what it is for, and the
 * second attempt is not a second consequence (§19).
 *
 * What retries must **not** do is blur the two failure vocabularies. A transport
 * error is a fact about Vibe's observation, never evidence that the customer's
 * product misbehaves.
 *
 * ## Why the deadline lives in the database
 *
 * A replayed workflow that recomputed its window from `now()` would extend it on
 * every re-entry, and a fifteen-minute observation would quietly become an
 * unbounded one. The window is opened once by a conditional update and read back
 * on every attempt, so replay, retry and resume all see the same deadline (§42).
 *
 * ## What is not here
 *
 * No model. No sandbox. No browser. No GitHub call of any kind, read or write.
 * No deployment provider. No repository refresh, no audit, no opportunity
 * generation — nothing that could start a paid cascade behind a click the user
 * thought was free (§24, §28, §52, §53).
 */

export type OutcomeDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The safe outbound HTTP boundary, injected so every path here is testable
   * with in-memory doubles that touch no network and no DNS.
   *
   * It is a `SafeFetchDependencies`, not a fetcher: the resolver and transport
   * are what `safeFetch` drives, and there is deliberately no seam at which a
   * caller could substitute a client that skips the address gate (§12, §40).
   */
  http: SafeFetchDependencies;
  budgets?: OutcomeBudgets;
};

export type OutcomeStepOutcome =
  /** Keep going: the window is open and not every expectation holds yet. */
  | { ok: true; done: false }
  /** Stop early: every expectation held (§20). */
  | { ok: true; done: true }
  /** Vibe could not observe reliably. */
  | { ok: false; failureCode: OutcomeFailureCode };

type OutcomeContext = {
  verification: ChangeOutcomeVerification;
  projectId: string;
  userId: string;
};

/**
 * Loads the verification this operation owns.
 *
 * Ownership comes from the persisted operation row, never from an argument: the
 * service-role client bypasses RLS entirely, so every query below has to assert
 * the project itself (CLAUDE.md rule 53).
 */
async function loadContext(deps: OutcomeDeps, operationId: string): Promise<OutcomeContext | null> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return null;

  const verification = await findVerificationByOperation(deps.supabase, operationId);
  if (!verification || verification.projectId !== operation.projectId) return null;

  return { verification, projectId: operation.projectId, userId: operation.userId };
}

/**
 * Step 1 — open the bounded observation window (§17, §42).
 *
 * Writes the deadline once and nothing else. Deliberately makes no outbound
 * request: separating "the window is open" from "we looked" is what lets a
 * replay of the first observation reuse the original deadline rather than
 * inherit one computed a step earlier.
 */
export async function openOutcomeWindowStep(
  deps: OutcomeDeps,
  operationId: string,
): Promise<OutcomeStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, failureCode: "outcome_verification_failed" };

  await setOperationStage(deps.supabase, {
    operationId,
    stage: "observing",
    markRunning: true,
  });

  const budgets = deps.budgets ?? DEFAULT_OUTCOME_BUDGETS;
  const startedAt = new Date();

  const opened = await openObservationWindow(deps.supabase, {
    verificationId: context.verification.id,
    projectId: context.projectId,
    windowStartedAt: startedAt,
    windowEndsAt: windowDeadline(startedAt, budgets),
  });

  if (!opened || opened.verificationWindowEndsAt === null) {
    return { ok: false, failureCode: "outcome_persistence_failed" };
  }

  return { ok: true, done: false };
}

/**
 * Step 2..n — one observation of the public product.
 *
 * Idempotent by construction: it reads, compares against the frozen
 * expectation, and overwrites the recorded results. Running it twice for the
 * same attempt index produces the same row, which is what makes retrying it
 * safe in a way the merge's write never was.
 */
export async function observeOutcomeStep(
  deps: OutcomeDeps,
  operationId: string,
  attemptNumber: number,
): Promise<OutcomeStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, failureCode: "outcome_verification_failed" };

  const { verification, projectId } = context;

  // Already answered — by an earlier attempt that passed everything, or by a
  // concurrent conclusion. Nothing further is owed to a terminal record.
  if (verification.status !== "observing") return { ok: true, done: true };

  // The stored deadline, never a recomputed one. A missing deadline reads as
  // expired rather than unlimited: one observation fewer is a far better
  // failure than a workflow polling somebody's website forever (§42).
  if (!withinWindow(verification.verificationWindowEndsAt, new Date())) {
    return { ok: true, done: true };
  }

  const observation = await observePublicProduct(verification.expectedOutcome, deps.http, {
    budgets: deps.budgets ?? DEFAULT_OUTCOME_BUDGETS,
  });

  const results = evaluateObservation(verification.expectedOutcome, observation);

  const recorded = await recordObservationAttempt(deps.supabase, {
    verificationId: verification.id,
    projectId,
    attemptNumber,
    checkResults: results,
    effectiveOrigin: observation.effectiveOrigin,
  });

  if (!recorded) {
    // The row moved out of `observing` underneath us, or the write failed.
    // Either way this attempt has nothing to add.
    return { ok: true, done: true };
  }

  // **Early success** (§20). Every expectation holds, so there is nothing left
  // to learn and continuing to poll a customer's production website would be
  // traffic rather than diligence.
  if (allChecksPassed(results)) {
    await concludeOutcome(deps, context, {
      status: "verified",
      results,
      attemptNumber,
      effectiveOrigin: observation.effectiveOrigin,
    });
    return { ok: true, done: true };
  }

  return { ok: true, done: false };
}

/**
 * Records the terminal product answer and the audit event that goes with it.
 *
 * Shared by the early-success path and the deadline path so the two can never
 * classify or report differently.
 */
async function concludeOutcome(
  deps: OutcomeDeps,
  context: OutcomeContext,
  params: {
    status: Extract<OutcomeStatus, "verified" | "partial" | "not_observed">;
    results: OutcomeCheckResult[];
    attemptNumber: number;
    effectiveOrigin: string | null;
  },
): Promise<boolean> {
  const completed = await completeOutcomeVerification(deps.supabase, {
    verificationId: context.verification.id,
    projectId: context.projectId,
    status: params.status,
    checkResults: params.results,
    attemptNumber: params.attemptNumber,
    effectiveOrigin: params.effectiveOrigin,
  });

  // `false` means the row was already terminal, which is exactly the signal a
  // replayed step needs to skip emitting a second audit event (§42).
  if (!completed) return false;

  await recordAuditEvent(deps.supabase, {
    userId: context.userId,
    eventType:
      params.status === "verified"
        ? "change_outcome.verified"
        : params.status === "partial"
          ? "change_outcome.partial"
          : "change_outcome.not_observed",
    metadata: {
      project_id: context.projectId,
      change_outcome_verification_id: context.verification.id,
      change_merge_id: context.verification.changeMergeId,
      prepared_change_id: context.verification.preparedChangeId,
      merged_commit_sha: context.verification.mergedCommitSha,
      capability: context.verification.capability,
      outcome_profile: context.verification.outcomeProfile,
      outcome_policy_version: context.verification.outcomePolicyVersion,
      public_origin: context.verification.publicOrigin,
      attempt_count: params.attemptNumber,
      // A safe summary: counts by status, never a response body, never a URL
      // read out of a fetched document (§35).
      checks_passed: params.results.filter((result) => result.status === "passed").length,
      checks_failed: params.results.filter((result) => result.status === "failed").length,
      checks_not_observed: params.results.filter((result) => result.status === "not_observed").length,
      checks_errored: params.results.filter((result) => result.status === "error").length,
    },
  });

  return true;
}

/**
 * Final step — classify whatever the window produced (§21, §22, §23).
 *
 * Reached only when no attempt passed everything. Reads the recorded results
 * rather than observing again: the last attempt already looked, and one more
 * request would be a different observation than the one being reported.
 */
export async function concludeOutcomeStep(
  deps: OutcomeDeps,
  operationId: string,
): Promise<OutcomeStepOutcome> {
  const context = await loadContext(deps, operationId);
  if (!context) return { ok: false, failureCode: "outcome_verification_failed" };

  const { verification } = context;

  // Already terminal — the early-success path concluded it.
  if (verification.status !== "queued" && verification.status !== "observing") {
    return { ok: true, done: true };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "evaluating" });

  const results = verification.checkResults ?? [];

  if (results.length === 0) {
    // The window closed without a single usable observation. That is a
    // statement about Vibe, not about the product (§23).
    return { ok: false, failureCode: "outcome_origin_unreachable" };
  }

  const status = classifyOutcome(results);

  if (status === "failed") {
    // Every check errored: DNS, TLS, a refused redirect or a rate limit
    // throughout. Vibe could not observe — it is not claiming the behaviour is
    // absent (§23).
    return { ok: false, failureCode: "outcome_origin_unreachable" };
  }

  const recorded = await concludeOutcome(deps, context, {
    status,
    results,
    attemptNumber: verification.attemptCount,
    effectiveOrigin: verification.effectiveOrigin,
  });

  if (!recorded && verification.status === "observing") {
    return { ok: false, failureCode: "outcome_persistence_failed" };
  }

  return { ok: true, done: true };
}

/** Marks the operation complete, pointing at the verification it produced. */
export async function completeOutcomeOperationStep(
  deps: OutcomeDeps,
  operationId: string,
): Promise<void> {
  const verification = await findVerificationByOperation(deps.supabase, operationId);

  if (!verification) {
    await failOperationRun(deps.supabase, {
      operationId,
      failureCode: "outcome_verification_failed",
    });
    return;
  }

  await completeOperationRun(deps.supabase, { operationId, resultId: verification.id });
}

/**
 * Records that Vibe could not perform a reliable verification (§23).
 *
 * Deliberately the only path that can produce `failed`, and deliberately
 * separate from `concludeOutcome`. "The outcome was not observed" and "Vibe
 * could not observe the outcome" are different sentences, and a shared code
 * path is how they eventually become one.
 */
export async function abortOutcomeStep(
  deps: OutcomeDeps,
  operationId: string,
  failureCode: OutcomeFailureCode,
): Promise<void> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  const verification = await findVerificationByOperation(deps.supabase, operationId);

  if (verification && operation && verification.projectId === operation.projectId) {
    const recorded = await failOutcomeVerification(deps.supabase, {
      verificationId: verification.id,
      projectId: verification.projectId,
      failureCode,
    });

    if (recorded) {
      await recordAuditEvent(deps.supabase, {
        userId: operation.userId,
        eventType: "change_outcome.failed",
        metadata: {
          project_id: verification.projectId,
          change_outcome_verification_id: verification.id,
          change_merge_id: verification.changeMergeId,
          prepared_change_id: verification.preparedChangeId,
          merged_commit_sha: verification.mergedCommitSha,
          capability: verification.capability,
          outcome_profile: verification.outcomeProfile,
          outcome_policy_version: verification.outcomePolicyVersion,
          public_origin: verification.publicOrigin,
          failure_code: failureCode,
          attempt_count: verification.attemptCount,
        },
      });
    }
  }

  await failOperationRun(deps.supabase, { operationId, failureCode });
}
