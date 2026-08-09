import "server-only";

import { getInstallationOctokit } from "./app-client";
import type { RepositorySummary } from "./types";

type RawRepository = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch?: string;
  private: boolean;
  html_url: string;
};

export interface RepositoriesLister {
  rest: {
    apps: {
      listReposAccessibleToInstallation(params?: {
        per_page?: number;
      }): Promise<{ data: { repositories: RawRepository[] } }>;
    };
  };
}

export function normalizeRepository(raw: RawRepository): RepositorySummary {
  return {
    githubRepositoryId: raw.id,
    owner: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    // GitHub's schema marks default_branch optional; every real repository
    // has one, but fall back rather than store an empty value if it's ever
    // absent.
    defaultBranch: raw.default_branch ?? "main",
    private: raw.private,
    htmlUrl: raw.html_url,
  };
}

/**
 * Lists repositories accessible to `client` (an installation-token-
 * authenticated Octokit — see getInstallationOctokit). Not paginated
 * beyond 100 repositories, a reasonable Sprint 1 simplification.
 */
export async function listRepositoriesFromClient(client: RepositoriesLister): Promise<RepositorySummary[]> {
  const { data } = await client.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
  return data.repositories.map(normalizeRepository);
}

/** Mints a fresh installation token and lists the repositories it can access. */
export async function listInstallationRepositories(installationId: number): Promise<RepositorySummary[]> {
  const octokit = getInstallationOctokit(installationId);
  return listRepositoriesFromClient(octokit);
}

/**
 * Cheap "is this installation still usable" probe for graceful degradation
 * (Sprint 1 §11: "GitHub access unavailable", never crash). Reuses the
 * repository listing call rather than a dedicated endpoint — any GitHub
 * API failure here (revoked/suspended/deleted installation, GitHub API
 * unavailable) is treated as "not accessible," never surfaced raw to the
 * user.
 */
export async function checkInstallationStillAccessible(installationId: number): Promise<boolean> {
  try {
    await listInstallationRepositories(installationId);
    return true;
  } catch {
    return false;
  }
}
