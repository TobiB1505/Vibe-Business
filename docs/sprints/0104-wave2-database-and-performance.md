# Wave 2 — database & performance

**Recorded 2026-08-27, after the work.** Nine findings from the [launch-readiness audit](../audits/2026-08-26-launch-readiness/README.md)'s Wave 2: *"database & performance"*. Six closed, three partly — and the three are partial for stated reasons rather than because the wave ran out of room. Three migrations, all deployed before the code that needs them.

And one finding this wave did not start with: reading the advisors for VB-026 surfaced a defect [Wave 1](0103-wave1-security-before-public-traffic.md) had shipped four hours earlier, in the control it added. That section is the one worth reading.

## What was wrong

Wave 1 was the block between erasure and letting strangers reach the product. Wave 2 is everything that would make the product *slow* or *wrong under load* once they did — plus the three database findings the wave plan groups as one reviewed batch.

None of it was customer-visible yet, which is exactly why it was worth doing before there were customers.

## What changed

### The database batch (VB-026, VB-027, VB-036)

Shipped as the one migration the wave plan asks for, and measured against the deployed database before and after: **`auth_rls_initplan` 114 → 0, `unindexed_foreign_keys` 57 → 0.**

**VB-026.** Every policy in the schema named `auth.uid()` directly, so PostgreSQL re-evaluated it for **every row a statement touched** — it cannot prove the call is stable across rows. Wrapped in a scalar subquery it becomes an InitPlan: once per statement, then compared.

The obvious cost is page latency. The larger one is deletion: Wave 0 made project deletion and account erasure walk a cascade across roughly forty tables, and every policy check along the way was paying per row.

The rewrite reads each policy's own **deparsed definition out of `pg_policies`** and puts it back with the calls wrapped, carrying `permissive`, `cmd` and `roles` across explicitly. Transcribing 114 policies by hand is where a `using` silently becomes a `with check`. What says the meaning survived is that the behavioural migration tests passed unchanged — they assert what policies *refuse*, not how they are spelled.

**VB-027.** Fifty-seven foreign keys had no covering index, including `product_scan_events.user_id`, which is also its RLS predicate. Generated from `pg_constraint` rather than transcribed from the advisor's list.

**VB-036.** `ai_usage_events` and `deep_scan_provider_usage` accepted client `INSERT`s — a customer could write rows reconciliation reads as provider cost, or squat a `job_id` and deny the real usage write its unique slot. Only durable execution writes them, so the grant is withdrawn rather than a policy added.

**VB-040** needed nothing: the M2 migration from the [lifecycle & erasure review](../audits/2026-08-26-lifecycle-erasure-architecture-review/README.md) had already moved all five usage tables' `project_id` to `ON DELETE SET NULL`. Confirmed by reading `pg_constraint`, not by assuming.

### The reads a page makes (VB-022, VB-023, VB-024, VB-025)

**VB-022, in part.** The Business Health render asks fourteen questions at once, and several of the services answering them re-read the same documents underneath — the audit three times, the repository snapshot four. Each is a JSONB document, so the cost is bytes off the wire and parse time, repeated. Six getters are wrapped in React's `cache()`.

**VB-024.** `getProjectImpact` walked its prepared changes one at a time and each step can reach GitHub through `getMergeCard`, so ten changes meant ten sequential round trips before the page could render. Bounded rather than a plain `Promise.all`: one GitHub call per prepared change, all at once, is how a busy project trips a secondary rate limit.

**VB-023, in part.** `getPreparedChangeWorkspace` was already parallel and **unbounded** — every prepared change's card at once. The ceiling VB-024 introduced is extracted into `src/lib/async/concurrency.ts` and shared, so the two read models that fan out the same way cannot drift into disagreeing about what is safe.

Input order is preserved in both. These lists are what a founder reads, and a card moving because one call was slow is its own defect.

