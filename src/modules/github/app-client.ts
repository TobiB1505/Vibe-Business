import "server-only";

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import { getGithubEnv } from "@/lib/env/github";
import {
  GITHUB_READ_RETRIES,
  GITHUB_REQUEST_TIMEOUT_MS,
  withBoundedFetch,
} from "@/lib/net/bounded-fetch";

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

/**
 * A deadline on every GitHub call, and a bounded retry on the read ones
 * (VB-031).
 *
 * Octokit ships no timeout of its own, so a GitHub incident that leaves
 * connections open rather than refusing them held a page render or a workflow
 * step until something further out gave up. Vibe reaches GitHub on the merge
 * preflight, on every prepared-change card and on repository intelligence —
 * paths where a hang is a wedged operation, not a slow one.
 *
 * The retry covers `GET` and `HEAD` only, and the helper decides that from the
 * method rather than from anything a caller says. That is deliberate: the
 * consequential GitHub calls in this application create branches, push commits
 * and fast-forward a default branch, and rule 73 is explicit that an ambiguous
 * write is resolved by reading the external state — never by sending it again.
 */
function boundedRequest() {
  return {
    fetch: withBoundedFetch({
      timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
      retries: GITHUB_READ_RETRIES,
    }),
  };
}

export function getInstallationOctokit(installationId: number): Octokit {
  const env = getGithubEnv();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId,
    },
    request: boundedRequest(),
  });
}

/** Octokit instance authenticated with a GitHub user access token (transient — see oauth.ts). */
export function getUserOctokit(userAccessToken: string): Octokit {
  return new Octokit({ auth: userAccessToken, request: boundedRequest() });
}
