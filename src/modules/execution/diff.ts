import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GitWritePort } from "./git-port";
import { getPreparedChange } from "./store";

/**
 * Bounded diff retrieval for review (Sprint 9C §12, §13, §26).
 *
 * The GitHub branch is the canonical artifact, so the diff is fetched on
 * demand and never persisted — storing it would quietly turn Supabase into a
 * source-code mirror of every customer repository.
 *
 * ## Everything here is untrusted text
 *
 * The content is a customer's repository. It is returned as plain strings for
 * a text renderer, never as markup. This module's contract is that a caller
 * receives lines of text; what a caller must not do — `dangerouslySetInnerHTML`,
 * markdown-with-HTML, remote asset loading — is the UI's obligation, and the
 * review component honours it.
 *
 * ## The limits apply even though this capability writes two small files
 *
 * The whole point of a bound is that it holds when the assumption behind it
 * stops being true. A future capability, a tampered branch, or a repository
 * that answers with something unexpected all hit the same ceiling.
 */

/** Deliberately small. Two metadata routes are a few hundred bytes each. */
export const DIFF_LIMITS = {
  maxFiles: 10,
  maxBytesPerFile: 64 * 1024,
  maxTotalBytes: 256 * 1024,
  maxLinesPerFile: 500,
} as const;

export type DiffFile = {
  path: string;
  /** Plain text lines. Rendered as text, never as markup. */
  lines: string[];
  /** True when the file was cut short by a limit above. */
  truncated: boolean;
  bytes: number;
};

export type PreparedDiff = {
  preparedChangeId: string;
  branchName: string;
  baseSha: string;
  commitSha: string;
  files: DiffFile[];
  /** True when files were dropped to stay inside the total budget. */
  truncated: boolean;
};

export type DiffFailure =
  | "not_found"
  /** The change exists but has no commit to show yet. */
  | "not_prepared"
  | "unavailable";

export type DiffResult = { ok: true; diff: PreparedDiff } | { ok: false; error: DiffFailure };

function boundFile(path: string, content: string): DiffFile {
  const clipped = content.length > DIFF_LIMITS.maxBytesPerFile;
  const usable = clipped ? content.slice(0, DIFF_LIMITS.maxBytesPerFile) : content;

  const allLines = usable.split("\n");
  const tooManyLines = allLines.length > DIFF_LIMITS.maxLinesPerFile;
  const lines = tooManyLines ? allLines.slice(0, DIFF_LIMITS.maxLinesPerFile) : allLines;

  return {
    path,
    lines,
    truncated: clipped || tooManyLines,
    bytes: Buffer.byteLength(usable, "utf8"),
  };
}

/**
 * Reads the prepared files from the branch Vibe created.
 *
 * The branch, the paths and the commit all come from the stored prepared
 * change, which came from server-resolved state — never from the caller. A
 * client cannot ask for the contents of an arbitrary ref (§12, §29).
 *
 * This capability only ever adds files, so the "diff" is the added content.
 * A capability that modified existing files would need base-vs-head
 * comparison; that is a different capability and a different renderer.
 */
export async function getPreparedDiff(
  supabase: SupabaseClient,
  port: GitWritePort,
  params: { projectId: string; preparedChangeId: string },
): Promise<DiffResult> {
  const prepared = await getPreparedChange(supabase, params);
  if (!prepared) return { ok: false, error: "not_found" };
  if (prepared.status !== "prepared" || prepared.commitSha === null) {
    return { ok: false, error: "not_prepared" };
  }

  const files: DiffFile[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const file of prepared.files.slice(0, DIFF_LIMITS.maxFiles)) {
    if (totalBytes >= DIFF_LIMITS.maxTotalBytes) {
      truncated = true;
      break;
    }

    const content = await port.getFileContent(file.path, prepared.branchName);
    if (content === null) {
      // The branch no longer holds a file we recorded. Reported as a gap
      // rather than silently omitted, so review shows something is wrong.
      files.push({ path: file.path, lines: [], truncated: false, bytes: 0 });
      continue;
    }

    const bounded = boundFile(file.path, content);
    totalBytes += bounded.bytes;
    files.push(bounded);
  }

  if (prepared.files.length > DIFF_LIMITS.maxFiles) truncated = true;

  return {
    ok: true,
    diff: {
      preparedChangeId: prepared.id,
      branchName: prepared.branchName,
      baseSha: prepared.baseSha,
      commitSha: prepared.commitSha,
      files,
      truncated,
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
