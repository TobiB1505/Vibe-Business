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
 * Removing a file gave it no eighth operation (ADR 0074). A tree entry with a
 * null blob is how the Git data model already expresses "this path is not in
 * the new tree", so deletion is a *shape* `createTree` accepts rather than a
 * capability the port grants. Everything above still holds unchanged.
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
  /**
   * Builds a tree from the base tree.
   *
   * `blobSha: null` removes that path — the Git tree API's own way of saying
   * so, and the only way this port can express a deletion. Which paths those
   * are is decided by Vibe's observation of the workspace, never by anything
   * the agent reported (Rule 77, ADR 0074).
   */
  createTree(input: {
    baseTreeSha: string;
    files: { path: string; blobSha: string | null }[];
  }): Promise<string>;
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
