import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPrefetchedFor, assertPreparedChangeIs } from "@/lib/db/latest-per-change";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange, type StoredPreparedChange } from "@/modules/execution/store";
import { computeCodeReviewDigest } from "@/modules/execution/code-review-digest";
import type { ReviewClassificationResult } from "@/modules/review/classification";
import { isReviewExpired, type ReviewArtifact } from "@/modules/review/schema";
import { getLatestReviewForPreparedChange } from "@/modules/review/store";
import {
  getLatestValidationForPreparedChange,
  type StoredValidationRun,
} from "@/modules/validation/store";
import { computeApprovalIdentity, type ApprovalEvidence } from "./identity";
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
   * The comparison the human says they reviewed, or null for a code review.
   *
   * Named by the client, never trusted as authority: the server independently
   * resolves what this change may be approved on and refuses if the two
   * disagree. It exists so an approval cannot be recorded against an artifact
   * the user was not actually looking at — a stale tab approving a comparison
   * that has since been replaced, or one sending an artifact id for a change
   * the server has since decided needs no comparison at all.
   */
  reviewArtifactId: string | null;
  /**
   * Which review this change deserves, resolved by the caller (ADR 0063).
   *
   * The action layer computes it once and hands it down, for the reason
   * `ApprovalClassification` documents: three call sites must agree, and the
   * inputs are too expensive to resolve three times.
   */
  classification: ApprovalClassification;
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
  /**
   * What the human is being shown, and therefore what their yes is about.
   *
   * Which form applies is decided by the review classification, never by the
   * caller and never by what happens to exist — a change that alters a rendered
   * page cannot be approved on a diff just because no comparison was captured.
   */
  evidence: ApprovalEvidence;
  reviewClassification: ReviewClassificationResult | null;
  identity: string;
};

/**
 * The rows the target is derived from, when a caller already holds them.
 *
 * Every one is a row a list render has read once for the whole list, and
 * re-reading them per card was three of the thirteen reads a card cost
 * (VB-023). Supplying them changes nothing about which gates are checked or in
 * what order — only where the bytes came from.
 */
export type PrefetchedApprovalInputs = {
  prepared: StoredPreparedChange | null;
  validation: StoredValidationRun | null;
  review: ReviewArtifact | null;
};

/**
 * Which review this change deserves, decided elsewhere and handed in.
 *
 * Deliberately a *parameter* rather than something this module fetches.
 * Computing it needs the repository analyzer's snapshot, the execution spec
 * chain and — for the render-impact probe — bounded GitHub reads, none of which
 * belong behind a function whose job is to answer a question about rows. It is
 * also resolved three times per rendered card (the approval card, the merge
 * preflight, and the click itself), and those three must agree; one caller
 * computing it once is how they are made to.
 *
 * `null` is a real answer and means *not determinable*, which resolves to the
 * stricter path: a visual comparison is required, exactly as it was before this
 * sprint. Missing evidence is never a good result (CLAUDE.md rule 44).
 */
export type ApprovalClassification = ReviewClassificationResult | null;

/**
 * Whether a change of this classification may be approved on a diff alone.
 *
 * One function, so the rule lives in one place and every caller — the approval
 * gate, the progress model, the card — asks the same question of the same
 * table. `visual_and_code` deliberately answers no: half of it is visible, and
 * the half that is visible is the half a diff cannot show.
 */
export function approvableOnDiffAlone(classification: ApprovalClassification): boolean {
  return classification?.classification === "code";
}

/**
 * The part of an approval target that has nothing to do with evidence.
 *
 * Split out because two questions need it and only one of them may ask about
 * evidence at all. Creating an approval must know which evidence is *required*;
 * a merge gate must not, and §14 below says why.
 */
type ApprovalPremises = {
  preparedCommitSha: string;
  preparedBaseSha: string;
  validationRunId: string;
  changedPaths: readonly string[];
};

