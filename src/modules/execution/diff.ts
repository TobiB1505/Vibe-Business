import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeLineDiff, type DiffHunk } from "./diff-lines";
import { getPreparedChange } from "./store";

/**
 * Bounded diff retrieval for review (Sprint 9C §12, §13, §26; Sprint 0055 §1).
 *
 * The GitHub branch is the canonical artifact, so the diff is fetched on
 * demand and never persisted — storing it would quietly turn Supabase into a
 * source-code mirror of every customer repository. `20260818210000_agent_execution.sql`
 * says the same thing about the agent's own tables: *deliberately absent —
 * prompts, model output, reasoning, source files, diffs*.
 *
 * ## Why two commits rather than a branch
 *
 * This used to read one side, from `branchName`, because the only capability
 * that existed only ever *added* files — so the added content was the diff, and
 * a branch name was good enough to fetch it.
 *
 * Neither half survives the agent. It edits files that already exist, so a diff
 * needs the version that was there before; and a branch is a moving pointer,
 * while a review has to be about two exact commits. Both sides are therefore
 * read at pinned SHAs from the prepared change Vibe recorded:
 *
 * ```
 * before   prepared.baseSha      the commit the change was prepared on
 * after    prepared.commitSha    the commit Vibe wrote and verified
 * ```
 *
 * That is what lets the same diff be recomputed byte-identically later, which
 * is what an approval can honestly bind to (ADR 0063). A screenshot cannot be
 * regenerated; this can.
 *
 * ## Everything here is untrusted text
 *
 * The content is a customer's repository. It is returned as plain strings for
 * a text renderer, never as markup. This module's contract is that a caller
 * receives lines of text; what a caller must not do — `dangerouslySetInnerHTML`,
 * markdown-with-HTML, remote asset loading — is the UI's obligation, and the
 * diff component honours it.
 *
 * ## The limits are the caller's ceiling, not an estimate of the content
 *
 * The whole point of a bound is that it holds when the assumption behind it
 * stops being true. A future capability, a tampered branch, or a repository
 * that answers with something unexpected all hit the same ceiling.
 */

/** Deliberately small. A prepared change is a handful of files, not a release. */
export const DIFF_LIMITS = {
  maxFiles: 10,
  maxBytesPerFile: 64 * 1024,
  maxTotalBytes: 256 * 1024,
  maxLinesPerFile: 500,
} as const;

/**
 * The policy version for a rendered diff.
 *
 * Part of what a `code` approval binds to (ADR 0063): the digest says *this
 * diff, computed under these rules, was what was shown*. Changing a limit, the
 * context width or the line algorithm changes what was shown, so it changes the
 * version — and an approval taken under the old rules can no longer be matched
 * against the new one.
 */
export const DIFF_POLICY_VERSION = "diff-policy-v1" as const;

/**
 * Reads a file at an exact commit. The same bounded port the analyzer, the
 * candidate extractor and the review classifier already use, declared narrowly
 * here so the GitHub reader satisfies it structurally and a test double is
 * three lines.
 *
 * One method, and no way to write: "a diff read can never modify a repository"
 * is a property of this type rather than a claim about the code below.
 */
export type DiffContentReader = {
  getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null>;
};

/**
 * What happened to one file.
 *
 * `deleted` exists since ADR 0073, and the caution the previous version of this
 * comment recorded still holds: it is **never inferred from a missing head
 * side**. `getTextFile` returns `null` for an absent file, a binary one, an
 * oversized one and a directory alike, so a null head still means `unreadable`.
 * A file is deleted only because the stored `prepared_changes.files` row says
 * so — Vibe's own record of what it wrote, not a read that came back empty.
 * Collapsing the two is the mistake `candidate.ts` records making once: an
 * oversized build artifact read as the agent removing a repository file.
 */
export type DiffFileStatus = "added" | "modified" | "deleted" | "unreadable";

export type DiffFile = {
  path: string;
  status: DiffFileStatus;
  /** Empty for `unreadable`, and for a file whose two versions are identical. */
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** True when either side was cut short by a limit above. */
  truncated: boolean;
  /** Size of the head side, as read. Zero when it could not be read. */
  bytes: number;
};

export type PreparedDiff = {
  preparedChangeId: string;
  branchName: string;
  baseSha: string;
  commitSha: string;
  policyVersion: typeof DIFF_POLICY_VERSION;
  files: DiffFile[];
  /** True when files were dropped to stay inside the total budget. */
  truncated: boolean;
  /** Totals across every file shown. */
  added: number;
  removed: number;
};

export type DiffFailure =
  | "not_found"
  /** The change exists but has no commit to show yet. */
  | "not_prepared"
  | "unavailable";

export type DiffResult = { ok: true; diff: PreparedDiff } | { ok: false; error: DiffFailure };

/** Clips one side to the per-file ceiling, reporting whether it had to. */
function clip(content: string): { text: string; truncated: boolean; bytes: number } {
  const byBytes = content.length > DIFF_LIMITS.maxBytesPerFile;
  const usable = byBytes ? content.slice(0, DIFF_LIMITS.maxBytesPerFile) : content;

  const lines = usable.split("\n");
  const byLines = lines.length > DIFF_LIMITS.maxLinesPerFile;
  const text = byLines ? lines.slice(0, DIFF_LIMITS.maxLinesPerFile).join("\n") : usable;

  return { text, truncated: byBytes || byLines, bytes: Buffer.byteLength(text, "utf8") };
}

