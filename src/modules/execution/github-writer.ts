import { sha256, type GeneratedFile } from "./generators/nextjs-seo-foundations";
import type { GitWritePort } from "./git-port";
import { checkWritePaths } from "./paths";
import type { ExecutionCapability, ExecutionFailureReason } from "./schema";

/**
 * The repository write (Sprint 9 §17, §21, §25).
 *
 * One atomic commit through the Git data model — blobs, then a tree based on
 * the base tree, then a commit with the base as its only parent, then a new
 * ref. The ref is created **last**, so a failure anywhere earlier leaves loose
 * objects the host garbage-collects and **no branch at all**. A half-written
 * branch would be far worse than no branch.
 *
 * Three things this structurally cannot do, because `GitWritePort` has no
 * operation for them:
 *
 *  - **move an existing ref** — only `createRef` exists, so the default branch
 *    cannot be moved from here;
 *  - **force** anything;
 *  - **delete or rename** — the tree is built additively from the base tree.
 *
 * Success is not "the API returned 201". It is: the branch resolves to the
 * commit we created, and every file read back from that branch hashes to the
 * bytes we generated (§25).
 *
 * Takes its port as an argument so all of this is provable in tests without a
 * network (§27).
 */

export type WriteTarget = {
  owner: string;
  repo: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  capability: ExecutionCapability;
};

export type WriteResult =
  | { ok: true; commitSha: string; recovered: boolean }
  | { ok: false; reason: ExecutionFailureReason };

/** Fixed, never model-generated, never impersonating the user (§19). */
export const COMMIT_MESSAGE = "vibe: add SEO foundations";

export type BranchInspection =
  | { state: "absent" }
  | { state: "matches"; commitSha: string }
  | { state: "conflict"; commitSha: string };

/**
 * Does a branch already exist, and does it hold exactly what we would write?
 *
 * The recovery path (§21): a durable step can create the branch and then fail
 * to persist the result. Re-entry must adopt that branch rather than create a
 * second one — and must refuse a branch holding anything else rather than
 * overwrite work that is not ours.
 *
 * Exported because it is the single most consequential decision in the write
 * path and needs to be tested directly.
 */
export async function inspectExistingBranch(
  port: GitWritePort,
  target: WriteTarget,
  files: GeneratedFile[],
): Promise<BranchInspection> {
  const commitSha = await port.getRefSha(`heads/${target.branchName}`);
  if (commitSha === null) return { state: "absent" };

  const matches = await filesMatch(port, target.branchName, files);
  return matches ? { state: "matches", commitSha } : { state: "conflict", commitSha };
}

/** Reads each path back from a ref and compares hashes against what we generated. */
async function filesMatch(
  port: GitWritePort,
  ref: string,
  files: GeneratedFile[],
): Promise<boolean> {
  for (const file of files) {
    const content = await port.getFileContent(file.path, ref);
    if (content === null) return false;
    if (sha256(content) !== file.contentHash) return false;
  }
  return true;
}

export async function prepareChangeOnBranch(
  port: GitWritePort,
  target: WriteTarget,
  files: GeneratedFile[],
): Promise<WriteResult> {
  // Independent of the generator: even though paths are composed from a
  // resolved app root and fixed basenames, they are re-checked here so a
  // future capability that forgets that discipline still cannot escape (§13).
  const paths = checkWritePaths(
    files.map((file) => file.path),
    target.capability,
  );
  if (!paths.ok) {
    console.error("[execution] refused a path outside the capability allowlist", {
      reason: paths.reason,
    });
    return { ok: false, reason: "change_preparation_failed" };
  }

  try {
    // Recovery first, so a retry after a persistence failure adopts the branch
    // it already created instead of making a second one (§20, §21).
    const existing = await inspectExistingBranch(port, target, files);
    if (existing.state === "matches") {
      return { ok: true, commitSha: existing.commitSha, recovered: true };
    }
    if (existing.state === "conflict") return { ok: false, reason: "branch_conflict" };

    const baseTreeSha = await port.getCommitTreeSha(target.baseSha);

    const blobs = await Promise.all(
      files.map(async (file) => ({ path: file.path, blobSha: await port.createBlob(file.content) })),
    );

    const treeSha = await port.createTree({ baseTreeSha, files: blobs });
    const commitSha = await port.createCommit({
      message: COMMIT_MESSAGE,
      treeSha,
      parentSha: target.baseSha,
    });

    // Last, and the port offers no way to touch an existing ref.
    await port.createRef({ ref: `refs/heads/${target.branchName}`, sha: commitSha });

    // Verification, not optimism (§25).
    const created = await port.getRefSha(`heads/${target.branchName}`);
    if (created !== commitSha) return { ok: false, reason: "write_verification_failed" };
    if (!(await filesMatch(port, target.branchName, files))) {
      return { ok: false, reason: "write_verification_failed" };
    }

    return { ok: true, commitSha, recovered: false };
  } catch (error) {
    // The provider's message is never surfaced or stored; only a typed code.
    console.error("[execution] repository write failed", {
      message: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, reason: "github_unavailable" };
  }
}