async function resolveApprovalPremises(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    prefetched?: PrefetchedApprovalInputs;
  },
): Promise<{ ok: true; value: ApprovalPremises } | { ok: false; error: ApprovalBlockReason }> {
  const prepared = params.prefetched
    ? assertPreparedChangeIs(params.prefetched.prepared, params)
    : await getPreparedChange(supabase, {
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
      });
  if (!prepared || prepared.status !== "prepared" || !prepared.commitSha) {
    return { ok: false, error: "approval_change_not_prepared" };
  }

  const validation = params.prefetched
    ? assertPrefetchedFor(params.prefetched.validation, params, "validation")
    : await getLatestValidationForPreparedChange(supabase, {
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
      });
  if (!validation || validation.status !== "passed") {
    return { ok: false, error: "approval_validation_required" };
  }

  return {
    ok: true,
    value: {
      preparedCommitSha: prepared.commitSha,
      preparedBaseSha: prepared.baseSha,
      validationRunId: validation.id,
      changedPaths: prepared.files.map((file) => file.path),
    },
  };
}

/** One identity, built the same way wherever it is needed. */
function identityFor(
  params: { projectId: string; preparedChangeId: string },
  premises: ApprovalPremises,
  evidence: ApprovalEvidence,
): string {
  return computeApprovalIdentity({
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
    preparedCommitSha: premises.preparedCommitSha,
    preparedBaseSha: premises.preparedBaseSha,
    validationRunId: premises.validationRunId,
    evidence,
    approvalPolicyVersion: APPROVAL_POLICY_VERSION,
  });
}

/**
 * The exact artifact a human could approve **right now**.
 *
 * This is the creating side, and the only side that consults the
 * classification: it answers *what evidence would a new approval have to rest
 * on?* An approval that already exists is not re-asked that question — see
 * `findActiveApprovalForCurrentArtifact`.
 */
async function resolveApprovalTarget(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    /** Which review this change deserves. `null` means the stricter path. */
    classification: ApprovalClassification;
    prefetched?: PrefetchedApprovalInputs;
  },
): Promise<{ ok: true; value: ApprovalTarget } | { ok: false; error: ApprovalBlockReason }> {
  const premises = await resolveApprovalPremises(supabase, params);
  if (!premises.ok) return premises;

  /*
   * Which evidence this change is entitled to be approved on (ADR 0063).
   *
   * The classification decides, and it is Vibe's own deterministic answer from
   * verified changed paths and the analyzer's route table — never a model, and
   * never the caller. The thing being reviewed does not get to choose how it is
   * reviewed, and neither does a client with a stale tab.
   */
  const evidence: ApprovalEvidence | { blocked: ApprovalBlockReason } = approvableOnDiffAlone(
    params.classification,
  )
    ? {
        kind: "code_diff",
        codeReviewDigest: computeCodeReviewDigest({
          projectId: params.projectId,
          preparedChangeId: params.preparedChangeId,
          preparedBaseSha: premises.value.preparedBaseSha,
          preparedCommitSha: premises.value.preparedCommitSha,
          paths: premises.value.changedPaths,
        }),
      }
    : await resolveReviewArtifactEvidence(supabase, params, premises.value.validationRunId);

  if ("blocked" in evidence) return { ok: false, error: evidence.blocked };

  return {
    ok: true,
    value: {
      preparedCommitSha: premises.value.preparedCommitSha,
      preparedBaseSha: premises.value.preparedBaseSha,
      validationRunId: premises.value.validationRunId,
      evidence,
      reviewClassification: params.classification,
      identity: identityFor(params, premises.value, evidence),
    },
  };
}

/** What a stored approval actually rested on. Null for a row shaped like neither. */
function evidenceOf(approval: ChangeApproval): ApprovalEvidence | null {
  if (approval.codeReviewDigest !== null) {
    return { kind: "code_diff", codeReviewDigest: approval.codeReviewDigest };
  }
  if (approval.reviewArtifactId !== null) {
    return { kind: "review_artifact", reviewArtifactId: approval.reviewArtifactId };
  }
  return null;
}

