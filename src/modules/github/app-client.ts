import "server-only";

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import { getGithubEnv } from "@/lib/env/github";

/**
 * Octokit instance authenticated as a specific installation. Minting and
 * caching of the short-lived installation access token is handled
 * internally by @octokit/auth-app (an official Octokit package) rather
 * than hand-rolled JWT/token code — see ADR 0009 and
 * docs/decisions/0003-github-app-integration.md.
 *
 * The token never leaves this process: it lives only inside the returned
 * Octokit instance's internal auth strategy for the lifetime of this
 * request, is never logged, never persisted, and never returned to the
 * caller directly.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  const env = getGithubEnv();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId,
    },
  });
}

/** Octokit instance authenticated with a GitHub user access token (transient — see oauth.ts). */
export function getUserOctokit(userAccessToken: string): Octokit {
  return new Octokit({ auth: userAccessToken });
}
