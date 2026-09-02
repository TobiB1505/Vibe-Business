# The six the audit called P0, and the one that could never have worked

**Recorded 2026-09-01, after the work.** The first implementation slice off the [performance and code-health audit](../audits/2026-09-01-performance-code-health/README.md), taken after [PERF-001 was verified closed](../audits/2026-09-01-performance-code-health/region-verification.md) by moving the Vercel functions to Stockholm. Six findings, six commits, two migrations, no product change.

Nothing here is a feature. Two are correctness defects that were silently wrong in production, two are unbounded costs that grow with use, one is a missing bound on an outbound call, and one is a retry storm waiting for a bad afternoon.

## The one that could never have worked

**`repair_account_balance` and `repair_lot_allocation` are granted to `service_role` alone.** Both were called with the billing page's cookie-scoped client. Every billing table carries a select policy and deliberately no write policy, so the repair could only ever answer `42501` — meaning the read-triggered repair layer [ADR 0042](../decisions/0042-billing-reconciliation-authority.md) designed, and which [Sprint 0065](0065-billing-reconciliation-p3-repair-trigger-wiring.md) wired, could not succeed once. With `BILLING_REPAIR_ENABLED` set, a drifted account would render its billing page, fail, and write a `credit_drift.repair_failed` row — on every render, forever.

The grant was right and the caller was wrong. Both call sites now obtain a service-role client and both are recorded in `REVIEWED_SITES` with the argument rule 53 asks for: ownership is not taken from a caller's argument, because the account row and the lots were read a moment earlier through the caller's own RLS-scoped client, from the session's user id.

**The test that matters is not a unit test.** A `FakeDatabase` has no roles to refuse anybody, so it cannot see this class of defect at all. The grants are now pinned against real PostgreSQL — `false|false|true` for `anon|authenticated|service_role` on both repair functions and on the three materialization primitives they delegate to. That test exists so the same symptom is never fixed the other way round, by granting a financial write to the role a browser holds.

## The one that was quietly wrong on old accounts

**`welcomeGranted` was derived from a capped window.** `listLedgerEntries` reads a hundred rows, newest first ([Sprint 0110](0110-the-open-code-items.md)'s VB-025 cap, which is right). The welcome grant is the *oldest* row an account has. Past a hundred movements it left the window, the flag flipped to `false`, and the billing screen re-offered Credits the customer had already been given.

`hasLedgerEntryWithKey` asks the database directly, answered by the existing unique index on `(credit_account_id, idempotency_key)`, and joins the wave of reads the page already makes — so it costs no round trip. Its test pins the premise as well as the result: it asserts the grant really is outside the capped window before asserting that it is still reported, so the test cannot go quiet the day the cap changes.

## The two unbounded costs

**The gateway's spend read was quadratic in the length of a run.** `readAgentRunGatewayState` runs on every forwarded sampling request and read every `ai_usage_events` row the run had written, to compute two numbers about them. Request *n* carried *n−1* rows; a large run is allowed 260 requests, so a run transferred roughly 9,800 to 34,000 rows to answer "how many tokens, how many calls".

The sharper reason is not the transfer. `max_rows` is 1000, so past a thousand rows PostgREST would have truncated the read **silently** — and a truncated sum is not a slow answer, it is a wrong one, under-reporting spend against the ceiling it feeds. `sum_agent_run_usage` returns both numbers in one round trip and no rows, with the two semantics the ceiling rests on preserved exactly: every row counts whatever its status, because a stream that dies after the provider emitted tokens was still billed for them ([VB-016](0104-wave2-database-and-performance.md)), and the request count still takes the larger of the ledger and the claim counter.

The error is thrown rather than absorbed. Zero has no truthful reading here, and a missing function would otherwise have handed a run its whole budget back in silence — which makes the deploy order load-bearing, migration first.

**Three windows had no index that reached them.** `withinStartWindows` counts an account's and a project's recent starts before every operation begins, and `observeAccountSpend` reads the last 24 hours after every billed provider call. `operation_runs` has two indexes leading with `user_id` and both are *partial*, so a count over an account's whole history could use neither; the identity index gives `(project_id, operation_type)` but carries `input_identity` third and no timestamp; `ai_usage_events` has only the generated `(user_id)`.

None of this is slow today — the largest table holds about a thousand rows. That is the argument for doing it while it is free.

## The two bounds that were missing

**The gateway's upstream call had no deadline.** It was the one outbound request in the repository without one. `fetch` has no default timeout, so a socket that was accepted and then went quiet was held until the platform killed the function at `maxDuration` — and a killed function records nothing, which is exactly the accounting hole the streaming rewrite exists to close.

The bound is on the *headers*, not the body. `withBoundedFetch`'s `AbortSignal.timeout` stays armed for the whole response, which on a streamed turn would sever a healthy generation mid-sentence, so the timer is cleared the moment `fetch` resolves. 240s rather than something tight, because a non-streamed request is served here too and Anthropic withholds its headers until that message is composed. Both halves are tested with fake timers: a silent upstream is aborted, recorded and answered 502, and a successful answer leaves its signal unaborted three deadlines later.

**The poll hook asked harder the worse things got.** It armed a bare `setInterval` and called the reader as `void tick()`. A read slower than the interval stacked — callers run from 1.8s and the Supabase client's deadline is fifteen seconds, so one tab could hold several concurrent Server Actions open for the same operation — and a rejected read became an unhandled rejection, after which the same cadence asked again immediately.

A read is now single-flight, a throw is caught, and consecutive failures double the wait to a ceiling of eight intervals. The wait is a skipped tick rather than a rescheduled timer, so recovery lands on the next tick after the backoff — the same shape the hidden-tab skip already used. The schedule is a pure exported function with its own tests, because the hook needs a DOM and this repository's test environment is Node.

## Deployment

Both migrations are **applied** to the Vibe-Business project (`dcbwlctscooefwnivxzv`, confirmed by name before anything was touched — rule 33). Checked before, not assumed (rule 30): neither the function nor any of the three indexes existed, and the remote history stood at `20260901160000`, exactly the last file before these two.

**Not by the CLI, for the reason [Sprint 0114](0114-the-preview-is-the-review.md) recorded.** `supabase link` needs a personal access token this environment does not carry. The Supabase MCP server's `apply_migration` was used instead: it is not SQL Editor copy/paste (rule 29's emergency fallback), it runs the file's own SQL, and it writes `supabase_migrations.schema_migrations`.

