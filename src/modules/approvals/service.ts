import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange } from "@/modules/execution/store";
import { isReviewExpired } from "@/modules/review/schema";
import { getLatestReviewForPreparedChange } from "@/modules/review/store";
import { getLatestValidationForPreparedChange } from "@/modules/validation/store";
import { computeApprovalIdentity } from "./identity";
import {
  APPROVAL_POLICY_VERSION,
  type ApprovalBlockReason,
  type ApprovalInvalidationReason,
  type ChangeApproval,
} from "./schema";
import {
  createApproval,
  findActiveApprovalByIdentity,
  findApprovalByIdentity,
  getApproval,
  getLatestApprovalForPreparedChange,
  invalidateApproval,
  revokeApproval,
} from "./store";
import { buildApprovalCard, type ApprovalCard } from "./view";

/**
 * Approving and revoking one exact reviewed change (Sprint 11B §4, §8, §9, §27).
 *
 * ## What the client is allowed to say
 *
 * Three identifiers and a boolean: which project, which prepared change, which
 * review artifact, and *yes I confirmed*. Nothing else.
 *
 * It cannot name the commit, the base, the validation run, the policy version,
 * the approver, the timestamp or the status. Not because those are validated
 * and rejected — because there is no parameter to put them in. A caller who
 * could name the commit could obtain an approval for bytes no human ever saw,
 * and Sprint 11C would later treat that row as the reason it was allowed to
 * write to someone's default branch.
 *
 * ## Why there is no operation run
 *
 * Approval is one bounded database transaction with no external side effect:
 * no sandbox, no browser, no model, no GitHub call (§27, §28). Durability in
 * this codebase exists for work that survives a request *because a provider is
 * doing something expensive or irreversible* — not for work that merely
 * matters. Making approval durable would add a queue between a person clicking
 * and the product recording what they decided, which is strictly worse.
 */

export type ApproveChangeParams = {
  projectId: string;
  userId: string;
  preparedChangeId: string;
  /**
   * The comparison the human says they reviewed.
   *
   * Named by the client, never trusted as authority: the server independently
   * resolves the current ready comparison for this change and refuses if the
   * two disagree. It exists so an approval cannot be recorded against an
   * artifact the user was not actually looking at — a stale tab approving a
   * comparison that has since been replaced.
   */
  reviewArtifactId: string;
  /** The explicit human confirmation. The dialog is not what authorizes this (§8). */
  confirmed: boolean;
};

export type ApproveChangeOutcome =
  | { kind: "approved"; approval: ChangeApproval }
  /** This exact artifact was already approved. One logical result (§12). */
  | { kind: "already_approved"; approval: ChangeApproval }
  | { kind: "blocked"; reason: ApprovalBlockReason };

export type RevokeApprovalParams = {
  projectId: string;
  userId: string;
  approvalId: string;
  confirmed: boolean;
};

export type RevokeApprovalOutcome =
  | { kind: "revoked"; approval: ChangeApproval }
  /** Already terminal. Revoking twice is safe and says the same thing (§32). */
  | { kind: "already_inactive"; approval: ChangeApproval }
  | { kind: "blocked"; reason: ApprovalBlockReason };

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
 * The exact artifact a human could approve right now, resolved from the server.
 *
 * Every branch is a refusal with a reason the UI can render, and none of them
 * writes anything. The order is deliberate: it walks the trust pipeline in the
 * order the gates were built, so the message a user gets names the *first*
 * thing missing rather than the last thing checked.
 */
type ApprovalTarget = {
  preparedCommitSha: string;
  preparedBaseSha: string;
  validationRunId: string;
  reviewArtifactId: string;
  identity: string;
};

async function resolveApprovalTarget(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<{ ok: true; value: ApprovalTarget } | { ok: false; error: ApprovalBlockReason }> {
  const prepared = await getPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });
  if (!prepared || prepared.status !== "prepared" || !prepared.commitSha) {
    return { ok: false, error: "approval_change_not_prepared" };
  }

  const validation = await getLatestValidationForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });
  if (!validation || validation.status !== "passed") {
    return { ok: false, error: "approval_validation_required" };
  }

  const review = await getLatestReviewForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  // V0.1 requires a completed comparison, and requires it to be a comparison of
  // *this* change under *this* validation (§4). A review bound to an earlier
  // validation is evidence about different bytes.
  if (
    !review ||
    review.status !== "ready" ||
    review.preparedChangeId !== params.preparedChangeId ||
    review.validationRunId !== validation.id
  ) {
    return { ok: false, error: "approval_review_required" };
  }

  // Retention has passed, so the images are gone. Approving evidence nobody can
  // look at is not a human review, it is a click (§4).
  //
  // Note what this does *not* do: it never invalidates an approval that was
  // already given. A decision made while the comparison was viewable stays a
  // decision; only a *new* approval needs viewable evidence.
  if (isReviewExpired(review)) return { ok: false, error: "approval_review_expired" };

  return {
    ok: true,
    value: {
      preparedCommitSha: prepared.commitSha,
      preparedBaseSha: prepared.baseSha,
      validationRunId: validation.id,
      reviewArtifactId: review.id,
      identity: computeApprovalIdentity({
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
        preparedCommitSha: prepared.commitSha,
        preparedBaseSha: prepared.baseSha,
        validationRunId: validation.id,
        reviewArtifactId: review.id,
        approvalPolicyVersion: APPROVAL_POLICY_VERSION,
      }),
    },
  };
}

