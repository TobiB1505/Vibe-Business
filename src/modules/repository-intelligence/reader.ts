/**
 * The port the analyzer reads repositories through. Deliberately free of
 * any GitHub/Octokit type so detectors and the orchestrator can be unit
 * tested with a plain in-memory fake (Sprint 2 §29). The GitHub adapter
 * lives in src/modules/github/repository-reader.ts.
 */

export type TreeEntryType = "blob" | "tree";

export type TreeEntry = {
  path: string;
  type: TreeEntryType;
  /** Blob size in bytes as reported by Git. Absent for trees. */
  size?: number;
};

export type RepositoryTree = {
  entries: TreeEntry[];
  /**
   * True when the underlying provider could not enumerate the whole tree.
   * The analyzer records this as `tree_truncated` and reports partial
   * completeness rather than failing (Sprint 2 §6).
   */
  truncated: boolean;
};

export type RepositoryHead = {
  defaultBranch: string;
  commitSha: string;
};

export interface RepositoryReader {
  /** Resolves the repository's current default branch and its head commit SHA. */
  getHead(): Promise<RepositoryHead>;
  /** Full recursive tree at `commitSha`, with a bounded fallback when truncated. */
  getTree(commitSha: string): Promise<RepositoryTree>;
  /**
   * Fetches a text file's content at `commitSha`. Returns null when the
   * file is missing, is not a regular file, is not decodable as text, or
   * exceeds `maxBytes`. Never throws for a merely absent file.
   */
  getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null>;
}
