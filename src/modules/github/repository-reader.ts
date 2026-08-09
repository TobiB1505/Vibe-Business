import "server-only";

import { getInstallationOctokit } from "./app-client";
import { toGithubDomainError } from "./errors";
import type {
  RepositoryHead,
  RepositoryReader,
  RepositoryTree,
  TreeEntry,
} from "@/modules/repository-intelligence/reader";

type Octokit = ReturnType<typeof getInstallationOctokit>;

/**
 * GitHub adapter for the analyzer's RepositoryReader port. Everything
 * GitHub-specific — Octokit types, HTTP status semantics, recursive-tree
 * truncation, base64 content encoding — is contained here; the analyzer
 * only ever sees the plain shapes declared in the port.
 *
 * Requires the App's `Contents: Read-only` permission (Sprint 2 §1).
 * Installations approved under Sprint 1's metadata-only permission set
 * will fail these calls with 403, which maps to the typed
 * `github_contents_permission_required` error so the UI can prompt for a
 * permission upgrade instead of showing a generic failure.
 */
class GithubRepositoryReader implements RepositoryReader {
  constructor(
    private readonly octokit: Octokit,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  async getHead(): Promise<RepositoryHead> {
    try {
      // Re-resolve the default branch rather than trusting the value
      // stored at connection time — it may have been renamed since.
      const { data: repository } = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      });
      const defaultBranch = repository.default_branch;

      const { data: ref } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${defaultBranch}`,
      });

      return { defaultBranch, commitSha: ref.object.sha };
    } catch (error) {
      throw toGithubDomainError(error);
    }
  }

  async getTree(commitSha: string): Promise<RepositoryTree> {
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: commitSha,
        recursive: "1",
      });

      const entries = data.tree.map(toTreeEntry).filter(isSupportedEntry);

      if (!data.truncated) {
        return { entries, truncated: false };
      }

      // Bounded fallback (Sprint 2 §6): never crawl recursively. One extra
      // non-recursive call guarantees we still see every top-level entry,
      // which is where the highest-value manifests (package.json,
      // next.config.*, Dockerfile, ...) live — so detection stays useful
      // on repositories too large to enumerate exhaustively.
      const rootEntries = await this.getRootEntries(commitSha);
      return { entries: mergeUniqueByPath(entries, rootEntries), truncated: true };
    } catch (error) {
      throw toGithubDomainError(error);
    }
  }

  private async getRootEntries(commitSha: string): Promise<TreeEntry[]> {
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: commitSha,
      });
      return data.tree.map(toTreeEntry).filter(isSupportedEntry);
    } catch {
      // The recursive result we already have is still usable; a failed
      // fallback must not discard it.
      return [];
    }
  }

  async getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: commitSha,
      });

      // getContent returns an array for directories and object variants
      // for submodules/symlinks — only a regular file carries content.
      if (Array.isArray(data) || data.type !== "file") return null;
      if (data.encoding !== "base64" || typeof data.content !== "string") return null;
      if (typeof data.size === "number" && data.size > maxBytes) return null;

      const buffer = Buffer.from(data.content, "base64");
      if (buffer.byteLength > maxBytes) return null;
      if (!isProbablyText(buffer)) return null;

      return buffer.toString("utf8");
    } catch (error) {
      const domainError = toGithubDomainError(error);
      // A missing file is an expected outcome of speculative candidate
      // probing, not a failure of the analysis.
      if (domainError.code === "repository_not_found") return null;
      throw domainError;
    }
  }
}

function toTreeEntry(raw: { path?: string; type?: string; size?: number }): TreeEntry {
  return {
    path: raw.path ?? "",
    type: raw.type === "tree" ? "tree" : "blob",
    size: raw.size,
  };
}

/** Drops empty paths and non-file/dir git objects (commits — i.e. submodules). */
function isSupportedEntry(entry: TreeEntry): boolean {
  return entry.path.length > 0;
}

function mergeUniqueByPath(primary: TreeEntry[], extra: TreeEntry[]): TreeEntry[] {
  const seen = new Set(primary.map((entry) => entry.path));
  return [...primary, ...extra.filter((entry) => !seen.has(entry.path))];
}

/**
 * Rejects content containing NUL bytes — the standard heuristic Git
 * itself uses to classify a blob as binary. The path policy already
 * excludes known binary extensions; this is the second line of defence
 * for files with a text-looking extension but binary content.
 */
function isProbablyText(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.byteLength, 8000);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return false;
  }
  return true;
}

/**
 * Builds a reader bound to one repository, authenticated as the given
 * installation. The installation token is minted inside the Octokit
 * instance per Sprint 1's token policy — never returned, logged, or
 * persisted.
 */
export function createGithubRepositoryReader(
  installationId: number,
  owner: string,
  repo: string,
): RepositoryReader {
  return new GithubRepositoryReader(getInstallationOctokit(installationId), owner, repo);
}