/**
 * Why a standing approval no longer describes what is on screen (§13).
 *
 * Ordered from the most consequential difference down. "The commit changed" and
 * "a newer comparison exists" both end the approval's applicability, but they
 * are not the same sentence to a user, and the reason is recorded so the UI
 * never has to guess which happened.
 */
function invalidationReasonFor(
  approval: ChangeApproval,
  target: ApprovalTarget,
): ApprovalInvalidationReason {
  if (
    approval.preparedCommitSha !== target.preparedCommitSha ||
    approval.preparedBaseSha !== target.preparedBaseSha
  ) {
    return "prepared_change_modified";
  }
  if (approval.validationRunId !== target.validationRunId) return "validation_superseded";
  return "review_superseded";
}

export async function approveChange(
  supabase: SupabaseClient,
  params: ApproveChangeParams,
): Promise<ApproveChangeOutcome> {
  // First, and before any read that could be mistaken for progress. An
  // unconfirmed call must leave nothing behind: no row, no audit event, no
  // provider call, no evidence that anything was ever attempted (§8, §31).
  if (!params.confirmed) return { kind: "blocked", reason: "approval_confirmation_required" };

  if (!(await ownsProject(supabase, params))) {
    // Deliberately the same answer for "no such project" and "not yours". A
    // caller who cannot see a project should not learn it exists.
    return { kind: "blocked", reason: "approval_not_authorized" };
  }

  const target = await resolveApprovalTarget(supabase, params);
  if (!target.ok) return { kind: "blocked", reason: target.error };

  // The client's idea of what was reviewed must match the server's. A stale tab
  // approving a comparison that has since been replaced is exactly the
  // "approved the wrong thing" failure this sprint exists to prevent.
  if (params.reviewArtifactId !== target.value.reviewArtifactId) {
    return { kind: "blocked", reason: "approval_review_required" };
  }

  const existing = await findActiveApprovalByIdentity(supabase, {
    projectId: params.projectId,
    approvalIdentity: target.value.identity,
  });
  if (existing) return { kind: "already_approved", approval: existing };

  const created = await createApproval(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    preparedChangeId: params.preparedChangeId,
    validationRunId: target.value.validationRunId,
    reviewArtifactId: target.value.reviewArtifactId,
    preparedCommitSha: target.value.preparedCommitSha,
    preparedBaseSha: target.value.preparedBaseSha,
    approvalPolicyVersion: APPROVAL_POLICY_VERSION,
    approvalIdentity: target.value.identity,
  });

  if (!created.ok) {
    // The other half of a double click reached the index first. Its row is the
    // approval, and reporting it is the honest answer — not an error, and not a
    // second decision (§12).
    if (created.error === "already_active") {
      const winner = await findActiveApprovalByIdentity(supabase, {
        projectId: params.projectId,
        approvalIdentity: target.value.identity,
      });
      if (winner) return { kind: "already_approved", approval: winner };
    }
    return { kind: "blocked", reason: "approval_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_approval.created",
    metadata: {
      project_id: params.projectId,
      prepared_change_id: params.preparedChangeId,
      approval_id: created.approval.id,
      // The commit is the point of the record: an audit entry that cannot say
      // *what* was approved documents nothing. A commit SHA is a public
      // identifier of content, not a credential.
      prepared_commit_sha: created.approval.preparedCommitSha,
      approval_policy_version: APPROVAL_POLICY_VERSION,
    },
  });

  return { kind: "approved", approval: created.approval };
}

