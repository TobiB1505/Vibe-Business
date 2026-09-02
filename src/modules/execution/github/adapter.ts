import "server-only";

import { getInstallationOctokit } from "@/modules/github/app-client";
import { toGithubDomainError } from "@/modules/github/errors";
import { safeFetch } from "@/modules/live-product-intelligence/net/safe-fetch";
import { resolveDns } from "@/modules/live-product-intelligence/net/node-dns";
import { nodeHttpTransport } from "@/modules/live-product-intelligence/net/node-transport";
import type { ExecutionProbePort, GitWritePort } from "../git-port";

/**
 * The GitHub and live-site adapters (Sprint 9B §8, §12, §13).
 *
 * The only file in the execution module that names Octokit. Everything above
 * it sees `GitWritePort` and `ExecutionProbePort`, which is what lets the
 * writer and preflight be tested exhaustively with no network.
 *
 * The installation token lives inside the Octokit instance for the lifetime of
 * a step, is never returned, never logged, and never crosses a durable
 * boundary (§29).
 */

export type RepositoryTarget = {
  installationId: number;
  owner: string;
  repo: string;
};

export function createGithubGitWritePort(target: RepositoryTarget): GitWritePort {
  const octokit = getInstallationOctokit(target.installationId);
  const scope = { owner: target.owner, repo: target.repo };

  return {
    async getRefSha(ref) {
      try {
        const { data } = await octokit.rest.git.getRef({ ...scope, ref });
        return data.object.sha;
      } catch (error) {
        // A missing ref is an answer, not a failure — it is the normal case
        // on a first preparation.
        if (toGithubDomainError(error).code === "repository_not_found") return null;
        throw error;
      }
    },

    async getFileContent(path, ref) {
      try {
        const { data } = await octokit.rest.repos.getContent({ ...scope, path, ref });
        if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") return null;
        return Buffer.from(data.content, "base64").toString("utf8");
      } catch {
        return null;
      }
    },

    async getCommitTreeSha(commitSha) {
      const { data } = await octokit.rest.git.getCommit({ ...scope, commit_sha: commitSha });
      return data.tree.sha;
    },

    async createBlob(content) {
      const { data } = await octokit.rest.git.createBlob({ ...scope, content, encoding: "utf-8" });
      return data.sha;
    },

    async createTree({ baseTreeSha, files }) {
      const { data } = await octokit.rest.git.createTree({
        ...scope,
        base_tree: baseTreeSha,
        tree: files.map((file) => ({
          path: file.path,
          // Normal file. Never a mode that could make something executable.
          mode: "100644" as const,
          type: "blob" as const,
          /*
           * `null` removes the path from the new tree (ADR 0074).
           *
           * Octokit types `sha` as `string | null` for exactly this, and the
           * REST API documents the null as the deletion. Sent as `null` rather
           * than omitted: an absent `sha` with a `path` is a different request,
           * and this one has to say what it means.
           */
          sha: file.blobSha,
        })),
      });
      return data.sha;
    },

    async createCommit({ message, treeSha, parentSha }) {
      const { data } = await octokit.rest.git.createCommit({
        ...scope,
        message,
        tree: treeSha,
        parents: [parentSha],
      });
      return data.sha;
    },

    async createRef({ ref, sha }) {
      await octokit.rest.git.createRef({ ...scope, ref, sha });
    },
  };
}

/**
 * Live state for premise revalidation.
 *
 * Everything here is read at execution time. The stored snapshot is exactly
 * what proved untrustworthy in Sprint 8, so none of these answers come from it.
 */
export function createExecutionProbe(
  target: RepositoryTarget,
  productionOrigin: string | null,
): ExecutionProbePort {
  const octokit = getInstallationOctokit(target.installationId);
  const scope = { owner: target.owner, repo: target.repo };

  return {
    async getHead() {
      // The default branch is re-resolved rather than trusted from connection
      // time — it may have been renamed since.
      const { data: repository } = await octokit.rest.repos.get(scope);
      const { data: ref } = await octokit.rest.git.getRef({
        ...scope,
        ref: `heads/${repository.default_branch}`,
      });
      return { defaultBranch: repository.default_branch, commitSha: ref.object.sha };
    },

    async findExistingPaths(paths) {
      const found: string[] = [];
      for (const path of paths) {
        try {
          await octokit.rest.repos.getContent({ ...scope, path });
          found.push(path);
        } catch {
          // Absent, which is the outcome this capability requires.
        }
      }
      return found;
    },

    async isServed(path) {
      if (productionOrigin === null) return false;

      // Through the safe-fetch boundary, like every other outbound request to
      // a user-supplied destination (ADR 0010, CLAUDE.md rule 35). Bounded
      // hard: this is a liveness probe, not a crawl — we only need to know
      // whether the route answers.
      const result = await safeFetch(
        `${productionOrigin}${path}`,
        {
          accept: ["text", "xml"],
          maxBytes: 8_192,
          timeoutMs: 5_000,
          maxRedirects: 2,
          restrictToOrigin: productionOrigin,
        },
        { resolveDns, transport: nodeHttpTransport },
      );

      return result.ok && result.status >= 200 && result.status < 300;
    },

    async hasWritePermission() {
      try {
        // The installation token reports the permissions actually granted.
        // What was *requested* at install time says nothing about what the
        // owner approved.
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
    },
  };
}
