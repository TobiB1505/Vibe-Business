# Wave 3 — reliability & observability

**Recorded 2026-08-27, after the work.** Ten findings from the [launch-readiness audit](../audits/2026-08-26-launch-readiness/README.md)'s Wave 3: *"reliability & observability"*. Eight closed, one partly, one blocked on a decision that is not an engineer's to make. No migrations — every change here is application code and documentation.

## What was wrong

Waves 0, 1 and 2 made deletion possible, closed the security block, and fixed the database. Wave 3 is about what happens **after** something goes wrong — whether anybody finds out, and whether the product can be steered while it is happening.

Read together, the ten findings describe a product that detects a great deal and reports almost none of it.

## What changed

### Nothing was watching (VB-012, VB-021, VB-034)

**VB-012** is the one that reframes the others. Balance drift, a lot whose materialized capacity disagrees with its allocation rows, an operation nothing is carrying, a Stripe webhook that failed to process, a burst of refusals at the agent gateway — every one of those conditions was **already detected**, with good context, by code somebody wrote carefully. Each ended in a `console.error`.

On Vercel that is a line in a log stream nobody is watching, which is indistinguishable from not detecting it at all. `alertOperator` sends the same message and context to Sentry, so each becomes an issue with a count and a first/last seen: something an alert rule can be built on, and something that pages on first occurrence by default. The local log stays primary rather than becoming a fallback.

Gateway refusals are the one warning rather than error, and the one call not awaited. A single refusal is ordinary — a revoked token, an expired run — and the *burst* is the signal, which is a frequency read off the issue's own count.

**VB-021.** Three Sentry inits set `sendDefaultPii: false` and nothing else. That stops Sentry *adding* identifying data; it does nothing about what an exception already carries — a `fetch` error stringifies the URL it was called with, a Server Action failure arrives with the form data that caused it, a request context carries the session cookie.

Dropping beats redacting where dropping is possible, so request bodies, cookies, auth headers and query strings go entirely; a pattern list is a guess about strings and wholesale removal is not. What cannot be dropped — a message, a stack frame — is redacted instead, which is deliberately the last layer rather than the only one. It **fails closed**: a scrubbing failure drops the event.

**VB-034.** No liveness endpoint, so the first signal of an outage was a customer. `GET /api/health` returns status, the short commit and the tier, built from a type rather than an object literal so adding a field is a diff a reviewer sees.

### Nothing could be steered (VB-032)

`PAID_OPERATIONS_DISABLED=1` refuses new paid starts at `createOperationRun` — the same single funnel VB-008's limit uses, so it covers the start path nobody has written yet. Before it, stopping the spend during a provider incident meant a code change and a deploy.

### Things that could hang or wedge forever (VB-014, VB-031)

**VB-031.** `fetch` has no default timeout and neither Octokit nor either Supabase client added one, so a connection that is accepted and then goes quiet occupied the caller until a Workflow step ceiling or a page render gave up. The retry that comes with the deadline covers `GET` and `HEAD` only, decided from the method rather than from a caller's intent — the consequential GitHub calls create branches, push commits and fast-forward a default branch.

**VB-014.** The staleness deadline map was `Partial` and **eleven of the fifteen operation types were absent from it**. A workflow that died carrying a product scan, a validation, a preview, a review, a merge or a measurement left its operation `running` forever — and because `operation_runs` carries a partial unique index on the active state, forever also meant the customer could never start that work again. Nothing was billed and nothing was broken; the feature was simply gone for that project, permanently, with the UI still showing a spinner.

### Money that was stuck, and bytes that outstayed (VB-020, VB-004)

**VB-020.** Completing an operation and finalizing its billing are two writes, and a crash between them leaves the operation terminal with its reservation still `active`. The customer sees Credits they cannot spend and no reason why. Until now the only thing that could notice was a SQL query in a deployment checklist.

**VB-004.** `REVIEW_POLICY.retentionMs` has been seven days since Sprint 11A, and the deadline was honoured everywhere it was *read* — an expired artifact never mints a signed URL, is never reused, cannot back an approval. What never happened is the deletion. Images of a customer's product stayed in the bucket indefinitely, past a retention period the product had declared to itself.

### The ordering nobody had written down (VB-039)

Merging to `main` deploys code within minutes and changes no schema; a migration is a separate deliberate act. Nothing said which goes first, so the failure mode was a merge whose code reads a column the database does not have.

## What the work found that the findings did not say

