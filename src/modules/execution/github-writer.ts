import "server-only";

import { getInstallationOctokit } from "@/modules/github/app-client";
import { toGithubDomainError } from "@/modules/github/errors";
import { sha256, type GeneratedFile } from "./generators/nextjs-seo-foundations";
import { checkWritePaths } from "./paths";
import type { ExecutionCapability, ExecutionFailureReason } from "./schema";

/**
 * The repository write (Sprint 9 §17, §21, §25).
 *
 * One atomic commit via the Git Data API — blobs, then a tree based on the
 * base tree, then a commit with the base as its only parent, then a new ref.
 * The branch ref is created last, so a failure anywhere earlier leaves loose
 * objects GitHub garbage-collects and **no branch at all**. A half-written
 * branch would be far worse than no branch.
 *
 * Three things this deliberately never does:
 *
 *  - **update an existing ref** — only `git.createRef`, never `updateRef`, so
 *    the default branch cannot be moved by any code path here;
 *  - **force anything** — no `force: true` is passed anywhere;
 *  - **delete or rename** — the tree is built additively from the base tree.
 *
 * Success is not "GitHub returned 201". It is: the branch resolves to the
 * commit we created, and every file read back from that branch hashes to the
 * bytes we generated (§25).
 */

export type WriteTarget = {
  installationId: number;
  owner: string;
  repo: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  capability: ExecutionCapability;
};

export type WriteResult =
  | { ok: true; commitSha: string }
  | { ok: false; reason: ExecutionFailureReason };

/** Fixed, never model-generated, never impersonating the user (§19). */
const COMMIT_MESSAGE = "vibe: add SEO foundations";

type Octokit = ReturnType<typeof getInstallationOctokit>;

/**
 * Does a branch already exist, and does it hold exactly what we would write?
 *
 * This is the recovery path (§21): a durable step can create the branch and
 * then fail to persist the result. Re-running must not create a second branch,
 * and must not overwrite a branch that holds something else.
 */
async function inspectExistingBranch(
  octokit: Octokit,
  target: WriteTarget,
  files: GeneratedFile[],
): Promise<{ state: "absent" } | { state: "matches"; commitSha: string } | { state: "conflict" }> {
  let commitSha: string;
  try {
    const { data } = await octokit.rest.git.getRef({
      owner: target.owner,
      repo: target.repo,
      ref: `heads/${target.branchName}`,
    });
    commitSha = data.object.sha;
  } catch (error) {
    const domain = toGithubDomainError(error);
    if (domain.code === "repository_not_found") return { state: "absent" };
    throw domain;
  }

  // A branch under Vibe's namespace that does not carry our exact content is
  // not ours to touch. Fail rather than overwrite (§21).
  const matches = await filesMatch(octokit, target, target.branchName, files);
  return matches ? { state: "matches", commitSha } : { state: "conflict" };
}

/** Reads each path from a ref and compares hashes against what we generated. */
async function filesMatch(
  octokit: Octokit,
  target: WriteTarget,
  ref: string,
  files: GeneratedFile[],
): Promise<boolean> {
  for (const file of files) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: target.owner,
        repo: target.repo,
        path: file.path,
        ref,
      });

      if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") return false;

      const content = Buffer.from(data.content, "base64").toString("utf8");
      if (sha256(content) !== file.contentHash) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function prepareChangeOnBranch(
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

  const octokit = getInstallationOctokit(target.installationId);

  try {
    // Recovery first, so a retry after a persistence failure adopts the branch
    // it already created instead of making a second one (§20, §21).
    const existing = await inspectExistingBranch(octokit, target, files);
    if (existing.state === "matches") return { ok: true, commitSha: existing.commitSha };
    if (existing.state === "conflict") return { ok: false, reason: "branch_conflict" };

    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner: target.owner,
      repo: target.repo,
      commit_sha: target.baseSha,
    });

    const blobs = await Promise.all(
      files.map(async (file) => {
        const { data } = await octokit.rest.git.createBlob({
          owner: target.owner,
          repo: target.repo,
          content: file.content,
          encoding: "utf-8",
        });
        return { path: file.path, sha: data.sha };
      }),
    );

    const { data: tree } = await octokit.rest.git.createTree({
      owner: target.owner,
      repo: target.repo,
      base_tree: baseCommit.tree.sha,
      tree: blobs.map((blob) => ({
        path: blob.path,
        // Normal file. Never a mode that could make something executable.
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      })),
    });

    const { data: commit } = await octokit.rest.git.createCommit({
      owner: target.owner,
      repo: target.repo,
      message: COMMIT_MESSAGE,
      tree: tree.sha,
      parents: [target.baseSha],
    });

    // Last, and `createRef` only: there is no code path in this module that
    // can move an existing ref, which is what keeps the default branch safe.
    await octokit.rest.git.createRef({
      owner: target.owner,
      repo: target.repo,
      ref: `refs/heads/${target.branchName}`,
      sha: commit.sha,
    });

    // Verification, not optimism (§25).
    const { data: created } = await octokit.rest.git.getRef({
      owner: target.owner,
      repo: target.repo,
      ref: `heads/${target.branchName}`,
    });

    if (created.object.sha !== commit.sha) return { ok: false, reason: "write_verification_failed" };
    if (!(await filesMatch(octokit, target, target.branchName, files))) {
      return { ok: false, reason: "write_verification_failed" };
    }

    return { ok: true, commitSha: commit.sha };
  } catch (error) {
    const domain = toGithubDomainError(error);
    // The provider's message is never surfaced or stored; the typed code is.
    console.error("[execution] github write failed", { code: domain.code, status: domain.status });
    return {
      ok: false,
      reason: domain.code === "github_contents_permission_required" ? "change_preparation_failed" : "github_unavailable",
    };
  }
}

/**
 * Does the installation currently hold write access?
 *
 * Asked of GitHub rather than assumed from what was requested at install time:
 * an installation approved under Sprint 2's read-only permissions is still
 * live, and must be told to upgrade rather than allowed to fail mid-write.
 */
export async function hasRepositoryWritePermission(installationId: number): Promise<boolean> {
  try {
    const octokit = getInstallationOctokit(installationId);
    // The installation token reports the permissions it was actually granted,
    // which is the only trustworthy answer — what was *requested* at install
    // time says nothing about what the owner approved.
    const auth = (await octokit.auth({ type: "installation" })) as {
      permissions?: Record<string, string>;
    };
    return auth.permissions?.contents === "write";
  } catch (error) {
    console.error("[execution] could not determine write permission", {
      code: toGithubDomainError(error).code,
    });
    return false;
  }
}
