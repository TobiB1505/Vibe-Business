import type { MergeFailureCode } from "./schema";

/**
 * User-facing copy for every merge refusal (Sprint 11C §28, §29, §30).
 *
 * One exhaustive record over the closed union, so a new failure code without
 * copy is a type error rather than a blank space where an explanation should be.
 *
 * ## The two sentences this file is careful about
 *
 * **Repository drift is not the user's mistake.** `main` moving is the normal
 * life of a repository. The copy says what happened and what Vibe did *not* do,
 * and stops there — it does not offer to refresh, re-prepare or regenerate,
 * because every one of those costs provider time and starting it on the user's
 * behalf is exactly what CLAUDE.md rule 60 forbids (§29).
 *
 * **Branch protection is not a failure.** It is the repository owner's own rule
 * working correctly. The copy says Vibe did not bypass it, because the thing a
 * user most needs to know after a refused write is what was *not* done to their
 * repository (§30). It never suggests granting broader permissions.
 */
export const MERGE_FAILURE_MESSAGES: Record<MergeFailureCode, string> = {
  merge_approval_required:
    "This change has not been approved. Approve it first — merging needs a human decision about this exact commit.",
  merge_approval_invalid:
    "The approval on record is for a different version of this change, so it does not authorize this merge. Review the change and approve it again.",

  // §29. States the fact and the non-action. No automatic remediation is
  // offered, and none happens.
  merge_repository_changed:
    "The default branch changed after this change was prepared. Vibe did not modify the repository. Review the updated repository state before merging.",

  merge_prepared_commit_missing:
    "The approved commit no longer exists in the repository, so there is nothing to merge.",
  merge_prepared_branch_changed:
    "The prepared branch no longer points at the approved commit, so Vibe stopped rather than merge something different.",

  merge_permission_missing:
    "Vibe no longer has permission to write to this repository. Reconnect it to continue.",

  // §30. Not framed as the user's error, and deliberately silent about
  // permissions: asking for Administration to bypass a protection rule is the
  // one response this product will never offer.
  merge_protected_branch:
    "This repository requires a different merge process for the default branch. Vibe did not bypass the repository's protection rules.",

  merge_not_fast_forward:
    "This change can no longer be applied as a simple fast-forward. Vibe only merges a change that sits directly on the current default branch, so it stopped without modifying the repository.",

  merge_write_failed: "GitHub refused the update, so the default branch was not changed.",

  // The one message that cannot promise the repository is untouched, because
  // that is the honest content of an ambiguous write (§19).
  merge_ambiguous_write:
    "Vibe could not confirm the result of the update and found the default branch in an unexpected state, so it stopped. Check the repository before trying again.",

  merge_verification_failed:
    "GitHub accepted the update, but reading the default branch back did not return the approved commit. Vibe did not mark this as merged.",

  merge_provider_unavailable: "GitHub could not be reached. Nothing was changed. Try again in a moment.",
  merge_repository_unavailable: "No repository is connected to this project.",

  merge_confirmation_required: "Merging the default branch needs an explicit confirmation.",
  merge_not_authorized: "You do not have permission to merge changes in this project.",

  // Deliberately does not claim the branch is untouched. This is the catch-all
  // for a merge that ended without a verified result, and some of those paths
  // ran after a write was attempted. Promising "nothing changed" here would be
  // the one kind of reassurance this product must never guess at.
  merge_failed: "This merge did not complete. Check the repository's default branch before trying again.",
};

export function mergeFailureMessage(code: MergeFailureCode): string {
  return MERGE_FAILURE_MESSAGES[code];
}
