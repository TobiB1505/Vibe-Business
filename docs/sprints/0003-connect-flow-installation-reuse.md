# Fix — Reuse an existing GitHub installation when connecting projects

Status: Complete
Branch: `fix/reuse-github-installation`

## Problem

Found during Sprint 2 production E2E validation.

A user with an already-verified GitHub App installation who clicked **"Connect another project"** was sent through `/app/connect/github` → GitHub's `/installations/new`. Because the App was already installed, GitHub redirected them to its **App configuration/settings page** instead of a connect flow.

That is correct GitHub behaviour — `/installations/new` means "install this App", and it is already installed — but the wrong product behaviour. The user did not want to reinstall anything; they wanted to pick a second repository from access they had already granted.

## Root cause

`/app/connect/github` was unconditional: every click built an anti-CSRF state and redirected to `buildInstallUrl()`. It never asked whether the user already had a usable installation.

## Fix

The route now resolves a destination first:

| Verified installations | Destination |
|---|---|
| 0 | Start the GitHub installation + authorization flow (unchanged) |
| 1 | Straight to `/app/connect/github/repositories?installation=<id>` |
| 2+ | `/app/connect/github/accounts` — choose an account/organization |

`?new=1` always forces a real installation. That path is preserved for the three cases that genuinely need it: the first installation, connecting an **additional** GitHub account/organization, and reconnecting after revoked access.

The decision itself lives in `resolveConnectDestination()` (`src/modules/github/connect-routing.ts`) — a pure function, so the behaviour is unit-tested without a session, a database, or GitHub.

### Two distinct concepts, no longer conflated

- **Connect another project** → choose from repositories Vibe Business can *already* see.
- **Manage GitHub repository access** → change which repositories GitHub *grants* the App. This deliberately links to GitHub's installation settings page (`/settings/installations/<id>`, or the organization equivalent), which is exactly where the old buggy flow accidentally landed users.

## Multiple installations

An account chooser (`/app/connect/github/accounts`) lists each verified installation with its login and whether it is a personal account or an organization. Vibe Business never silently picks one. With 0 or 1 installations there is nothing to choose, so the page redirects back to the connect route, which resolves the correct destination.

## Already-connected repositories

The picker now marks already-connected repositories as **"Already connected"** and disables their radio input, rather than hiding them — a user looking for a repository they connected last week should see *why* it is unselectable instead of wondering where it went. When every repository is connected, the submit button is disabled and the page says so.

This is presentation only. The real guarantee remains the `repository_connections.github_repository_id` unique constraint plus `createProjectWithRepository`'s `duplicate_repository` handling, so a crafted POST that skips the UI still cannot create a duplicate.

## Security

Unchanged and re-verified:

- Every entry point requires a Supabase session (`requireSession()`).
- Installation queries filter on `user_id = session.userId`, on top of RLS. `getVerifiedInstallation()` resolves to `null` for another user's row, so a guessed or copied installation row id reaches nothing.
- Installation row ids arriving as a query parameter or form field are **untrusted until re-resolved server-side**. The selection action was refactored onto the same helper, so there is one ownership check rather than two hand-written ones.
- Repository listing still happens server-side under installation authentication; no raw GitHub installation id is ever accepted from a client.
- **ADR 0009 is untouched.** Ownership verification runs exactly as before on the installation path; the fix only avoids *re-running* an installation the user has already completed and verified.

## Audit

`github.authorization.started` now fires **only when a GitHub authorization actually starts** — previously it was emitted on every click, including ones that merely reopened GitHub's settings page. The reuse paths emit nothing: navigating to a picker is not a business-meaningful action under [ADR 0007](../decisions/0007-audit-log.md). The meaningful events (`repository.selected`, `project.created`) are unchanged.

A side benefit: the reuse paths no longer read the GitHub App credentials at all, since no state needs signing.

## Tests

Added, all passing (280 total, +27):

1. Zero installations → starts the installation flow.
2. One installation → repository picker directly (the regression).
3. Multiple installations → account chooser, with an explicit assertion that no installation is auto-selected.
4. Another user's installation cannot be resolved — `getVerifiedInstallation` filters on both row id and user id.
5. Already-connected repositories are marked unselectable; `hasSelectableRepository` is false when all are connected.
6. Revoked installation degrades cleanly — the picker catches the failure and offers "Reconnect GitHub".
7. "Manage repository access" resolves to a `github.com/settings/installations/...` URL (organization variant included) and never to a Vibe Business route.

## Validation

`pnpm lint`, `pnpm typecheck`, `pnpm test` (280), `pnpm build` all pass. Build verified with zero environment variables configured.

Not exercised: the live GitHub redirect behaviour, which needs the deployed app and a real installation. The routing decision itself is covered by unit tests.

## Risks / notes

- **Cross-user duplicate repositories.** `repository_connections.github_repository_id` is globally unique (Sprint 1), so if user A connects a repository, user B cannot — and B cannot see it in their own "already connected" list because RLS hides A's rows. B gets a clean "already connected to a project" error rather than a confusing failure, but the message is slightly misleading for a repository they cannot see. Pre-existing behaviour, unchanged here; worth revisiting if Vibe Business ever supports multiple users connecting the same repository.