**VB-025, in part.** `getProjectAuditReadings` grew with every audit a project ever ran; `listAgentActivity` was unbounded over rows an agent run emits by the thousand.

The **direction** matters more than the cap. Activity is ordered ascending because a log reads forwards, and capping an ascending order keeps the *first* rows — hiding how the run ended, which is the half anyone opening it wants. The query takes the newest and restores the order afterwards.

### A malformed id (VB-028)

A route parameter went straight into `.eq("id", …)`. PostgreSQL answers a malformed one with `22P02`, the store threw it, and the request became a **500** — Vibe reporting that *it* broke, for something anyone can produce by typing. That pages whoever is watching and fills the error tracker with traffic a visitor generates.

The check sits in `requireProjectAccess`, which fourteen routes go through, and in the onboarding page, which resolves its own context. An id that cannot exist and one that does not exist get the same answer.

## The Wave 1 defect this wave found

Reading the security advisors alongside the performance ones flagged `record_auth_attempt` as a `SECURITY DEFINER` function executable by `anon`. That part is deliberate and correct — sign-in happens before there is a session. The question the advisor prompted, and that Wave 1 never asked, is **what a hostile caller can do with a function it is allowed to call.**

Measured against the deployed database with nothing but the publishable key, which is published in every browser bundle:

- eight POSTs carrying `sha256(lower(victim@example.com))` and `p_succeeded: false` → the pre-check answers `allowed: false, retry_after_seconds: 884` for that account;
- one POST carrying `p_succeeded: true` → **the window is deleted and the account is unthrottled again.**

The second makes the control opt-out. An attacker guessing passwords clears the counter between guesses and the allowance never runs down — so VB-010, as shipped, bounded nothing against anyone who knew it existed.

The repair is not a stricter check on the argument. **A success now clears the window for the address in the caller's own verified JWT, and the identifier argument is not consulted on that path.** The legitimate caller is the sign-in action immediately after the credentials were accepted, so it holds exactly that session; an anonymous caller holds none and clears nothing. There is no argument that can be crafted into being someone else.

`p_max_failures` and `p_window_seconds` went with it. The application never passed either, but a client could — and a client that chooses the allowance on the control bounding it is a control with an opt-out.

Re-probed against production after deployment: the block survives an anonymous `p_succeeded: true`, and the four-argument overload answers `PGRST202`.

**Wave 1's own test file is why this shipped.** Every test in it asked whether the mechanism *works* — brute force refused, one account bounded without touching another, the window cleared on success. None asked what an attacker reaching the same function could do. The file now has a `describe` block that does, and it was verified by breaking the fix: restoring the argument-keyed delete fails three of its tests.

## What the work found that the findings did not say

- **A guard that never fired.** VB-026's first test asserted that no policy matches `[^ ]auth[.]uid[(][)]` — and `pg_policies` deparses the bare call as `(auth.uid() = user_id)`, space-preceded, so the pattern never matched anything and the test passed with the rewrite disabled. Replaced with an occurrence count: total `auth.uid()` mentions must equal wrapped ones. Re-probed with the rewrite off, and it fails.
- **A hand-written composite index named the wrong leading column** (`action_plan_step_id` where the constraint leads with `action_plan_id`) — an index that satisfies the advisor and helps nothing. Read from `pg_constraint` and generated instead.
- **A policy named from a superseded migration.** The `execution_interrupts` UPDATE policy is `answer own …`, not `update own …`; the real-PostgreSQL harness refused to apply the guess.
- **`listLedgerEntries` is not a display read.** Both its callers pass the entries to `computeBalance`, which sums them — so capping it would silently produce a **wrong customer balance**. The audit anticipated this by asking for "caps *and* a running aggregate for reconciliation"; the aggregate is a change to the balance authority, not a display cap.
- **React `cache()` memoizes only inside a render** — measured directly rather than assumed, because these stores are shared with durable execution and a memo surviving a workflow step boundary would hand a step stale state. Outside a render every call is a miss, which is what makes the change safe there.
- **`FakeDatabase` orders lexicographically** while production orders an integer column numerically, and over `0..899` the two disagree (`"99" > "899"`). The activity fixture starts at sequence 1000 so the assertion is about the code rather than about the fake.

