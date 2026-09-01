import type { ApprovalBlockReason } from "./schema";

/**
 * User-facing copy for every reason approval is unavailable (Sprint 11B §22).
 *
 * One sentence each, saying what is missing and — where it is true — what the
 * user can do about it. Two rules hold throughout:
 *
 *  1. **No internal error ever reaches this map.** The chain is `failure →
 *     stable code → safe copy`, the same discipline the sandbox and review
 *     layers use.
 *  2. **Nothing here offers to spend money.** Where the remedy is a paid step
 *     (a validation, a comparison), the copy names it as something the user
 *     starts, never something Vibe will do for them (CLAUDE.md rule 60).
 */
export const APPROVAL_BLOCK_MESSAGES: Record<ApprovalBlockReason, string> = {
  approval_change_not_prepared: "This change has not been prepared yet.",
  approval_validation_required: "This change must pass isolated validation before you can approve it.",
  approval_review_required: "Generate a before/after comparison first — approval needs a completed review.",
  // Names the action rather than the artifact. The preview is the review now,
  // and it costs a sandbox — so the copy says who starts it (rule 60).
  approval_preview_required:
    "Start a preview and look at the change first — approval needs a preview of this exact commit.",
  approval_review_expired:
    "The comparison for this change is no longer available. Generate a new one to approve this change.",
  approval_already_exists: "This change is already approved.",
  approval_not_authorized: "You do not have approval authority for this project.",
  // Reachable only by calling the action without confirming. The copy is
  // deliberately plain rather than alarming: it is a refusal, not an accusation.
  approval_confirmation_required: "Approval needs an explicit confirmation.",
  approval_failed: "This change could not be approved.",
};

export function approvalBlockMessage(reason: ApprovalBlockReason): string {
  return APPROVAL_BLOCK_MESSAGES[reason];
}
