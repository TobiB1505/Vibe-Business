import "server-only";

import { exchangeWebFlowCode } from "@octokit/oauth-methods";
import { getGithubEnv } from "@/lib/env/github";
import { getUserOctokit } from "./app-client";
import type { GithubIdentity } from "./types";

/**
 * The URL that starts GitHub App installation + user authorization for
 * `state`. Requires the App's "Request user authorization (OAuth) during
 * installation" setting to be enabled (see docs/setup/github-app.md) — that
 * is what makes GitHub include an OAuth `code` alongside `installation_id`
 * in the callback, which is what ADR 0009's ownership check relies on.
 */
export function buildInstallUrl(state: string): string {
  const env = getGithubEnv();
  const url = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges the OAuth `code` from the callback for a GitHub user access
 * token, using the official Octokit helper rather than a hand-rolled fetch
 * to GitHub's token endpoint. The returned token is used immediately by the
 * caller to verify identity/installation ownership (ADR 0009) and is never
 * persisted — see docs/sprints/0001-github-app-connection.md.
 */
export async function exchangeUserCode(code: string): Promise<{ userAccessToken: string }> {
  const env = getGithubEnv();
  const { authentication } = await exchangeWebFlowCode({
    clientType: "github-app",
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    code,
  });
  return { userAccessToken: authentication.token };
}

/** Fetches the GitHub identity behind a user access token. */
export async function fetchGithubIdentity(userAccessToken: string): Promise<GithubIdentity> {
  const octokit = getUserOctokit(userAccessToken);
  const { data } = await octokit.rest.users.getAuthenticated();
  return { githubUserId: data.id, githubLogin: data.login };
}