## What was not done, and why

- **VB-022's id-only existence variants.** `isProfileCurrent` and `getAuditReadiness` fetch whole JSONB documents to evaluate `Boolean(snapshot?.result)`. Inside a render that shares the document with a real reader, `cache()` now makes the second fetch free — but a render that only asks the existence question still transfers the whole document, and that is what the finding's second half asked for.
- **VB-023's other two halves.** Batching the per-card reads into one query per table with `.in(…)` is a refactor of a card builder used by more than this page; wrapping the GitHub preflight in `<Suspense>` is a rendering change. Neither belongs in the same commit as a concurrency bound, and neither is done.
- **VB-025's ledger cap**, for the reason above. It needs the running aggregate first.
- **`unused_index`, now 81 and rising.** The advisor's list included an index created forty minutes earlier, so on a pre-launch database it reports "never scanned yet" rather than "useless". It becomes a real signal once there is traffic; acting on it now would delete the indexes VB-027 just added.
- **VB-053 — the throttle's remaining half, and it needs a decision, not a repair.** An anonymous caller can still spend a *victim's* allowance and hold their account out of password sign-in for fifteen minutes at a time, repeatably. Closing it means the counter cannot be written by the public, and there are only two shapes for that: a secret the server holds and the browser does not (an environment variable, plus provisioning it into the database out of band — it cannot be committed), or a privileged client, which [CLAUDE.md](../../CLAUDE.md) rule 53 confines to durable execution. Both are above a repair. Third option, worth stating because it is real: drop the account throttle entirely and keep Supabase's own IP limits, which removes the lockout without pretending to bound guessing.

## What has not been proved

- **VB-022's benefit is unverified, and cannot be from a unit test.** `cache()` only memoizes inside a render; the finding's own verification is a PostgREST log showing one fetch per document per render, which needs a signed-in session against a real database. The tests pin the *risk* instead — no memo survives a request, no project is served another's audit — both of which would fail if `cache()` were swapped for a process-wide memo.
- **VB-028's status code.** Signed out, the proxy redirects to login before the page runs; signed in needs a session the browser suite deliberately cannot create. What is verified is that `notFound()` is reached before any query is built — the step that used to throw.
- **The throttle repair has not been through a real sign-in.** The clear path depends on `signInWithPassword` having attached the new session to the client the next call is made on. That is the documented behaviour of `supabase-js`, and it is asserted against real PostgreSQL by setting the claim the way PostgREST sets it — not by signing a real account in. If it were wrong, a customer who mistyped several times and then succeeded would carry the window until it aged out.
- **No dogfood, and no load.** Every performance change here is argued from the read pattern, not measured against a page under traffic. The database half is measured — the advisors are a real before/after — and the application half is not.

## Validation

Measured on the branch head:

| check | result |
| --- | --- |
| Performance advisors | `auth_rls_initplan` **114 → 0**, `unindexed_foreign_keys` **57 → 0**; 81 `unused_index` INFO remain, deliberately |
| Throttle re-probe against production | anonymous `p_succeeded: true` no longer clears a window; the four-argument overload answers `PGRST202` |
| Migration tests (real PostgreSQL) | 147 passed, 9 files (was 136) |
| Unit tests | 6765 passed, 394 files |
| Browser tests | 366 passed |
| `pnpm typecheck` | clean |
| `pnpm lint` | 19 warnings, 0 errors — the baseline `main` already carried |
| `pnpm build` | clean |

Every migration was applied and then **read back out of the catalog** rather than trusted from the apply response: `pg_constraint` for VB-027 and VB-040, `pg_policies` counts for VB-026, `pg_proc.proacl` for the throttle's new signature and grants.
