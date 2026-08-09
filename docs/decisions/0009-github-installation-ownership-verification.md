# 0009 - GitHub Installation Ownership Verification

Status: Accepted
Date: 2026-08-09

## Context

[ADR 0003](0003-github-app-integration.md) established that Vibe Business integrates with GitHub via a GitHub App, using short-lived installation access tokens for server-to-server repository operations. It did not address a question that only becomes concrete once a real connect flow is implemented (Sprint 1): when a browser redirect brings back a GitHub App `installation_id`, how does Vibe Business know that the currently authenticated Vibe Business user is actually allowed to associate that installation with their account?

## Decision

**The `installation_id` received from a GitHub callback must never be trusted by itself.**

A GitHub App installation ID is not a secret and is not bound to a specific requester — it is a public-ish identifier tied to a GitHub account/organization, visible in URLs and callback query parameters. Accepting it at face value would let anyone who observes or guesses a valid `installation_id` (e.g., by watching a callback URL, or simply trying sequential/known IDs) associate someone else's GitHub App installation with their own Vibe Business account, without ever proving they control a GitHub identity with access to it.

Vibe Business securely verifies ownership using the **GitHub App user authorization (OAuth) flow**, requested at the same time as installation (GitHub App setting: "Request user authorization (OAuth) during installation"). Concretely:

1. The user is redirected to GitHub with an unpredictable, signed, expiring, user-bound `state` value (see [docs/sprints/0001-github-app-connection.md](../sprints/0001-github-app-connection.md) for the exact mechanism).
2. GitHub redirects back with both an `installation_id` **and** an OAuth `code`.
3. Vibe Business exchanges `code` for a **GitHub user access token**, server-side.
4. Vibe Business calls the GitHub API **as that user** (`GET /user`, `GET /user/installations`) to (a) learn the real GitHub identity behind the token, and (b) confirm the claimed `installation_id` actually appears in the list of installations that GitHub identity can access.
5. Only if all of state/user-identity/installation-membership check out does Vibe Business persist the connection.

### Separation of concerns

Three distinct trust relationships exist and must not be conflated:

| Mechanism | Answers | Used for |
|---|---|---|
| **Supabase Auth** | Who is this Vibe Business user? | Authenticating the Vibe Business user session (ADR 0002). |
| **GitHub App user authorization** | Which GitHub identity does this Vibe Business user control, and which installations can that identity access? | One-time (per connection) identity/ownership verification only. |
| **GitHub App installation authentication** | Acting as the installation itself, server-to-server. | All subsequent repository operations (listing repos, reading metadata, and in later sprints, code changes) — via short-lived installation access tokens, per ADR 0003. |

**This does not make GitHub an authentication provider for Vibe Business.** A user still cannot sign in to Vibe Business with GitHub; the GitHub user access token obtained here is used exclusively, transiently, server-side, to answer "does this already-authenticated Vibe user actually control a GitHub identity with access to this installation?" — never to establish or extend a Vibe Business session.

## Consequences

### Positive

- Closes a real privilege-escalation/confused-deputy vector: without this check, an attacker could bind a victim's GitHub installation to the attacker's own Vibe Business account by replaying an observed `installation_id`.
- Keeps the three trust boundaries (Vibe identity, GitHub identity, GitHub server-to-server access) explicit and independently reasoned about, rather than collapsing them into "whatever installation_id showed up in the URL."
- The GitHub user access token is never persisted (see [docs/sprints/0001-github-app-connection.md](../sprints/0001-github-app-connection.md)) — it exists only for the duration of the verification call, minimizing the blast radius of a compromised database.

### Negative / Tradeoffs

- Requires the GitHub App to have "Request user authorization (OAuth) during installation" enabled, and requires handling an OAuth code-exchange step in addition to the installation flow — more implementation surface than naively trusting `installation_id`.
- Ties the connect flow to the browser session that initiated it (via the signed state's user binding); a user cannot complete the connection from a different authenticated session/device than the one that started it.
- Verification requires one extra live call to GitHub's API (`GET /user/installations`) during the callback, beyond what a naive implementation would need.

## Revisit when

GitHub webhooks are implemented (tracked as a Sprint 1 follow-up, not yet built — see [docs/sprints/0001-github-app-connection.md](../sprints/0001-github-app-connection.md)) and can independently confirm installation lifecycle events (deleted/suspended) signed by GitHub, which is a complementary mechanism, not a replacement for this ownership check at connection time.
