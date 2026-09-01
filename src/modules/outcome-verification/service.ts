import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredPreparedChange } from "@/modules/execution/store";
import type { ChangeMerge } from "@/modules/merge/schema";
import { getSnapshotsByIds } from "@/modules/repository-intelligence/store";
import { getLatestVerificationsForPreparedChanges } from "./store";
import { assertPrefetchedFor } from "@/lib/db/latest-per-change";
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
import {
  evaluateOutcomeEligibility,
  resolvePublicOrigin,
  type PrefetchedOutcomeInputs,
} from "./eligibility";
import { outcomeFailureMessage } from "./messages";
import {
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OUTCOME_POLICY_VERSION,
  type ChangeOutcomeVerification,
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
/**
 * The card for a change with no verification and no eligibility.
 *
 * Exported so a caller holding no entry for a change renders the same answer
 * this module would give, rather than an invented one.
 */
export function unavailableOutcomeCard(): OutcomeCard {
  return buildOutcomeCard({
    latest: null,
    eligibility: { eligible: false, reason: "outcome_merge_required" },
    resolveFailureMessage: outcomeFailureMessage,
  });
}

/**
 * The same card for a whole list, with the shared reads made once (VB-023).
 *
 * ## Why the batch lives here
 *
 * Because a merged change's eligibility needs three things a caller cannot
 * batch without knowing this module's internals: the latest verification, the
 * project's public origin — one row per *project*, previously read once per
 * merged change — and the repository snapshot the change was prepared against,
 * which in practice is the same snapshot for every change in a list.
 *
 * A change that was never merged costs nothing beyond the verification read: it
 * is refused before the origin is consulted, which is what keeps the ordinary
 * list cheap.
 */
export async function getOutcomeCards(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    changes: readonly {
      preparedChangeId: string;
      merge: ChangeMerge | null;
      prepared: StoredPreparedChange | null;
    }[];
  },
): Promise<Map<string, OutcomeCard>> {
  const preparedChangeIds = params.changes.map((change) => change.preparedChangeId);

  const merged = params.changes.filter(
    (change) => change.merge?.status === "merged" && change.prepared !== null,
  );

  const [verifications, publicOrigin, snapshots] = await Promise.all([
    getLatestVerificationsForPreparedChanges(supabase, {
      projectId: params.projectId,
      preparedChangeIds,
    }),
    // Only asked when something in the list could reach the branch that wants
    // it. On a project that has never merged, this is no query at all.
    merged.length > 0 ? resolvePublicOrigin(supabase, params.projectId) : null,
    getSnapshotsByIds(supabase, {
      projectId: params.projectId,
      snapshotIds: merged.map((change) => change.prepared?.repositorySnapshotId ?? ""),
    }),
  ]);

  const cards = new Map<string, OutcomeCard>();

  for (const change of params.changes) {
    cards.set(
      change.preparedChangeId,
      await getOutcomeCard(supabase, {
        projectId: params.projectId,
        preparedChangeId: change.preparedChangeId,
        prefetched: {
          outcome: verifications.get(change.preparedChangeId) ?? null,
          merge: change.merge,
          prepared: change.prepared,
          publicOrigin,
          snapshot: change.prepared
            ? (snapshots.get(change.prepared.repositorySnapshotId) ?? null)
            : null,
        },
      }),
    );
  }

  return cards;
}

export async function getOutcomeCard(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    /**
     * The verification, merge and prepared change the caller already holds
     * (VB-023). Present means this card costs no read at all for a change that
     * was never merged, which is most of them.
     */
    prefetched?: PrefetchedOutcomeInputs & { outcome: ChangeOutcomeVerification | null };
  },
): Promise<OutcomeCard> {
  const [latest, eligibility] = await Promise.all([
    params.prefetched
      ? assertPrefetchedFor(params.prefetched.outcome, params, "outcome verification")
      : getLatestVerificationForPreparedChange(supabase, params),
    evaluateOutcomeEligibility(supabase, params),
  ]);

  return buildOutcomeCard({
    latest,
    eligibility,
    resolveFailureMessage: outcomeFailureMessage,
  });
}

export type { OutcomeCard };