/**
 * One file's two versions, compared.
 *
 * A head side that cannot be read is reported as `unreadable` rather than
 * omitted: review has to show that something is there it could not display,
 * because a file silently missing from a diff is a file nobody reviewed.
 */
function compareFile(
  path: string,
  baseText: string | null,
  headText: string | null,
  deleted = false,
): DiffFile {
  if (deleted) {
    // The head side is absent *by design*, so it is never read and never
    // compared. What the reviewer needs is the base side in full, in red.
    const base = baseText === null ? null : clip(baseText);
    const diff = base === null ? null : computeLineDiff(base.text, "");

    return {
      path,
      status: "deleted",
      hunks: diff?.hunks ?? [],
      added: 0,
      removed: diff?.removed ?? 0,
      truncated: base?.truncated ?? false,
      bytes: 0,
    };
  }

  if (headText === null) {
    return { path, status: "unreadable", hunks: [], added: 0, removed: 0, truncated: false, bytes: 0 };
  }

  const head = clip(headText);
  const base = baseText === null ? null : clip(baseText);
  const diff = computeLineDiff(base?.text ?? "", head.text);

  return {
    path,
    status: base === null ? "added" : "modified",
    hunks: diff.hunks,
    added: diff.added,
    removed: diff.removed,
    truncated: head.truncated || (base?.truncated ?? false),
    bytes: head.bytes,
  };
}

/**
 * Reads both versions of every prepared file and compares them.
 *
 * The paths, the base commit and the head commit all come from the stored
 * prepared change, which came from server-resolved state — never from the
 * caller. A client cannot ask for the contents of an arbitrary ref, an
 * arbitrary path, or an arbitrary commit (§12, §29).
 */
export async function getPreparedDiff(
  supabase: SupabaseClient,
  reader: DiffContentReader,
  params: { projectId: string; preparedChangeId: string },
): Promise<DiffResult> {
  const prepared = await getPreparedChange(supabase, params);
  if (!prepared) return { ok: false, error: "not_found" };
  if (prepared.status !== "prepared" || prepared.commitSha === null) {
    return { ok: false, error: "not_prepared" };
  }

  const commitSha = prepared.commitSha;
  const files: DiffFile[] = [];
  let totalBytes = 0;
  let truncated = prepared.files.length > DIFF_LIMITS.maxFiles;

  for (const file of prepared.files.slice(0, DIFF_LIMITS.maxFiles)) {
    if (totalBytes >= DIFF_LIMITS.maxTotalBytes) {
      truncated = true;
      break;
    }

    /*
     * Both sides at once. The base read is the one that makes this a diff
     * rather than a listing, and it is fetched at the pinned base SHA — a
     * source the change itself never touched (rule 55).
     */
    const deleted = file.status === "deleted";

    const [baseText, headText] = await Promise.all([
      reader.getTextFile(file.path, prepared.baseSha, DIFF_LIMITS.maxBytesPerFile),
      // Not read for a deletion: there is nothing at the head to read, and the
      // request would spend a round trip to learn what the row already says.
      deleted
        ? Promise.resolve(null)
        : reader.getTextFile(file.path, commitSha, DIFF_LIMITS.maxBytesPerFile),
    ]);

    const compared = compareFile(file.path, baseText, headText, deleted);
    totalBytes += compared.bytes;
    files.push(compared);
  }

  return {
    ok: true,
    diff: {
      preparedChangeId: prepared.id,
      branchName: prepared.branchName,
      baseSha: prepared.baseSha,
      commitSha,
      policyVersion: DIFF_POLICY_VERSION,
      files,
      truncated,
      added: files.reduce((sum, file) => sum + file.added, 0),
      removed: files.reduce((sum, file) => sum + file.removed, 0),
    },
  };
}

/**
 * The branch's URL on GitHub.
 *
 * Built from stored project linkage, never from a client-supplied URL (§15).
 * `encodeURIComponent` on the branch segment because a ref can legitimately
 * contain slashes — `vibe/seo-foundations-…` always does.
 */

export function buildBranchUrl(repositoryFullName: string, branchName: string): string {
  const [owner, repo] = repositoryFullName.split("/");
  return `https://github.com/${owner}/${repo}/tree/${encodeRef(branchName)}`;
}

/**
 * The difference between the default branch and this one, on GitHub.
 *
 * Offered when a prepared change can no longer go in as it is (UI-5 §7): the
 * base moved, so what a person needs is to see what moved. It is a link to a
 * read, not a remedy — re-preparing costs provider time and stays the user's
 * own decision.
 *
 * Built from stored project linkage like the branch URL above, never from
 * anything a client supplied.
 */
export function buildCompareUrl(
  repositoryFullName: string,
  baseBranch: string,
  branchName: string,
): string {
  const [owner, repo] = repositoryFullName.split("/");
  return `https://github.com/${owner}/${repo}/compare/${encodeRef(baseBranch)}...${encodeRef(branchName)}`;
}

/**
 * `encodeURIComponent` per segment, because a ref can legitimately contain
 * slashes — `vibe/seo-foundations-…` always does — and encoding the whole
 * thing would turn the separator into `%2F`.
 */
function encodeRef(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}
