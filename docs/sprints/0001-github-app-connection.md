# Sprint 1 — GitHub App Connection & Repository Selection

Status: Complete (implementation + tests); live end-to-end GitHub verification pending manual setup (see Validation)
Branch: `feat/sprint-1-github-connection`

## Goal

Implement Vibe Business's first real product-specific flow: an authenticated user connects GitHub, securely verifies ownership of a GitHub App installation, picks exactly one repository, and gets a real Vibe Business Project backed by that repository — visible on `/app` and its own project page. No AI analysis yet.

## Context

[Sprint 0](0000-application-bootstrap.md) built the application shell, Supabase Auth foundation, and module boundaries, but left `/app` unauthenticated and every domain module empty. [ADR 0003](../decisions/0003-github-app-integration.md) had already fixed GitHub App (not OAuth App, not PATs) as the repository integration mechanism. What Sprint 1 adds architecturally is [ADR 0009](../decisions/0009-github-installation-ownership-verification.md): a raw `installation_id` from a GitHub callback cannot be trusted by itself, and must be verified against a GitHub identity the current Vibe user actually controls before anything is persisted.

## Scope

- Authentication gate on `/app` and everything under it (§2).
- ADR 0009 verification: GitHub App user authorization flow, used only to prove installation ownership — never as a login method.
- Minimal database schema: `github_connections`, `github_installations`, `projects`, `repository_connections`, `audit_events` — all RLS-protected.
- `src/modules/github/`: state (anti-CSRF), OAuth code exchange, installation-token minting, installation verification, repository listing — all Octokit-object-free at the module boundary (only DTOs in `types.ts` cross it).
- Connect flow: `/app/connect/github` (start) → GitHub → `/app/connect/github/callback` (verify + persist) → `/app/connect/github/repositories` (pick one) → `/app/projects/[projectId]` (result).
- Dashboard (`/app`) showing real connected projects, or the empty state.
- Disconnect (local relationship only, never touches GitHub).
- Audit events for every meaningful step, via one shared `recordAuditEvent()`.
- `docs/setup/github-app.md` — exact manual GitHub App configuration.

## Non-Goals

Everything PRODUCT.md/ARCHITECTURE.md defer past this sprint, explicitly including: repository clone, source-code analysis, AI calls (no Anthropic SDK), Business Readiness Audit, Opportunities, branch creation, code modifications, pull requests, `PreviewProvider`, Vercel preview creation for user repos, credits, payments, queue/background jobs, web crawling, analytics, SEO, project invitation/team features, and any GitHub repository **write** operation. Sprint 1 ends at: a verified GitHub repository is connected to a Vibe Business Project. Nothing about that repository is read beyond the metadata GitHub's API returns for a "list repositories" call (name, owner, default branch, visibility, URL) — never file contents.

## Security Model

Three trust relationships, kept separate (see ADR 0009 for the full rationale):

```
Supabase Auth            → who is this Vibe Business user?
GitHub App user auth      → which GitHub identity/installations can they connect? (verification only, one-time per connection)
GitHub App installation   → server-to-server repository operations (short-lived tokens, minted per request)
```

**Why the raw `installation_id` can't be trusted:** it's a callback query parameter, not a secret — observable, and not bound to whoever is making the request. Accepting it at face value would let anyone who obtains a valid `installation_id` bind someone else's installation to their own Vibe Business account.

**How trust is actually established**, in `src/app/app/connect/github/callback/route.ts`:

1. `state` (HMAC-SHA256-signed, embeds the initiating user's id + issue time, verified with constant-time comparison, 10-minute expiry) confirms this callback belongs to the session that started it.
2. The OAuth `code` GitHub includes (because "Request user authorization during installation" is enabled on the App) is exchanged server-side for a GitHub **user** access token, via `@octokit/oauth-methods` — an official Octokit package, not hand-rolled token-endpoint code.
3. That user token calls `GET /user` (identity) and `GET /user/installations` (accessible installations) — **as that GitHub user**, not the Vibe session.
4. Only if the claimed `installation_id` appears in that user's own installation list is anything persisted.

Tokens: the GitHub user access token is used immediately for step 3 and then goes out of scope — never persisted, never logged. Installation access tokens (minted via `@octokit/auth-app` in `src/modules/github/app-client.ts`) are created fresh per server-side operation, live only in memory for that request/response cycle, and are never returned to the browser, logged, or persisted.

## User Flow

```
/app (authenticated)
  → "Connect your first project" → GET /app/connect/github
      → state created, redirect to GitHub install/authorize
  → GitHub: user installs App, selects repos, authorizes
      → GET /app/connect/github/callback?code&installation_id&state
          → state verified → code exchanged → identity fetched
          → installation ownership verified against that identity
          → github_connections + github_installations upserted
      → redirect to /app/connect/github/repositories?installation=<uuid>
  → user picks exactly one repository
      → Server Action re-verifies the repo against a fresh installation
        listing (never trusts the submitted form data's metadata)
      → Project + RepositoryConnection created
  → redirect to /app/projects/[projectId]
      → shows repository metadata, live "still accessible" probe,
        disabled "Analyze business" CTA, "Disconnect project"
```

## Acceptance Criteria

All met by this implementation:

1. `/app` is actually authenticated (`src/app/app/layout.tsx` → `requireSession()`).
2. Anonymous users cannot start the GitHub connect flow (`requireSession()` in the start/callback route handlers, redirects to `/login`).
3. Authenticated users can start GitHub App connection.
4. GitHub identity is securely verified (OAuth user token → `GET /user`).
5. `installation_id` is never trusted by itself (ADR 0009 check in the callback, `installations.ts`).
6. Verified installations are stored without an installation token (`github_installations` has no token column; nothing in the code path ever writes one).
7. Accessible repositories are listed (`listInstallationRepositories`, installation-token-authenticated).
8. Users select exactly one repository (`repository_connections.project_id` is unique — 1:1).
9. Project + repository connection persist in Supabase (`createProjectWithRepository`).
10. RLS isolates users (every table, explicit policies — see the migration and Security section of the final report).
11. Dashboard displays real connected projects (`listProjectsForUser`).
12. Project page displays real repository metadata (`getProjectWithRepository`).
13. Users can disconnect the local project relationship safely (`disconnectProject`, confirmation dialog, GitHub untouched).
14. No GitHub write permission is required (Metadata: Read-only only — see `docs/setup/github-app.md`).
15. No repository code is cloned/read/executed anywhere.
16. No AI code exists.
17. Audit events are generated for every meaningful action, through one shared `recordAuditEvent()`.
18. Unit/security tests pass (43 tests: state signing/verification, installation-ownership normalization/rejection, repository normalization, env validation, audit-log writes, project creation/duplicate-protection/disconnect).
19–22. lint/typecheck/test/build all pass.
23. No secrets committed (see final report's Security section for the scan).
24. Documentation complete (this document, ADR 0009, `docs/setup/github-app.md`, module READMEs).

## Validation

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (43 tests), `pnpm build` all pass — the last two confirmed with **zero environment variables set**, matching Sprint 0's CI-without-secrets requirement extended to GitHub config.
- Every GitHub-API-touching function in `src/modules/github/` is unit-tested against an injected fake client (no `vi.mock`, no real network) — see `installations.test.ts`, `repositories.test.ts`.
- `state.test.ts` covers round-trip validity, tampering, wrong secret, wrong user, and expiry (via `vi.useFakeTimers`).
- `connect.test.ts` / `disconnect.test.ts` cover duplicate-repository protection (Postgres unique-violation code `23505`), rollback-on-failure, and not-found handling, against a fake Supabase client.
- **Real end-to-end GitHub verification is pending manual setup** and was not performed in this session — no GitHub App credentials were available. Per instruction, this is reported as pending, not claimed as passing. See "Manual Setup" below and the final report's Validation section for exactly what was and wasn't exercised against live services.
- Migration SQL was reviewed carefully (RLS on every table, FKs with explicit cascade/restrict, unique constraints, indexes) but **not executed against a live Postgres instance** in this session — no Supabase CLI/database credentials were available (the connected Supabase MCP tool points at an unrelated project). See Manual Setup.

## Manual Setup

1. **GitHub App** — follow [docs/setup/github-app.md](../setup/github-app.md) exactly (permissions, callback URL, "Request user authorization during installation").
2. **Environment variables** — `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` in `.env.local` (dev) and Vercel (production) — see `.env.example`.
3. **Database migration** — apply `supabase/migrations/20260809210125_github_connection_and_projects.sql` to your Supabase project (SQL Editor paste, or `supabase db push` if the CLI is linked). Not applied automatically in this session — see the final report for exact commands.

## Risks / Notes

- **No webhooks yet — a real lifecycle gap, not silently ignored.** If a user uninstalls the App, suspends it, or removes repository access directly on GitHub, Vibe Business has no push notification of that. It finds out only the next time it actually calls the GitHub API for that installation (the project page's live `checkInstallationStillAccessible()` probe, or a future repository-listing call) — until then, a stored `github_installations`/`repository_connections` row can be stale. Building the full webhook system (signature verification, event routing, retry handling) was judged to materially expand this sprint beyond its scope, per the sprint brief's own instruction to skip it if so. **This is an immediate follow-up requirement**, not deferred indefinitely: implementing `installation.deleted`, `installation.suspend`, and `installation_repositories.removed` webhook handling should be an early item in the next infrastructure-focused sprint.
- **Duplicate-repository protection is enforced at the database layer** (`repository_connections.github_repository_id` unique constraint) and surfaced as a clean user-facing error — but project creation is two sequential inserts with a best-effort rollback on failure, not a single atomic transaction/RPC. An interrupted process between the two inserts could theoretically leave an orphaned `projects` row with no repository connection. Judged an acceptable Sprint 1 simplification over adding a Postgres stored procedure; revisit if this ever causes real orphaned rows.
- **`state` CSRF protection is not independently single-use.** It's signed, expiring (10 minutes), and bound to the initiating user — but there's no server-side nonce store rejecting a replayed state. This is a deliberate tradeoff (see `src/modules/github/state.ts`): replaying a state alone cannot grant a connection, because the callback still independently re-verifies installation ownership against GitHub's API before persisting anything. A stolen state is not a stolen installation.
- **Repository/installation listing is not paginated** beyond 100 items each. Reasonable for real users in Sprint 1; would need real pagination (via `octokit.paginate`) if a user's installation ever has more repositories, or a user has more than 100 GitHub App installations.
- **`SUPABASE_SERVICE_ROLE_KEY` is still not introduced.** Every database operation in this sprint runs through the per-request, cookie-authenticated Supabase client, so RLS is always enforced — never bypassed. Consistent with the Sprint 0 decision.
