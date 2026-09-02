# The clock the policy needed, and the three tables it must never reach

**Recorded 2026-09-02, after the work.** Five commits, one migration, no product change. Follows [0120](0120-the-file-that-was-six-files.md) and closes the mechanism half of the audit's Phase 6.

## What was actually wrong

[ADR 0068](../decisions/0068-retention-periods.md), written earlier the same day, decided four retention periods and deliberately no mechanism. So the periods existed and **nothing deleted anything**. No `vercel.json`, no `crons`, no `pg_cron`, nothing scheduled anywhere in the repository.

The user asked the right question about it — *"aber wir haben doch noch kein Tool, das die Daten bereinigt?"* — and the honest answer was no, the policy is a document.

## The argument for building it is not storage, and my own number said otherwise

Asked how urgent this was, I projected 380 MB per user-year from the database total divided by its age. That is wrong, and wrong in the direction that manufactures urgency. Measured properly:

| | |
|---|---:|
| Database total | 24 MB |
| Schema `public` | 9.6 MB |
| The tables retention touches at all | **3.5 MB** |

Only the third line grows with a user. The rest is `auth`, `storage`, extensions and catalogues — a fixed floor, counted as growth by the division. The real rate is **~50 MB per active user-year**, roughly nine user-years from the 500 MB free tier.

So ADR 0068's assertion that storage would not be the argument for years held, and the reason to build this is entirely elsewhere: GDPR Art. 5(1)(e), which is not discharged by the data being small, and Art. 13(2)(a), which requires publishing the periods — **and a published period that nothing honours is a false statement rather than a gap.** The mechanism has to precede the disclosure.

## The option the ADR nominated first does not work

ADR 0068 §D-2 named read-triggered sweeping — [ADR 0042](../decisions/0042-billing-reconciliation-authority.md) §P2's pattern, the one `expireStaleOperation` uses — as the option needing no new technology, and the one to evaluate first. It was evaluated first, as asked.

Staleness works read-triggered because somebody reads the row that is stale. **Retention is the mirror image: nobody reads a ninety-day-old event.** The rows that must go are exactly the rows no read reaches.

Widening it to "amortise a delete budget over any activity" was my own recommendation to the user, and it is worse — not merely inefficient, but wrong: **a sweep tied to activity never fires for an account that has stopped being active**, which is the case Art. 5(1)(e) is *about*. A retention period that only elapses while somebody is using the product is not a retention period. That correction was stated to the user before anything was built.

What is left is a clock, and `pg_cron` is the cheaper of the two that provide one. The alternative — Vercel Cron hitting a route — costs an authenticated, internet-reachable endpoint whose only job is to delete data, and stops running exactly when the application is paused or mid-deploy. Deleting rows is a database operation.

## Three findings that made ADR 0068 §5 unsafe to implement literally

Each was found by checking the live schema before writing the sweep, and each is now a dated bracket in that ADR rather than a silent edit.

**`operation_runs` cannot be swept by row age at any period.** It is the parent of six `on delete cascade` edges. One deleted row takes `prepared_changes`, `review_artifacts`, `validation_runs`, `preview_sessions` and the whole `agent_execution_runs` subtree with it — **the artifacts a human approval binds to under rule 67**. A merge that shipped four months ago would lose the prepared change and the review artifact that authorised it, while the eighteen-month audit trail kept pointing at them. ADR 0068 §5's phrase "the operational body of `operation_runs`" was never the row, and a reader implementing it literally would have deleted them.

**Two tables it classed as operational are billing sources.** `credits/reconciliation.ts` projects `sandbox_usage_events` and `review_browser_usage` into `billing_usage_events`. The argument ADR 0068 §5 makes two paragraphs later — deleting metering while keeping the charge makes "why was this account charged N credits" unanswerable — applies to both word for word, and was applied to `ai_usage_events` alone.

**`agent_execution_events` is the only record of what the agent did.** `economy/harness-metrics.ts` derives every harness metric from it and nothing materializes them per run, while rule 78 forbids activating an Agent price without a measured cost behind it. This did *not* change its period — it is the largest table and ADR 0068 decided it on its merits — but it created an obligation, discharged below.

`agent_activity_events` and `agent_tool_events` were added to the class. They are siblings of `agent_execution_events` in every respect that matters, and their omission read as an oversight rather than a decision.

## The sweep is an allowlist, which is what makes the exclusions free

Five tables named explicitly, nothing else reachable, no `on delete` edge followed and no cascade relied on. `operation_runs` is not excluded by a rule the sweep obeys — it is a name the sweep does not contain. `NEVER_SWEPT_BY_AGE` exists so the argument is findable before somebody widens the list, and so a test can assert the migration never names one; it is not consulted at runtime.

**The clock is `created_at` on all five.** Three also carry `occurred_at` and one carries `started_at`, and none of those is right: they say when the event happened and are supplied by the writer — an agent harness reporting its own timeline. `created_at` defaults to `now()` and says how long Vibe has held the row, which is the question retention asks.

**No index was added on it, deliberately.** Five indexes maintained on every insert into the highest-write tables in the schema, to serve one delete a day with no latency requirement, is the wrong trade — and the audit's own DEAD-015 already counts 83 unused-index advisor hits against this database. Revisit at roughly a million rows.