- **Account erasure had no staleness sweep at all, and could not have had one.** `getProjectOperationRunById` refuses a row whose `project_id` is null — which is exactly and only the account-level operations [ADR 0057](../decisions/0057-account-level-durable-operations.md) introduced. So erasure, the one family where being wedged means **a person cannot delete their account**, was the one family the sweep could not see, and `startAccountErasure` answers every later attempt "already running" off that same index. The operation type postdates the audit, which is why the finding does not name it.
- **A test that tested nothing.** The first version of VB-020's "never takes the billing page down" test injected a write failure into `audit_events` — and `recordAuditEvent` swallows its own errors, so it passed with the `catch` removed. The read is the failure that propagates. `FakeDatabase` gained a read-failure hook so it could be injected at all.
- **`server.test.ts` asserted a function's *name*.** It checked that the installed Supabase `fetch` was called `fetchWithJwtClockSkewRetry` — a proxy for "the retry is installed" that stopped being one the moment a second wrapper went around it. A correct composition failed it. It now asserts the behaviour of both layers and their order.
- **`review_artifacts_ready_has_both_sides` decides how retention can work.** A `ready` artifact must carry both object paths, so the sweep cannot mark a row as purged without either violating the check or rewriting the status into something the review never was. The row is left alone and re-removal is relied on being idempotent.

## What was not done, and why

- **VB-033 — blocked, and on two separate things.** The aggregate spend view wants a periodic sweep of the ledger with thresholds, which is a background technology this product has not decided to have; [rule 24](../../CLAUDE.md) says an ADR, not an import. On top of that, its "per-user/day ceiling" is a product decision about what a customer is allowed to spend, which is not an engineering call. Neither half was invented here.
- **VB-012's other half.** The Sentry *rules* live in the Sentry dashboard, not in this repository. What landed is the half that makes a rule possible — the events now exist as issues. Nobody has configured a rule.
- **VB-020 reports and does not repair.** What is owed differs by how the operation ended: a failed or cancelled one delivered nothing, so a release is unambiguous, but a completed one delivered the work, so what was abandoned was a *settlement* — and settling needs the usage the crashed path was holding, which the detector cannot reconstruct. Releasing instead would refund work the customer received. The repair keeps its own authority model, the way [ADR 0042](../decisions/0042-billing-reconciliation-authority.md) §P3 derived one for materialization and lot drift rather than assuming it.
- **VB-004 leaves one case open.** A project that runs one review and never another keeps those bytes until the project or account is deleted — which does sweep the whole prefix, since Wave 0 built that. Retention is enforced for any project still in use and bounded by deletion for one that is not; closing the rest needs the same scheduled sweep VB-033 is blocked on.
- **VB-039's CI gate, assessed and declined.** A job that runs `db push` on merge would remove the ordering problem entirely, and it would need a credential able to rewrite the production schema, held by CI, usable by anything that can trigger a workflow — strictly more authority than the service-role key [rule 53](../../CLAUDE.md) already confines to one directory. A read-only job that *verifies* local migrations are present remotely would catch the same skew without holding the power to cause it. That is the shape worth building and it is not built.
- **The health endpoint does not ping the database.** Since VB-015 the `anon` role holds no privilege on any table, so a reachability check would need the service-role client behind an unauthenticated public route — precisely the blast radius rule 53 bounds. Monitoring convenience is not the argument that should widen it.

## What has not been proved

- **No alert has ever fired.** `alertOperator` is asserted against a mocked Sentry and has never been observed producing an issue in a real project, let alone paging anybody. The wiring is tested; the delivery is not.
- **The scrubber has never scrubbed a real event.** Its inputs in the tests are hand-built objects shaped like Sentry events, not events Sentry actually produced.
- **The deadlines are chosen, not measured.** Fifteen seconds for a Supabase call and for a GitHub call are far above healthy and far below any ceiling they sit inside. No fault injection has been run against a real hanging host.
- **`/api/health` has not been called over HTTP.** Its shape and its exclusion from the session proxy are asserted; a request to the deployed route is not.
- **The restore drill still has not been run**, which the new runbook says in its own words rather than implying a capability.
- **No dogfood.** Nothing here was exercised against a real incident, a real provider outage or a real stuck hold.

## Validation

Measured on the branch head:

| check | result |
| --- | --- |
| Unit tests | 6885 passed, 401 files (was 6875) |
| Browser tests | 366 passed |
| Migration tests (real PostgreSQL) | 147 passed, 9 files — unchanged, since this wave ships no migration |
| `pnpm typecheck` | clean |
| `pnpm lint` | 19 warnings, 0 errors — the baseline `main` already carried |
| `pnpm build` | clean |

Every guard added here was checked by breaking what it guards: the Sentry wiring assertion fails with `beforeSend` removed from one of three runtimes, the health route's proxy exclusion fails with `api/health` removed from the matcher, the kill switch's funnel test fails with the check disabled, the deadline assertions fail with the wrapper unwound, and the retention sweep's tenant and expiry filters each fail when removed.
