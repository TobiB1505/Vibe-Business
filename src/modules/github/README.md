# modules/github

GitHub Integration Layer — see [ARCHITECTURE.md §3.1](../../../ARCHITECTURE.md#31-github-integration-layer), [ADR 0003](../../../docs/decisions/0003-github-app-integration.md) (GitHub App, least privilege), and [ADR 0009](../../../docs/decisions/0009-github-installation-ownership-verification.md) (installation ownership verification).

## What exists (Sprint 1)

- `state.ts` — anti-CSRF state for the connect flow: signed, expiring, user-bound (see ADR 0009).
- `oauth.ts` — `buildInstallUrl()`, `exchangeUserCode()`, `fetchGithubIdentity()`: the GitHub App user authorization flow used **only** to verify identity/installation ownership. Never used as a Vibe Business login method.
- `app-client.ts` — Octokit factories: `getInstallationOctokit()` (App-JWT-backed installation auth via `@octokit/auth-app`) and `getUserOctokit()` (transient user-token auth).
- `installations.ts` — `listUserInstallations()`, `verifyInstallationAccessibleToUser()`: the ADR 0009 ownership check.
- `repositories.ts` — `listInstallationRepositories()`, `checkInstallationStillAccessible()`: repository discovery via the installation's own token, never the user token.
- `connections.ts` — persists verified identity/installation metadata (never tokens) to Supabase.
- `types.ts` — the only shapes the rest of the app is allowed to see; no Octokit request/response object crosses this module's boundary.

## What does not exist yet

Webhooks (installation deleted/suspended, repositories removed) — see [docs/sprints/0001-github-app-connection.md](../../../docs/sprints/0001-github-app-connection.md) Risks/Notes for why this is deferred and what the interim gap is. No branch creation, no PR creation, no repository writes, no repository code is ever cloned/read/executed — all out of scope until a later sprint's Non-Goals list says otherwise.

## Rules

- Nothing outside this module should ever see an Octokit object or a raw GitHub API response — only the DTOs in `types.ts`.
- Installation access tokens are minted per-request via `@octokit/auth-app`, live only in memory for that request, and are never logged, returned to the browser, or persisted.
- The GitHub user access token obtained during connection verification is used immediately and discarded — never persisted (see ADR 0009).
