import type { ApprovalCard } from "@/modules/approvals/view";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import type { PreviewCard } from "@/modules/change-preview/view";
import type { MergeCard } from "@/modules/merge/view";
import type { OutcomeCard } from "@/modules/outcome-verification/view";
import type { ReviewClassificationResult } from "@/modules/review/classification";
import type { ReviewCard } from "@/modules/review/view";
import type { ValidationSummary } from "@/modules/validation/view";

/**
 * Where one prepared change actually stands (UI-5 §1).
 *
 * ## Why this has to exist
 *
 * The gates run in an order — validation, preview, review, approval, merge,
 * outcome — and until now that order existed nowhere as data. It was written
 * six times as prose in comments and once more as the order of JSX siblings,
 * which meant no code could ask "how far has this got?".
 *
 * Everything that follows from not being able to ask was a real defect. Each
 * panel could only speak for its own gate, so the ones that say what has *not*
 * happened yet said it forever: a merged, production-verified change still
 * carried "Not merged · Not deployed · Not reviewed by a human", "Not
 * approved · Not merged" and "Nothing has been merged or deployed" — three
 * false statements on the screen a person trusts most. An approval stayed
 * revocable after the write it authorized. And the card led with a branch name
 * because nothing could work out what else to lead with.
 *
 * ## What this is not
 *
 * Not a second opinion. Each gate decides its own state and this re-decides
 * none of them; it reads the answers they already gave and says which one the
 * change is currently sitting on. Nor is it permission for anything — whether
 * a merge may happen is `merge.canMerge`, freshly checked, and stays there.
 *
 * Pure and synchronous, so every state a card can be in is a unit test.
 */

export type ChangeStage =
  /** No safety check has been run, and none is running. */
  | "not_validated"
  /** A safety check is in flight. */
  | "validating"
  /** A safety check ran and did not pass. Nothing downstream can start. */
  | "validation_failed"
  /** Checked, and Vibe is building the comparison a human reviews. */
  | "reviewing"
  /** Checked, and the comparison is the founder's to start. */
  | "review_required"
  /** A comparison was attempted or captured, and is not there to review. */
  | "review_unavailable"
  /** Everything a person needs in order to decide is on screen. */
  | "awaiting_approval"
  /** A human approved this exact commit and the merge is available. */
  | "ready_to_merge"
  /** A merge is in flight. */
  | "merging"
  /** The repository moved, or the merge was refused, so this cannot advance. */
  | "stalled"
  /** The default branch carries this change, and no outcome is settled yet. */
  | "merged"
  /** A production outcome was observed, whatever it said. */
  | "observed";

export type ChangeProgress = {
  stage: ChangeStage;
  /** One sentence naming the stage, written to the founder. */
  headline: string;
  /**
   * Whether validation, preview, review and approval are all behind this
   * change. The card collapses them to status rows when they are — settled
   * work should be checkable, not unavoidable.
   */
  earlySettled: boolean;
  /** A human approved this exact commit, and that still stands. */
  approved: boolean;
  /** The default branch carries this change, verified by reading it back. */
  merged: boolean;
};

/**
 * The sentence for each stage, in one table.
 *
 * Deliberately the only place these words exist. The outcome and impact
 * vocabularies already learned this lesson: two places describing one state
 * differently is how a product starts disagreeing with itself.
 */
const STAGE_HEADLINES: Record<ChangeStage, string> = {
  /*
   * Three sentences where there was one. "Vibe is checking this change is
   * safe" was being said for a change nobody had checked and for a change that
   * had already failed its checks — two false statements in the same place
   * this sprint exists to remove them from. Whether a check is happening is a
   * different fact from whether one has happened.
   */
  not_validated: "This change has not been checked yet.",
  validating: "Vibe is checking this change is safe.",
  validation_failed: "This change did not pass its safety checks.",
  /*
   * The same split, one gate later, and found the same way: by looking at a
   * real card. "Vibe is preparing what you need to review" sat above a preview
   * that was not started and a review waiting for one — nothing was running,
   * and the next move was the founder's. A product that narrates work it is
   * not doing teaches people to stop reading its status lines.
   *
   * `review_unavailable` names the state and leaves the reason to the panel
   * below it, which knows whether the comparison failed or expired — the same
   * division of labour `stalled` has with the merge panel.
   */
  reviewing: "Vibe is preparing what you need to review.",
  review_required: "Ready for you to preview and compare.",
  review_unavailable: "The comparison for this change is not available.",
  awaiting_approval: "Ready for you to review and approve.",
  ready_to_merge: "Approved by you, ready to go into your repository.",
  merging: "Vibe is updating your repository.",
  stalled: "This change cannot go in as it is.",
  merged: "This change is in your repository.",
  observed: "This change is in your repository, and Vibe looked at the result.",
};

/**
 * Which review stage a change is on, or null once the comparison is ready.
 *
 * A preview in flight counts as `reviewing`: it is the step a comparison is
 * built from, and while it runs Vibe genuinely is preparing something. Every
 * other preview state leaves the next move with the founder, which is what the
 * `review_required` sentence says.
 */