export async function revokeChangeApproval(
  supabase: SupabaseClient,
  params: RevokeApprovalParams,
): Promise<RevokeApprovalOutcome> {
  if (!params.confirmed) return { kind: "blocked", reason: "approval_confirmation_required" };

  if (!(await ownsProject(supabase, params))) {
    return { kind: "blocked", reason: "approval_not_authorized" };
  }

  const revoked = await revokeApproval(supabase, {
    projectId: params.projectId,
    approvalId: params.approvalId,
    userId: params.userId,
  });

  if (!revoked) {
    // The update matched nothing. Either it was already terminal — in which
    // case a second revoke is a no-op and says the same thing — or the row is
    // not this user's to withdraw, which is not something to explain.
    const current = await getApproval(supabase, {
      projectId: params.projectId,
      approvalId: params.approvalId,
    });
    if (!current || current.userId !== params.userId) {
      return { kind: "blocked", reason: "approval_not_authorized" };
    }
    return { kind: "already_inactive", approval: current };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_approval.revoked",
    metadata: {
      project_id: params.projectId,
      prepared_change_id: revoked.preparedChangeId,
      approval_id: revoked.id,
      prepared_commit_sha: revoked.preparedCommitSha,
    },
  });

  return { kind: "revoked", approval: revoked };
}

/**
 * The approval state for one prepared change, decided on the server (§24).
 *
 * ## Why this may write
 *
 * Because an approval that no longer applies has to stop saying it does, and
 * nothing in this product runs on a timer. The transition happens when someone
 * looks — the same honest model preview expiry uses — rather than through a
 * background job the product does not have and would otherwise be implying.
 *
 * The write is opportunistic: the card is derived either way, so a failed
 * update degrades to "shown correctly, recorded later" rather than to a page
 * that lies. What it never does is the reverse — an approval is never revived
 * by a read.
 *
 * ## What this costs
 *
 * A few row reads. No sandbox, no browser, no model, no GitHub call. Opening
 * this page must remain free (§27).
 */
export async function getApprovalCard(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    /** Safe copy for a block reason. Never an internal error string. */
    resolveBlockMessage: (reason: ApprovalBlockReason) => string | null;
  },
): Promise<ApprovalCard> {
  const target = await resolveApprovalTarget(supabase, params);

  const latest = await getLatestApprovalForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  // Nothing is approvable, so there is nothing for an approval to still match.
  // Any approval that exists is therefore history about something else.
  if (!target.ok) {
    return buildApprovalCard({
      blockReason: target.error,
      blockMessage: params.resolveBlockMessage(target.error),
      approvalForCurrentArtifact: null,
      supersededApproval: latest && latest.status !== "revoked" ? latest : null,
      currentCommitSha: null,
    });
  }

  const forCurrent = await findApprovalByIdentity(supabase, {
    projectId: params.projectId,
    approvalIdentity: target.value.identity,
  });

  let superseded: ChangeApproval | null = null;

  // A standing approval for a *different* artifact is the case §13 exists for.
  // It is not retargeted and it is not deleted — it is recorded as no longer
  // applying, with the reason it stopped.
  if (latest && latest.approvalIdentity !== target.value.identity) {
    if (latest.status === "approved") {
      const reason = invalidationReasonFor(latest, target.value);
      const invalidated = await invalidateApproval(supabase, {
        projectId: params.projectId,
        approvalId: latest.id,
        reason,
      });

      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "change_approval.invalidated",
        metadata: {
          project_id: params.projectId,
          prepared_change_id: params.preparedChangeId,
          approval_id: latest.id,
          approved_commit_sha: latest.preparedCommitSha,
          current_commit_sha: target.value.preparedCommitSha,
          invalidation_reason: reason,
        },
      });

      // Prefer the persisted row, but never depend on the write having landed:
      // the user is told the truth on this render either way.
      superseded = invalidated ?? { ...latest, status: "invalidated", invalidationReason: reason };
    } else if (latest.status === "invalidated") {
      superseded = latest;
    }
  }

  return buildApprovalCard({
    blockReason: null,
    blockMessage: null,
    approvalForCurrentArtifact: forCurrent,
    supersededApproval: superseded,
    currentCommitSha: target.value.preparedCommitSha,
  });
}

/**
 * The standing approval for exactly the artifact currently on screen (§24).
 *
 * Exported for the merge gate, which must not re-derive artifact identity for
 * itself. Two identity resolutions would be two chances to disagree, and the
 * disagreement would surface as a merge authorized by an approval of something
 * else — the one failure ADR 0018 exists to make impossible.
 *
 * Returns null when the artifact is not approvable at all, when no approval
 * exists for it, or when the approval that exists was revoked or invalidated.
 * All three mean the same thing to a caller: **there is no standing human
 * decision about these bytes.**
 *
 * Read-only. Unlike `getApprovalCard`, this never invalidates anything: a merge
 * preflight asking a question must not have the side effect of changing an
 * approval's state.
 */
export async function findActiveApprovalForCurrentArtifact(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<ChangeApproval | null> {
  const target = await resolveApprovalTarget(supabase, params);
  if (!target.ok) return null;

  return findActiveApprovalByIdentity(supabase, {
    projectId: params.projectId,
    approvalIdentity: target.value.identity,
  });
}

export type { ApprovalCard };
