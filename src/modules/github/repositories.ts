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
 * What GitHub says about an installation right now (VB-041).
 *
 * Three answers rather than two, and the third is the point. This used to
 * return a boolean, and its own comment complained about exactly what that
 * cost: a misconfigured private key and a genuinely uninstalled App produced
 * the same `false`, so nothing could act on the difference.
 *
 * They call for opposite responses. `revoked` is a fact about the customer's
 * account that Vibe should record and tell them about — their App is gone and
 * they need to reinstall it. `unavailable` is a fact about *this moment* —
 * GitHub is down, or our own credentials are wrong — and recording it as
 * revocation would tell a customer their connection was removed when it was
 * not.
 */
export type InstallationAccess = "accessible" | "revoked" | "unavailable";

/**
 * GitHub answers 404 for an installation that does not exist, and 404 is also
 * what it answers for one this App may not see. Both mean the same thing to
 * Vibe: this installation is not ours to use any more.
 *
 * 401/403 are deliberately *not* here. They are what a wrong or expired App
 * credential produces, which is our problem rather than the customer's.
 */
export function classifyProbeFailure(error: unknown): Exclude<InstallationAccess, "accessible"> {
  return (error as { status?: number })?.status === 404 ? "revoked" : "unavailable";
}

export async function checkInstallationAccess(installationId: number): Promise<InstallationAccess> {
  try {
    await listInstallationRepositories(installationId);
    return "accessible";
  } catch (error) {
    /*
     * Logged, never surfaced raw: the shape of the failure matters to whoever
     * is operating the system, and the customer can act only on the conclusion.
     * No credential is included.
     */
    console.error("[github.checkInstallationAccess]", {
      installationId,
      name: error instanceof Error ? error.name : typeof error,
      status: (error as { status?: number })?.status,
      message: error instanceof Error ? error.message : undefined,
    });
    return classifyProbeFailure(error);
  }
}