## Verified against a real Postgres, not by reading it

The container has PostgreSQL 16 binaries, so the migration was applied to a throwaway cluster with a stubbed `cron` schema rather than deployed unverified:

- applies clean, and **re-applying leaves one job rather than two** — the `unschedule` guard ahead of `schedule` does what it claims
- a row at 91 days is deleted and one at 89 days is kept, on every table; `audit_events` at 19 and 17 months
- the second run reports zero everywhere: idempotent
- `anon`, `authenticated`, `service_role` and an arbitrary fresh role are all refused with *permission denied for function*

Against the production database, only reads: every predicate matches **zero rows today** — the oldest agent event is 2026-08-19, so the first row this can delete is dated 2026-11-17.

## The failure this module already knew about, in a new direction

`economy/metric-availability.ts` exists because a null was once read as a zero: *"it means nobody was counting"*, and reading it otherwise "puts a fabricated data point into a correlation and moves the answer."

The sweep introduces the mirror failure and it is harder to see. **A run whose events were swept is not a run with null metrics — it is a run that does not appear**, and a cost-per-run computed over whatever survived is well formed and wrong. That is the exact shape ADR 0068 §1 separates from retention and then, here, causes.

So `readMetric` gains a fourth status, and the ordering carries the argument: a value that is *present* is `observed` whatever its age, because something evidently still holds it; only an absent value on a run past the horizon is attributable to the sweep. `comparableRuns` applies the later of the two bounds, since instrumentation that arrived after the horizon is still binding.

## Verification

`pnpm lint` 0/0 · `pnpm typecheck` clean · `pnpm test` **7,345 tests in 424 files green** · `pnpm build` green.

Five planted defects, each caught by exactly the intended assertion: a shortened audit period, `operation_runs` added to the sweep body (three assertions, all correct), `DEFINER` for `INVOKER`, the `unschedule` guard removed, and the economy horizon check disabled.

**Not deployed.** The migration is committed and unapplied; `pnpm db:push` moves a production schedule and belongs to the user, not to a sprint.

**No E2E run** — the same container limitation as the last five sprints. Nothing here touches a rendered screen.

## What this deliberately did not do

- **The financial ten-year sweep.** Decided, not written. The oldest financial row is dated 2026-08-17, so it could not delete anything before 2036, could not be tested against a tombstoned account because none exists, and carries ADR 0056 F5's landmine — partial deletion of the billing graph leaves `posted_credits` overstated with no repair path.
- **The derived-intelligence count rule.** `pg_cron` schedules a clock and a count rule is not a clock.
- **The privacy-page disclosure**, at the time this was written. It was done later the same day — see below.

## What has not been proved

- **That the job runs.** Nothing here has executed inside Supabase. The extension is available and not installed; the first real proof is the first firing.
- **That an unscheduled job would be noticed.** ADR 0069 §D-1: scheduling from a migration makes divergence *detectable*, and nothing yet detects it.
- **That a swept run is handled correctly by every economy reader.** `readMetric` and `comparableRuns` apply the horizon; a caller that reads a raw column still sees an absence with no explanation attached.

## Continued the same day: deployed, and the disclosure

**Deployed through the Supabase MCP server**, because the CLI workflow rule 29 prefers was unavailable — no access token in this container and no link, so `db push` could not run. Verified against the live database rather than trusting the `success` response: `pg_cron 1.6.4` installed, the function `SECURITY INVOKER` with `search_path` pinned, one job at `17 3 * * *` and active, `anon`/`authenticated`/`service_role`/`public` all refused `EXECUTE`, and row counts identical before and after. The security advisor reports nothing new.

**Inspecting the history first (rule 30) found drift**, and it is worth recording because nothing else would have surfaced it: `20260902103212_discard_prepared_change` is applied on the database and exists in **no commit in this repository** — written in this repo's voice by a parallel session that applied it without landing the file. It touches only `prepared_changes` CHECK constraints, so it is orthogonal to this work and the ordering holds. It was read before anything was applied, and deliberately **not** recreated here: a second, competing file is not a fix.

**MCP assigns the migration version at apply time**, not from the filename, so the history recorded `20260902103614` against a file named `20260902120000`. The file was renamed to match — otherwise a later `db push` would see it as unapplied and run it again (harmless, since it is idempotent, but the history would then carry it twice).

**The privacy notice states the two enforced periods**, and only those. The financial and derived classes are described as what is *kept*, because ADR 0068 decided periods for both and ADR 0069 built neither — "up to ten years" is a criterion the law sets and Vibe honours by keeping; "then deleted" would be a promise with nothing behind it. The missing half is on the page's own pending list.

Three claims about account deletion were checked against the product's own confirmation copy rather than written from memory, and one was wrong: a subscription **is** cancelled immediately, with no refund of time already paid for — not, as first drafted, left running.

`retention-disclosure.test.ts` binds the published sentence to `periods.ts`. Verified by planting the drift it exists to catch: a published ninety days against an enforced sixty, a period on the page that no sweep implements, and the word "automatically" attached to the financial class.

**Still not proved:** that the job fires. Everything above is structure. The first real evidence is tomorrow morning's run — which will delete nothing, because the first eligible row is dated 2026-11-17.
