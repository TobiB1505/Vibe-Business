import { sha256, type GeneratedFile } from "./generators/nextjs-seo-foundations";
import type { GitWritePort } from "./git-port";
import { checkWritePaths } from "./paths";
import { isAgenticCapability } from "./schema";
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
 * Two things this structurally cannot do, because `GitWritePort` has no
 * operation for them:
 *
 *  - **move an existing ref** — only `createRef` exists, so the default branch
 *    cannot be moved from here;
 *  - **force** anything.
 *
 * It *can* remove a file since ADR 0073, and the guarantee that replaced
 * "additive only" is narrower but still enumerable: this writer removes only
 * the paths Vibe observed removed, inside the same path policy that governs a
 * write, and proves each one absent on read-back. A rename is a deletion and an
 * addition, observed and written as exactly that — there is no rename
 * primitive, because "was this a rename" is not a question the observation can
 * answer honestly.
 *
 * Success is not "the API returned 201". It is: the branch resolves to the
 * commit we created, every file read back from that branch hashes to the bytes
 * we generated, **and every deleted path reads back absent** (§25, ADR 0073 §4).
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
  /**
   * The fully rendered agentic commit message (Sprint 0046).
   *
   * Rendered elsewhere, by `execution/commit-message.ts`'s
   * `compileCommitMessage`/`renderCommitMessage`, from the trusted Action
   * Step and Vibe-computed identifiers — never by this module, and never from
   * anything the coding agent itself said. `github-writer.ts` stays
   * deliberately ignorant of Conventional-Commits semantics; its job is
   * writing whatever string it is given, not deciding what the string says.
   * Ignored for deterministic capabilities, which keep their fixed message.
   */
  commitMessage?: string | null;
};

export type WriteResult =
  | { ok: true; commitSha: string; recovered: boolean }
  | { ok: false; reason: ExecutionFailureReason };

/** Fixed, never model-generated, never impersonating the user (§19). */
export const COMMIT_MESSAGE = "vibe: add SEO foundations";

/**
 * The last-resort agentic message, used only if a caller somehow reaches this
 * function without having compiled one — every real caller does. Not the old
 * `vibe: implement plan step N` string: PART J's own fallback shape, so even
 * the safety net reads as a real, if generic, Conventional Commit.
 */
const AGENTIC_MESSAGE_FALLBACK = "chore: apply prepared product change";

/**
 * The commit message for one write (Rule 57, CORE-4 §30, Sprint 0046).
 *
 * The deterministic capability keeps its fixed message. The agentic
 * capability uses whatever `commitMessage` the caller compiled — see
 * `commit-message.ts` for how that string is built from trusted Planner text
 * and Vibe-minted identifiers, never from the coding agent's own output.
 */
export function commitMessageFor(target: Pick<WriteTarget, "capability" | "commitMessage">): string {
  if (!isAgenticCapability(target.capability)) return COMMIT_MESSAGE;
  return target.commitMessage && target.commitMessage.trim().length > 0
    ? target.commitMessage
    : AGENTIC_MESSAGE_FALLBACK;
}

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
  deletions: readonly string[] = [],
): Promise<BranchInspection> {
  const commitSha = await port.getRefSha(`heads/${target.branchName}`);
  if (commitSha === null) return { state: "absent" };

  const matches = await branchMatches(port, target.branchName, files, deletions);
  return matches ? { state: "matches", commitSha } : { state: "conflict", commitSha };
}

/**
 * Reads the branch back and compares it against what this change is.
 *
 * Two questions, and the second is the one ADR 0073 added: every written path
 * must hash to the bytes we produced, and every deleted path must be **absent**.
 * A read-back that finds a deleted path still there is a write failure, not a
 * detail — the branch would hold a change missing part of what the agent did,
 * which is the exact situation §59's exactness requirement exists to prevent.
 */
async function branchMatches(
  port: GitWritePort,
  ref: string,
  files: GeneratedFile[],
  deletions: readonly string[],
): Promise<boolean> {
  for (const file of files) {
    const content = await port.getFileContent(file.path, ref);
    if (content === null) return false;
    if (sha256(content) !== file.contentHash) return false;
  }

  for (const path of deletions) {
    if ((await port.getFileContent(path, ref)) !== null) return false;
  }

  return true;
}

export async function prepareChangeOnBranch(
  port: GitWritePort,
  target: WriteTarget,
  files: GeneratedFile[],
  /**
   * Paths to remove, from Vibe's own set difference (ADR 0073 §2).
   *
   * Never the agent's account of what it deleted: `discoverWorkspaceChanges`
   * compares the baseline listing against the listing after the last turn, and
   * what is missing is what is deleted. Nothing the agent says can add a path
   * here or take one away (Rule 77).
   */
  deletions: readonly string[] = [],
): Promise<WriteResult> {
  // Independent of the generator: even though paths are composed from a
  // resolved app root and fixed basenames, they are re-checked here so a
  // future capability that forgets that discipline still cannot escape (§13).
  //
  // Deletions go through the same check, in the same call. A path nobody may
  // write is a path nobody may remove: deleting `.github/workflows/ci.yml` is
  // the same class of act as replacing it (ADR 0073 §3).
  const paths = checkWritePaths(
    [...files.map((file) => file.path), ...deletions],
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
    const existing = await inspectExistingBranch(port, target, files, deletions);
    if (existing.state === "matches") {
      return { ok: true, commitSha: existing.commitSha, recovered: true };
    }
    if (existing.state === "conflict") return { ok: false, reason: "branch_conflict" };

    const baseTreeSha = await port.getCommitTreeSha(target.baseSha);

    const blobs = await Promise.all(
      files.map(async (file) => ({ path: file.path, blobSha: await port.createBlob(file.content) })),
    );

    /*
     * Writes first, then removals, both as tree entries against the base tree.
     * A deletion is `blobSha: null` — the Git data model's own way of saying
     * the path is not in the new tree.
     */
    const treeSha = await port.createTree({
      baseTreeSha,
      files: [...blobs, ...deletions.map((path) => ({ path, blobSha: null }))],
    });
    const commitSha = await port.createCommit({
      message: commitMessageFor(target),
      treeSha,
      parentSha: target.baseSha,
    });

    // Last, and the port offers no way to touch an existing ref.
    await port.createRef({ ref: `refs/heads/${target.branchName}`, sha: commitSha });

    // Verification, not optimism (§25).
    const created = await port.getRefSha(`heads/${target.branchName}`);
    if (created !== commitSha) return { ok: false, reason: "write_verification_failed" };
    if (!(await branchMatches(port, target.branchName, files, deletions))) {
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
