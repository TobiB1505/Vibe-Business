/**
 * The narrow Git write port (Sprint 9B §27).
 *
 * Seven operations, all the writer needs. Deliberately not "an Octokit": the
 * writer's safety properties — ref created last, never updated, never forced,
 * never deleted — are only checkable if the surface it can reach is small
 * enough to enumerate. A port with no `updateRef` and no `deleteRef` makes
 * "the default branch cannot be moved from here" a property of the *type*
 * rather than a claim about the code.
 *
 * No provider types appear here, so the writer is testable with a plain
 * in-memory double and no network.
 */

export type GitWritePort = {
  /** Resolves a `heads/<branch>` ref, or null when it does not exist. */
  getRefSha(ref: string): Promise<string | null>;
  /** File content at a ref, or null when absent. */
  getFileContent(path: string, ref: string): Promise<string | null>;
  /** The tree a commit points at. */
  getCommitTreeSha(commitSha: string): Promise<string>;
  createBlob(content: string): Promise<string>;
  createTree(input: { baseTreeSha: string; files: { path: string; blobSha: string }[] }): Promise<string>;
  createCommit(input: { message: string; treeSha: string; parentSha: string }): Promise<string>;
  /** Creates a new ref. There is deliberately no way to update or delete one. */
  createRef(input: { ref: string; sha: string }): Promise<void>;
};

/** Live state the preflight must read rather than infer (§12, §13). */
export type ExecutionProbePort = {
  /** GitHub's current default branch and HEAD. */
  getHead(): Promise<{ defaultBranch: string; commitSha: string }>;
  /** Which of these paths currently exist on the default branch. */
  findExistingPaths(paths: string[]): Promise<string[]>;
  /** Whether the live production site serves this path right now. */
  isServed(path: string): Promise<boolean>;
  /** Whether the installation token currently carries `Contents: write`. */
  hasWritePermission(): Promise<boolean>;
};
