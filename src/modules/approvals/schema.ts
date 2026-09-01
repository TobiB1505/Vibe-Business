import type { ReviewClassification } from "@/modules/review/classification";

/**
 * The human approval domain (Sprint 11B §1, §2, §3, §11).
 *
 * ## What an approval is allowed to claim
 *
 * The product states each gate separately rather than blurring them:
 *
 * ```
 * repository_write_verified   the bytes on the branch are the bytes we meant
 * sandbox_validation_passed   those bytes install, typecheck, test and build
 * preview_available           that exact artifact ran and was reachable
 * review_artifact_available   a controlled before/after comparison exists
 * human_approved              ← this sprint
 * merged / deployed           neither exists
 * ```
 *
 * `human_approved` means exactly one thing:
 *
 * > A person with authority over this project looked at one specific reviewed
 * > commit and said yes to it.
 *
 * It does **not** mean the change is correct, that it can be merged now, that
 * the default branch still looks the way it did, or that anything has happened
 * in the repository. Approval records *intent*; it grants no capability.
 *
 * ## Why approval is its own object rather than a boolean
 *
 * `prepared_changes.approved = true` cannot answer the only question that
 * matters at merge time: **approved what, exactly?** A boolean floats. It
 * survives a regenerated commit, a second validation and a fresh comparison,
 * and it silently comes to mean "approved whatever is on the branch now" — which
 * is precisely the sentence a merge must never be built on.
 *
 * So an approval is a row that names the exact commit, base, validation run and
 * review artifact a human saw. If any of those change, the approval does not
 * follow them (§13, §26).
 */

/**
 * What must be true before a human's yes is accepted (§6).
 *
 * Versioned because it is a *contract about evidence*, not a constant: it fixes
 * that a passed validation and a ready review artifact must exist, that the
 * approval binds to an exact commit, and that a human confirmed explicitly.
 * Changing any of that changes what a stored approval means, so the version is
 * part of the approval's identity and old rows keep their original meaning.
 */
export const APPROVAL_POLICY_VERSION = "approval-policy-v2" as const;

/**
 * Approval statuses (§2).
 *
 * Three, and no workflow in between. An approval is created atomically as
 * `approved` — there is no "pending" or "submitted", because nothing
 * asynchronous happens: the whole action is one database transaction with no
 * external side effect (§28).
 */