function reviewGate(
  review: ReviewCard,
  preview: PreviewCard,
  classification: ReviewClassificationResult | null,
): "reviewing" | "review_required" | "review_unavailable" | null {
  /*
   * A change that alters no rendered page has no visual gate to pass (ADR 0063).
   *
   * Not "the gate passes" — there is no gate. Photographing a backend change
   * produces two identical images, so requiring one before a person may decide
   * was asking them to buy a browser session to look at nothing. The diff is
   * the review, it is on the card above these panels, and the next move is
   * theirs.
   *
   * `null` and `visual_and_code` both fall through to the visual gates. Half a
   * change being visible is a whole reason to look at it, and a classification
   * Vibe could not determine is never read as permission (rule 44).
   */
  if (classification?.classification === "code") return null;

  if (review.state === "capturing") return "reviewing";
  if (previewInFlight(preview)) return "reviewing";
  if (review.state === "ready") return null;
  if (review.state === "failed" || review.state === "expired") return "review_unavailable";

  return "review_required";
}

/**
 * Which of the three validation stages a change is on, or null once it is past
 * the gate.
 *
 * `cancelled` reads as "not checked" rather than as a failure, matching the
 * validation panel: a run somebody stopped says nothing about the change.
 */
function validationGate(
  validation: ValidationSummary | null,
): "not_validated" | "validating" | "validation_failed" | null {
  if (validation === null) return "not_validated";
  if (validation.status === "passed") return null;
  if (validation.status === "queued" || validation.status === "running") return "validating";
  if (validation.status === "failed") return "validation_failed";

  return "not_validated";
}

/**
 * A preview never blocks a change — but while one is running, Vibe really is
 * doing the work a comparison is built from, and the card may say so.
 */
function previewInFlight(preview: PreviewCard): boolean {
  return preview.state === "starting" || preview.state === "running" || preview.state === "stopping";
}

/**
 * Merge refusals that mean *this change cannot go in as it is*, as opposed to
 * *an earlier gate has not happened yet*.
 *
 * The distinction matters and is easy to lose: a change nobody has approved
 * also carries a merge failure code (`merge_approval_required`), and reading
 * any code as trouble would announce a problem where the honest answer is
 * "it is your turn". Drift, a moved branch, a lost commit, a protection rule
 * and a failed write are the ones a person actually has to act on.
 */
const STALLING_MERGE_FAILURES = new Set([
  "merge_repository_changed",
  "merge_prepared_branch_changed",
  "merge_prepared_commit_missing",
  "merge_not_fast_forward",
  "merge_permission_missing",
  "merge_protected_branch",
  "merge_provider_unavailable",
  "merge_repository_unavailable",
  "merge_write_failed",
  "merge_ambiguous_write",
  "merge_verification_failed",
  "merge_failed",
]);

function mergeStalled(merge: MergeCard): boolean {
  if (merge.state === "failed") return true;
  return merge.failureCode !== null && STALLING_MERGE_FAILURES.has(merge.failureCode);
}

export type ChangeProgressInput = {
  validation: ValidationSummary | null;
  preview: PreviewCard;
  review: ReviewCard;
  approval: ApprovalCard;
  merge: MergeCard;
  outcome: OutcomeCard;
  businessImpact: BusinessImpactCard;
  /**
   * Which review this change deserves (ADR 0063).
   *
   * Null when it could not be determined, which reads as the stricter answer
   * everywhere it is consulted.
   */
  reviewClassification: ReviewClassificationResult | null;
};

export function deriveChangeProgress(input: ChangeProgressInput): ChangeProgress {
  const { validation, preview, review, approval, merge, outcome } = input;

  const approved = approval.state === "approved";
  const merged = merge.state === "merged";

  /*
   * Read from the far end backwards. A change that reached production has
   * been through everything before it, and asking about validation first
   * would let an early gate's state speak for a change that is long past it.
   */
  const stage: ChangeStage = merged
    ? outcome.state === "verified" ||
      outcome.state === "partial" ||
      outcome.state === "not_observed" ||
      outcome.state === "failed"
      ? "observed"
      : "merged"
    : merge.state === "merging"
      ? "merging"
      : mergeStalled(merge)
        ? "stalled"
        : approved
          ? "ready_to_merge"
          : (validationGate(validation) ??
            reviewGate(review, preview, input.reviewClassification) ??
            "awaiting_approval");

  return {
    stage,
    headline: STAGE_HEADLINES[stage],
    /*
     * Approval is the last of the early gates and it cannot be reached without
     * the ones before it: an approval requires a validation that passed, and —
     * for a change that alters a rendered page — a review that is ready. So one
     * answer settles them all, and a revoked or superseded approval correctly
     * opens them again.
     *
     * True for a stalled change too. Its four gates really are behind it — and
     * what still stands is exactly what a person needs told plainly rather
     * than reconstructed from four expanded panels.
     */
    earlySettled: approved,
    approved,
    merged,
  };
}
