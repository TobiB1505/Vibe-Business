# modules/github

GitHub Integration Layer — see [ARCHITECTURE.md §3.1](../../../ARCHITECTURE.md#31-github-integration-layer), [ADR 0003](../../../docs/decisions/0003-github-app-integration.md) (GitHub App, least privilege), and [ADR 0009](../../../docs/decisions/0009-github-installation-ownership-verification.md) (installation ownership verification).

## What exists

- `state.ts` — anti-CSRF state for the connect flow: signed, expiring, user-bound (see ADR 0009).
- `oauth.ts` — `buildInstallUrl()`, `exchangeUserCode()`, `fetchGithubIdentity()`: the GitHub App user authorization flow used **only** to verify identity/installation ownership. Never used as a Vibe Business login method.
- `app-client.ts` — Octokit factories: `getInstallationOctokit()` (App-JWT-backed installation auth via `@octokit/auth-app`) and `getUserOctokit()` (transient user-token auth).
- `installations.ts` — `listUserInstallations()`, `verifyInstallationAccessibleToUser()`: the ADR 0009 ownership check.
- `repositories.ts` — `listInstallationRepositories()`, `checkInstallationStillAccessible()`: repository discovery via the installation's own token, never the user token.
- `connections.ts` — persists verified identity/installation metadata (never tokens) to Supabase, and reads installations back scoped to a user (`listVerifiedInstallations`, `getVerifiedInstallation`).
- `connect-routing.ts` — pure decision for where "Connect a project" should go: start an installation, go straight to the repository picker, or ask which account to use.
- `urls.ts` — GitHub URL construction, including the installation settings page used by "Manage GitHub repository access".
- `types.ts` — the only shapes the rest of the app is allowed to see; no Octokit request/response object crosses this module's boundary.
- `installation-token.ts` — mints the short-lived installation access token the reader and the writers authenticate with.
- `repository-reader.ts` — the read port `modules/repository-intelligence` analyses through: HEAD, the Git tree, and a bounded number of text files fetched into memory. Never a clone, never a working tree.
- `errors.ts` — the typed domain errors this module raises; no raw GitHub error escapes.

## What lives elsewhere, and what does not exist

**Repository writes are not in this module** — they are in `modules/execution` (branch and commit) and `modules/merge` (fast-forwarding the default branch after an approval). This module owns connection, discovery, authentication and reading; it holds no write path of its own.

**No pull request is ever opened**, here or anywhere: an approved change is delivered by creating a branch and then fast-forwarding the default branch to one exact approved commit. No call to the GitHub pulls API exists anywhere under `src/`.

**No repository code is executed and no working copy is held.** Files are read through the API into memory under explicit budgets; cloning happens inside the validation microVM, never in a Vibe process (rules 59, 61).

**Webhooks do not exist** (installation deleted/suspended, repositories removed) — see [docs/sprints/0001-github-app-connection.md](../../../docs/sprints/0001-github-app-connection.md) Risks/Notes for why this is deferred and what the interim gap is.

## Rules

- Nothing outside this module should ever see an Octokit object or a raw GitHub API response — only the DTOs in `types.ts`.
- Installation access tokens are minted per-request via `@octokit/auth-app`, live only in memory for that request, and are never logged, returned to the browser, or persisted.
- The GitHub user access token obtained during connection verification is used immediately and discarded — never persisted (see ADR 0009).