export const APPROVAL_STATUSES = [
  /** A human said yes to this exact artifact, and that still stands. */
  "approved",
  /** The same human withdrew it before any merge. History is preserved (§15). */
  "revoked",
  /** The artifact it named no longer exists in that form (§13). */
  "invalidated",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Why an approval stopped applying (§13, §25).
 *
 * Each names a change to the *approved artifact itself*, never to the world
 * around it. External repository movement deliberately does not appear here —
 * see §14 and `INVALIDATION_IS_NOT_MERGE_ELIGIBILITY` below.
 */
export const APPROVAL_INVALIDATION_REASONS = [
  /** The prepared change now points at a different commit or base. */
  "prepared_change_modified",
  /** A newer passing validation superseded the one that was approved. */
  "validation_superseded",
  /** A newer ready comparison superseded the one that was approved. */
  "review_superseded",
  /**
   * The change now deserves a different kind of review than the one approved.
   *
   * The classification is derived partly from the analyzer's route table, and
   * that table moves: a newer repository snapshot can reveal that a changed
   * file serves a route, turning a change that needed only a diff into one that
   * needs a visual review. The human's decision has not been superseded by
   * newer evidence of the same kind — it is being asked a different question,
   * and saying so is not the same sentence as "your comparison was replaced".
   */
  "review_requirement_changed",
] as const;
export type ApprovalInvalidationReason = (typeof APPROVAL_INVALIDATION_REASONS)[number];

/**
 * Why an approval could not be created (§4, §29).
 *
 * A closed set, each mapping to copy that says what is missing rather than
 * exposing an internal error.
 */
export const APPROVAL_BLOCK_REASONS = [
  /** No prepared change, or it never produced a commit. */
  "approval_change_not_prepared",
  /** Nothing has proved these bytes build. */
  "approval_validation_required",
  /** No comparison exists, or the one that does is not `ready` (§4). */
  "approval_review_required",
  /**
   * The comparison exists but its images are past retention (§4).
   *
   * Deliberately distinct from `approval_review_required`: "you never made one"
   * and "the one you made can no longer be looked at" are different situations
   * with different remedies, and only the second costs a browser session.
   */
  "approval_review_expired",
  /** An active approval for this exact artifact already exists (§12). */
  "approval_already_exists",
  /** The caller does not hold approval authority over this project (§20). */
  "approval_not_authorized",
  /** The action reached the server without an explicit human confirmation (§8). */
  "approval_confirmation_required",
  "approval_failed",
] as const;
export type ApprovalBlockReason = (typeof APPROVAL_BLOCK_REASONS)[number];

/**
 * One human's yes to one exact artifact.
 *
 * Everything that identifies *what was approved* is stored on the row rather
 * than resolved later. A merge preflight must be able to ask "is the thing I am
 * about to merge the thing that was approved?" without re-deriving history, and
 * without trusting that the rows it joins through still say what they said.
 */
export type ChangeApproval = {
  id: string;
  projectId: string;
  /** The human who approved. Server-resolved from the session, never sent (§9). */
  userId: string;

  preparedChangeId: string;
  validationRunId: string;

  /**
   * The comparison the human looked at. Null for a code-diff approval.
   *
   * Exactly one of this and `codeReviewDigest` is set — the database enforces
   * it, so neither the domain nor a reader has to hold the rule in their head.
   */
  reviewArtifactId: string | null;
  /**
   * The diff the human looked at, as a reproducible identity.
   *
   * sha256 over project, change, base, commit, sorted changed paths and the
   * diff policy version. It is not a hash of the *bytes* — those are never
   * persisted (rule 26) — it is a hash of everything needed to fetch them
   * again and get the same diff, which is the property a screenshot lacks.
   *
   * What it does **not** claim: that anyone read it. It records what was shown,
   * which is the same claim `reviewArtifactId` makes about two images.
   */
  codeReviewDigest: string | null;

  /** Which review this change deserved, as decided at approval time (ADR 0063). */
  reviewClassification: ReviewClassification | null;
  reviewClassificationPolicyVersion: string | null;

  /**
   * The exact commit that was approved.
   *
   * Copied onto the approval rather than read through `prepared_changes` at
   * merge time. If a preparation is ever re-run and rewrites the row's commit,
   * the approval must still be able to say which commit the human actually saw
   * — a join would quietly answer with the new one.
   */
  preparedCommitSha: string;
  /** The base the change was prepared against, recorded for the same reason. */
  preparedBaseSha: string;

  approvalPolicyVersion: string;
  /** Deterministic hash of everything above. The uniqueness key (§12). */
  approvalIdentity: string;

  status: ApprovalStatus;
  approvedAt: string;
  revokedAt: string | null;
  invalidatedAt: string | null;
  invalidationReason: ApprovalInvalidationReason | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * An approval is active when it is still a human's standing yes.
 *
 * Revoked and invalidated rows are kept — they are history, and history is what
 * makes an approval auditable — but neither is authority for anything.
 */
export function isApprovalActive(approval: { status: ApprovalStatus }): boolean {
  return approval.status === "approved";
}

/**
 * **An active approval is not merge eligibility** (§11, §14).
 *
 * Named as a function so the distinction has somewhere to live in code rather
 * than only in prose, and so anything tempted to treat `status = 'approved'` as
 * permission has to walk past this comment first.
 *
 * An approval says: *a human approved commit X as represented by review Y.*
 *
 * It does not say the default branch is where it was, that the branch still
 * exists, that GitHub would accept the merge, that branch protection allows it,
 * or that the caller still has permission. Every one of those is current
 * external state, and Sprint 11C revalidates all of them immediately before it
 * writes — because stored evidence is a routing signal, never permission
 * (CLAUDE.md rule 55).
 *
 * The inverse matters too and is easier to get wrong: the default branch moving
 * does **not** retroactively unmake a human's decision. It makes the merge
 * unsafe, which is a different sentence, decided at a different time, by a
 * different check.
 */
export function approvalGrantsNoMergeAuthority(): true {
  return true;
}
