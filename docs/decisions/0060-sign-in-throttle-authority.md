# ADR 0060 — The sign-in throttle's authority is who may call it

**Status:** Accepted
**Date:** 2026-08-27
**Closes:** VB-053 (and completes VB-010)

## Context

[VB-010](../sprints/0103-wave1-security-before-public-traffic.md) added per-account sign-in throttling. Supabase Auth limits by IP and Vibe runs behind a shared Vercel egress pool, so one attacker's attempts against one account arrive mixed into everyone else's traffic and the platform limit stops meaning "this account is under attack".

The mechanism is one `SECURITY DEFINER` function, `record_auth_attempt`, holding all the state and all the arithmetic. It was granted to `anon`, on the reasoning that sign-in happens before there is a session so the caller *is* `anon`.

That reasoning is correct about the caller and wrong about the consequence. `anon` is reachable by anyone holding the publishable key, and the publishable key is published — it is in every browser bundle by design. Measured against the deployed database with nothing else:

- eight POSTs carrying `sha256(lower(victim@example.com))` and `p_succeeded: false` → that account is refused sign-in for 884 seconds, repeatable indefinitely;
- one POST carrying `p_succeeded: true` → the window is deleted and the account is unthrottled again.

[Sprint 0104](../sprints/0104-wave2-database-and-performance.md) closed the second: a success now clears the window for the address in the caller's own verified JWT, and the identifier argument is not consulted on that path. An anonymous caller holds no session and clears nothing.

The first is still open, and it is the worse of the two. It is not a weakness in the control — it is the control **used as a weapon**. Before VB-010, nobody could stop a known address from signing in. After it, anyone who can guess an email address can, fifteen minutes at a time, forever.

## The decision

**`record_auth_attempt` is no longer callable through the Data API. The sign-in action calls it with a service-role client.**

`execute` is revoked from `anon` and `authenticated`. The only caller is `src/modules/auth/throttle.ts`, which obtains a service-role client itself and hands it to nobody.

### Why this and not the alternatives

Three shapes were available, and only one of them closes the vector rather than narrowing it.

**A secret the server holds and the browser does not** — an argument the function checks against a value stored in the database. It works, and it costs an environment variable plus a secret provisioned into a table out of band. It cannot be committed ([rule 12](../../CLAUDE.md)), so it ships inert and stays inert until two separate manual steps are done in the right order — and while it is inert, the vector is open with nothing saying so. A security control whose enabled state lives in two places nobody can read from the repository is a control nobody can be sure about.

**Dropping the account throttle** and keeping Supabase's IP limits. This is a real option and worth stating plainly rather than dismissing: it removes the lockout completely and returns the guessing bound to what it was before VB-010. It was rejected because the gap VB-010 named is genuine — a shared egress pool means the IP limit does not see one account being attacked — and answering a misuse of a control by deleting the control leaves the original problem.

**Making the call privileged.** The forgery is a transport-layer fact: the attacker can reach the function. Removing the reach removes both vectors at once, and it removes them *by construction* rather than by argument validation. It needs no new secret, no new variable, no provisioning step, and no ADR to reverse a decision later.

### What this does to the JWT-derived clear

It replaces it. With the function unreachable by the public, the identifier argument is trustworthy again — the only caller is Vibe's own server — so a success clears the window named by the argument, as it originally did.

This is worth being explicit about, because it looks like a rollback of a security fix and is not. Sprint 0104's JWT check existed to make a *publicly callable* function safe. Under this decision the function is not publicly callable, and the JWT check would in fact break it: a service-role caller carries no `email` claim, so nothing would ever be cleared and a customer who mistyped several times would stay throttled until the window aged out.

The authority moved from *what the caller can prove about its arguments* to *whether the caller may call at all*. That is the stronger boundary, and keeping both would mean keeping a check that can only ever refuse the one legitimate caller.

## Relationship to rule 53

[CLAUDE.md rule 53](../../CLAUDE.md) says the service-role client is for durable execution only, and that only `src/modules/operations/` may use it. That rule has a review mechanism rather than a literal boundary — `src/lib/supabase/service-boundary.test.ts` carries an allowlist whose own docblock says *"adding a line here is the review"* — and three sites already sit on it. This is the fourth, and the review is this section.

The rule's substance is that an RLS-bypassing client is obtained only where somebody argued for it, and that every query made with it re-establishes ownership in code, because RLS no longer will. Both hold here, the second vacuously and worth saying why:

- **The client's entire use is one RPC call.** `throttle.ts` creates it, calls `record_auth_attempt`, and drops it. It reads no table, writes no table, and is never returned to a caller.
- **There is no tenant to establish ownership of.** `auth_attempt_windows` holds a SHA-256 of an address and three timestamps. It has no `user_id` and no `project_id`; there is no row belonging to one customer that another could reach. The clause about filtering on ownership has nothing to bind to here — which is not the same as being ignored.
- **The function returns a boolean and a number.** Even a caller who could name any hash learns only whether that hash is currently throttled — and after this decision, no such caller exists.

The blast radius of the addition is therefore one function whose entire vocabulary is "may this attempt proceed".

## What this does not fix

- **A distributed attempt across many accounts** is unchanged. This bounds how fast one account can be guessed at; it was never a defence against breadth.
- **The window numbers are still chosen, not measured.** Eight failures in fifteen minutes is a round number above what the UI produces and below what a loop does.
- **The fail-open posture is unchanged and still untested against a real outage.** If the database cannot answer — including if the service-role key is absent — sign-in proceeds. That remains the right default: this sits *on top of* Supabase's own limits and its own password check, so failing open degrades to the protection that existed before it, while failing closed would turn a database blip into "nobody can sign in".

## Consequences

- One more site on the service-role allowlist, with the argument recorded in the test beside it.
- The throttle now depends on `SUPABASE_SERVICE_ROLE_KEY` being present in the runtime that serves the sign-in action. It is, and its absence degrades to fail-open rather than to an error.
- `record_auth_attempt` can no longer be exercised through PostgREST, so the probe that found this vector cannot be re-run the same way. The real-PostgreSQL migration tests assert the privilege directly instead.
- **`service_role` needs the `execute` grant explicitly**, and the first draft of this decision said otherwise. `service_role` is an ordinary role with `bypassrls`, not a superuser and not a member of `postgres`; Supabase's default privileges apply when a function is *created*, and `create or replace` keeps the existing ACL. Reading `pg_proc.proacl` back after the apply returned `{postgres=X/postgres}` — nobody but the owner. The failure would have been silent, because the throttle fails open: every call would have errored, every call would have returned `allowed`, and the control would have been present, wired, tested and doing nothing. Corrected by `20260827233211`, and the migration tests now run under `set local role service_role` so the grant is load-bearing for every assertion rather than for one.
