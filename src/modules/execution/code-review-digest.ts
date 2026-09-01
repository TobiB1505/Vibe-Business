import { createHash } from "node:crypto";
import { DIFF_POLICY_VERSION } from "./diff";

/**
 * The identity of one rendered diff (Sprint 0055 §3, ADR 0063).
 *
 * ## What this is for
 *
 * An approval binds to an immutable artifact identity (CLAUDE.md rule 67). For
 * a visual review that artifact is a `review_artifacts` row: two stored PNGs
 * that cannot change. For a code review there is no row, because a diff is
 * never persisted — storing one would make Supabase a source mirror of every
 * customer repository (rule 26).
 *
 * So the identity is of the *inputs that reproduce it*: two immutable commits,
 * the exact set of paths that were shown, and the rules they were shown under.
 * Fetch those again and the same diff comes back, byte for byte.
 *
 * That is a stronger guarantee than the screenshot form, not a weaker one. A
 * comparison expires after seven days and can never be regenerated — production
 * has moved on. This can be regenerated indefinitely, by anyone with the two
 * commits.
 *
 * ## What it deliberately does not include
 *
 * **The file contents.** Hashing the bytes would mean fetching them at approval
 * time, which turns opening the approval panel into GitHub traffic for a page
 * that must stay free (Sprint 11B §27). The commits already pin the bytes: two
 * SHAs and a path list determine the content exactly.
 *
 * **Anything about the reader.** This records what was *shown*, not that anyone
 * looked — the same claim, and the same limit, that a review artifact carries.
 */
export function computeCodeReviewDigest(params: {
  projectId: string;
  preparedChangeId: string;
  preparedBaseSha: string;
  preparedCommitSha: string;
  /** Every changed path. Sorted here so a caller's ordering cannot change it. */
  paths: readonly string[];
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored approval and orphan the rows it was meant to match.
  const canonical = JSON.stringify([
    params.projectId,
    params.preparedChangeId,
    params.preparedBaseSha,
    params.preparedCommitSha,
    [...params.paths].sort(),
    DIFF_POLICY_VERSION,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}
