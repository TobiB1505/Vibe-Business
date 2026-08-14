import type {
  ApprovalBlockReason,
  ApprovalInvalidationReason,
  ChangeApproval,
} from "./schema";

/**
 * What an approval looks like to a user (Sprint 11B §21, §24, §25).
 *
 * ## Why the server decides this
 *
 * Because the client cannot. Deciding whether something is approved means
 * comparing an approval's bound artifact against the artifact currently in
 * front of the user, and a component holding a handful of props has no way to
 * do that comparison honestly — it can only check whether *an* approval exists,
 * which is the exact mistake §13 forbids.
 *
 * The recent dogfood makes the stakes concrete in the other direction too: a
 * correct domain state rendered as the wrong sentence is indistinguishable, to
 * the person reading it, from a broken product. Approval is the one place where
 * that sentence carries authority.
 *
 * ## What this deliberately never computes
 *
 * Whether a merge would succeed. Nothing here looks at the default branch, at
 * GitHub, or at branch protection, and `approved` must never be rendered as
 * "ready to merge" (§11, §22).
 */

export type ApprovalCardState =
  /** Something is missing before a human could meaningfully approve. */
  | "not_eligible"
  /** Everything needed exists, and no one has approved yet. */
  | "not_approved"
  /** A human approved this exact artifact and that still stands. */
  | "approved"
  /** The approver withdrew their approval of this exact artifact (§15). */
  | "revoked"
  /** An earlier approval exists, but not for what is on screen now (§25). */
  | "invalidated";

export type ApprovalCard = {
  state: ApprovalCardState;
  /** Present for `approved` and `revoked`, so the panel can act on the row. */
  approvalId: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  /**
   * The commit an approval applies to — its own, never the current one.
   *
   * Rendered next to the approval so "this approval applies only to commit X"
   * is a fact the user can check rather than a claim they have to trust.
   */
  approvedCommitSha: string | null;
  invalidationReason: ApprovalInvalidationReason | null;
  /** Why approval is not currently possible. Null when it is. */
  blockReason: ApprovalBlockReason | null;
  blockMessage: string | null;
  /**
   * Whether the panel may offer the approve action.
   *
   * Deliberately separate from the state: a revoked or superseded approval is
   * history *and* the current artifact may be perfectly approvable, and the two
   * facts have to be shown together rather than one hiding the other.
   */
  canApprove: boolean;
  /** The commit the user would be approving now, for the confirmation copy. */
  currentCommitSha: string | null;
};

export type ApprovalCardInput = {
  /** Eligibility of the artifact currently on screen. Null when eligible. */
  blockReason: ApprovalBlockReason | null;
  blockMessage: string | null;
  /** An approval whose identity is exactly the current artifact, any status. */
  approvalForCurrentArtifact: ChangeApproval | null;
  /**
   * An approval that was given for a *different* artifact than the current one.
   *
   * Its presence is the only thing that produces the `invalidated` card. It is
   * never treated as authority — the point of surfacing it is to say plainly
   * that it does not apply here (§25).
   */
  supersededApproval: ChangeApproval | null;
  currentCommitSha: string | null;
};

const EMPTY = {
  approvalId: null,
  approvedAt: null,
  revokedAt: null,
  approvedCommitSha: null,
  invalidationReason: null,
} as const;

export function buildApprovalCard(input: ApprovalCardInput): ApprovalCard {
  const canApprove = input.blockReason === null;
  const base = {
    blockReason: input.blockReason,
    blockMessage: input.blockReason ? input.blockMessage : null,
    canApprove,
    currentCommitSha: input.currentCommitSha,
  };

  const current = input.approvalForCurrentArtifact;

  // A standing yes to exactly this artifact. The only input that produces
  // `approved`, and it comes from an identity match rather than from the
  // existence of any approval anywhere (§24).
  if (current?.status === "approved") {
    return {
      ...base,
      state: "approved",
      approvalId: current.id,
      approvedAt: current.approvedAt,
      revokedAt: null,
      approvedCommitSha: current.preparedCommitSha,
      invalidationReason: null,
      // Nothing to approve while an approval stands. Offering it would invite a
      // second row for something already decided.
      canApprove: false,
    };
  }

  if (current?.status === "revoked") {
    return {
      ...base,
      state: "revoked",
      approvalId: current.id,
      approvedAt: current.approvedAt,
      revokedAt: current.revokedAt,
      approvedCommitSha: current.preparedCommitSha,
      invalidationReason: null,
    };
  }

  // Either an approval for this artifact was invalidated, or one exists for an
  // earlier artifact. Both mean the same thing to the reader: what you approved
  // is not what you are looking at.
  const superseded = current?.status === "invalidated" ? current : input.supersededApproval;
  if (superseded) {
    return {
      ...base,
      state: "invalidated",
      approvalId: superseded.id,
      approvedAt: superseded.approvedAt,
      revokedAt: superseded.revokedAt,
      approvedCommitSha: superseded.preparedCommitSha,
      invalidationReason: superseded.invalidationReason,
    };
  }

  if (input.blockReason) return { ...EMPTY, ...base, state: "not_eligible" };

  return { ...EMPTY, ...base, state: "not_approved" };
}