**The same repair as last time.** `apply_migration` stamps a version from the wall clock, so history recorded `20260901204631` and `20260901204638`. Left alone, the next `pnpm db:push` would find both local files pending and re-run them. Both rows were corrected to the filenames' versions — what `supabase migration repair --status applied` performs — and read back. `supabase/migrations/` remains the source of truth (rule 34).

Verified by reading the schema back rather than from the calls' own success: the function exists, is `SECURITY INVOKER`, pins `search_path`, and its ACL reads `false|false|true`; all three indexes exist; and the function answers `0|0` for a run with no usage, which is the branch the caller depends on. Advisors after the change: **no new security lint** (the four `rls_enabled_no_policy` INFOs are the deliberate insert-only ledgers, and the leaked-password WARN is the standing ROADMAP item).

The application code that uses the function is on this branch and not deployed. Nothing on `main` calls it, and three added indexes change no behaviour — which is why applying them first is the safe order rather than a risk taken early.

## What this deliberately did not do

- **No page-speed work.** [PERF-004](../audits/2026-09-01-performance-code-health/README.md) (Health/Home re-reads the evidence it was handed, no Suspense) and [PERF-005](../audits/2026-09-01-performance-code-health/README.md) (Action Plan's N+1 over the Moves) are the audit's Phase 2 and are now the binding constraint: the region move left a 59-query render costing 665ms of database phase, and 59 queries cost that whatever the distance.
- **No index for the five foreign keys** the same finding names. The generator in [Wave 2](0104-wave2-database-and-performance.md) treats a partial index as covering because its predicate omits `i.indpred is null`; those are deletion-cascade paths on small tables, and closing them is its own change with its own argument.
- **No test asserting the three indexes exist.** A plain performance index has no semantics to violate, so such a test restates the DDL. What would check it is an `EXPLAIN` at realistic volume, which stays where the audit put it — an open verification.
- **No change to what any screen renders.** No new state, no new copy, no new dependency.

## What has not been proved

- **That the indexes are used.** At a thousand rows PostgreSQL may reasonably prefer a sequential scan, and nothing here measures a plan.
- **That the repair layer now succeeds end to end.** The grant is pinned and the client is right; what has not happened is a genuinely drifted account rendering its billing page with `BILLING_REPAIR_ENABLED` set and producing `credit_drift.repaired`. That is the observation [the activation checklist](../deployment/billing-reconciliation-sprint-f-activation.md) asks for, and it needs drift to exist.
- **That the gateway deadline is the right number.** 240s is chosen, not measured — the point is that a bound exists.