/**
 * The visual half, unchanged from Sprint 11B §4.
 *
 * Extracted only so the branch above reads as one decision rather than two
 * nested ones. Every refusal, and the reason for it, is exactly what it was.
 */
async function resolveReviewArtifactEvidence(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    prefetched?: PrefetchedApprovalInputs;
  },
  validationRunId: string,
): Promise<ApprovalEvidence | { blocked: ApprovalBlockReason }> {
  const review = params.prefetched
    ? assertPrefetchedFor(params.prefetched.review, params, "review")
    : await getLatestReviewForPreparedChange(supabase, {
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
      });

  // Requires a completed comparison, and requires it to be a comparison of
  // *this* change under *this* validation (§4). A review bound to an earlier
  // validation is evidence about different bytes.
  if (
    !review ||
    review.status !== "ready" ||
    review.preparedChangeId !== params.preparedChangeId ||
    review.validationRunId !== validationRunId
  ) {
    return { blocked: "approval_review_required" };
  }

  // Retention has passed, so the images are gone. Approving evidence nobody can
  // look at is not a human review, it is a click (§4).
  //
  // Note what this does *not* do: it never invalidates an approval that was
  // already given. A decision made while the comparison was viewable stays a
  // decision; only a *new* approval needs viewable evidence.
  if (isReviewExpired(review)) return { blocked: "approval_review_expired" };

  return { kind: "review_artifact", reviewArtifactId: review.id };
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

  /*
   * The evidence *form* changed, not the evidence. A change that needed only a
   * diff can come to need a visual review when the analyzer's route table
   * moves, and telling a user their comparison was superseded when they never
   * had one is a sentence they cannot act on.
   */
  const approvedOnDiff = approval.codeReviewDigest !== null;
  const targetOnDiff = target.evidence.kind === "code_diff";
  if (approvedOnDiff !== targetOnDiff) return "review_requirement_changed";

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

  /*
   * The client's idea of what was reviewed must match the server's. A stale tab
   * approving a comparison that has since been replaced is exactly the
   * "approved the wrong thing" failure Sprint 11B exists to prevent — and a tab
   * still sending an artifact id for a change the server now approves on a diff
   * is the same failure wearing this sprint's clothes.
   */
  const expectedArtifactId =
    target.value.evidence.kind === "review_artifact"
      ? target.value.evidence.reviewArtifactId
      : null;

  if (params.reviewArtifactId !== expectedArtifactId) {
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
    reviewArtifactId: expectedArtifactId,
    codeReviewDigest:
      target.value.evidence.kind === "code_diff"
        ? target.value.evidence.codeReviewDigest
        : null,
    // Pinned onto the row, not recomputed later. The classification reads the
    // analyzer's route table, and that table moves; a human's decision must
    // never be reinterpreted under a table they never saw (rule 67).
    reviewClassification: target.value.reviewClassification?.classification ?? null,
    reviewClassificationPolicyVersion: target.value.reviewClassification?.policyVersion ?? null,
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
      // Which evidence a human actually looked at. Without it the record cannot
      // distinguish an approval that rested on a comparison from one that
      // rested on a diff — and those are different decisions.
      review_evidence: created.approval.codeReviewDigest ? "code_diff" : "review_artifact",
      review_classification: created.approval.reviewClassification,
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
    /** Which review this change deserves. `null` means the stricter path. */
    classification: ApprovalClassification;
    /**
     * The prepared change, validation, review and approval the caller already
     * holds (VB-023). What still costs a read either way is
     * `findApprovalByIdentity` below: it is keyed by artifact identity rather
     * than by change, and an approval identity is the one thing in this
     * product that must never be resolved from a convenient nearby row.
     */
    prefetched?: PrefetchedApprovalInputs & { approval: ChangeApproval | null };
    /** Safe copy for a block reason. Never an internal error string. */
    resolveBlockMessage: (reason: ApprovalBlockReason) => string | null;
  },
): Promise<ApprovalCard> {
  const target = await resolveApprovalTarget(supabase, params);

  const latest = params.prefetched
    ? assertPrefetchedFor(params.prefetched.approval, params, "approval")
    : await getLatestApprovalForPreparedChange(supabase, {
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

  /*
   * The approval for exactly this artifact — from the row already read, when
   * that row can answer, and from a keyed lookup when it cannot.
   *
   * This is not "resolve identity from a convenient nearby row", which is the
   * thing this module refuses to do. It is the identity question itself, asked
   * of a stored hash: `latest` either carries the target identity or it does
   * not, and a change with no approvals at all cannot have one under any
   * identity, because the identity contains the prepared change id.
   *
   * The keyed read stays for the one case neither answers: a *superseded*
   * latest, where an older row may still match the artifact now on screen.
   *
   * Sprint 0055 made this matter. Before it, a change awaiting a comparison was
   * not approvable, so this lookup never ran for most cards; now a code-only
   * change is approvable the moment it validates, and running it per card would
   * have turned a fixed-cost render back into a fan-out (VB-023).
   */
  const forCurrent =
    latest === null
      ? null
      : latest.approvalIdentity === target.value.identity
        ? latest
        : await findApprovalByIdentity(supabase, {
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
 *
 * ## Why this does not consult the review classification (ADR 0063)
 *
 * Because the classification answers *what would a new approval need?*, and
 * this is asking about one that already exists.
 *
 * The classification is derived partly from the analyzer's route table, which
 * moves. Recomputing it here would mean a newer repository snapshot could
 * change which evidence form the identity is built from, and a real, standing,
 * unrevoked human approval would then simply stop being found — a merge refused
 * on the strength of a table the approver never saw. That is precisely what
 * CLAUDE.md rule 68 forbids: drift after an approval never rewrites what a
 * human decided.
 *
 * So the evidence comes off the approval row, where it was pinned when the
 * decision was made, and the identity is recomputed around it. Everything else
 * — commit, base, validation, policy version — is still re-derived from current
 * state, so a regenerated commit or a newer validation still ends the
 * approval's applicability exactly as before.
 */
export async function findActiveApprovalForCurrentArtifact(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    /**
     * The rows the target is derived from, when the caller holds them
     * (VB-023). Only the *premises* may be supplied this way. The approval
     * itself is still read below, because that read is the authority question
     * and it is never answered from a row handed in.
     */
    prefetched?: PrefetchedApprovalInputs & { approval?: ChangeApproval | null };
  },
): Promise<ChangeApproval | null> {
  const premises = await resolveApprovalPremises(supabase, params);
  if (!premises.ok) return null;

  /*
   * The latest approval, from the list read when the caller has it.
   *
   * Safe here in a way it would not be for a *decision*: what follows is an
   * identity comparison against a stored hash, so a stale row can only fail to
   * match — it can never make a merge look authorized when it is not. The
   * durable merge step supplies nothing and reads fresh, which is where
   * freshness is load-bearing (rule 70).
   */
  const latest =
    params.prefetched && "approval" in params.prefetched
      ? (params.prefetched.approval ?? null)
      : await getLatestApprovalForPreparedChange(supabase, {
          projectId: params.projectId,
          preparedChangeId: params.preparedChangeId,
        });
  if (!latest || latest.status !== "approved") return null;

  const evidence = evidenceOf(latest);
  // A row carrying neither evidence form is one the database's
  // `change_approvals_has_exactly_one_evidence` constraint refuses, so this is
  // unreachable through the product. It still refuses rather than guessing: an
  // approval that cannot say what it rested on authorizes nothing.
  if (!evidence) return null;

  return identityFor(params, premises.value, evidence) === latest.approvalIdentity ? latest : null;
}
