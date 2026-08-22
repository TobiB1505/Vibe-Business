# E2b — CI-HOSTED REAL POSTGRES CONCURRENCY — the races run, in CI, for the first time

**Status: implemented, not merged.** No migration. No pricing change, no new dependency, no AI call, no money spent — and no Supabase cost, because the database this runs against is a disposable local stack on a GitHub runner. `CREDIT_RATE_CARDS` is still `[]`.

## What E2a could not do, and why this could

[E2a](0057-e2-real-postgres-concurrency.md) said so in its own status line: *the sprint's central goal was not reached.* Three environments were refused — a preview branch needs a Pro plan, `supabase start` could not pull images through the agent session's egress policy, and production is not a valid target for a matrix that writes conflicting rows into an append-only ledger.

A GitHub-hosted runner has none of those constraints. It has Docker, it has no egress policy of ours, and the stack it starts is deleted when the job ends. Everything else about the design is unchanged from what E2a specified, including the refusal to introduce a PostgreSQL driver: the production path is `@supabase/supabase-js → PostgREST → PostgreSQL`, `admitHold` compare-and-swaps *because* PostgREST can express neither a column-relative update nor a multi-statement transaction, and a proof over a connection the application never opens would be a proof about different code.

**So this is the first time a Vibe billing race has run under real PostgreSQL MVCC.**

## The three evidence layers, kept apart

| Layer | What it is | What it cannot be |
|---|---|---|
| **E1** | Deterministic race evidence against `FakeDatabase`. Eleven defects observed red, then fixed. | Not MVCC. The fake models statement atomicity and does not serialize the sequences around it. |
| **E2a** | Real-schema and infrastructure evidence. Two financial defects reproduced against the deployed database and fixed; index and trigger structure read from `pg_index` and `pg_trigger`. | Not a race. Nothing ran concurrently. |
| **E2b** | Real concurrent PostgreSQL/PostgREST evidence, in CI, repeatable. | Not the deployed topology — see *What this still does not prove*. |

## The assumption that had to be checked first

The 54 migrations contain **no `GRANT`**. The deployed project's billing tables are reachable through PostgREST because of Postgres default privileges the platform applied, not because this repository says so. Supabase is moving that default to *revoke*, and `auto_expose_new_tables` — the local switch that reproduces the old behaviour — is itself removed on **2026-10-30**.

[ADR 0040](../decisions/0040-ci-hosted-database-concurrency-gate.md) set it as local parity and committed to stopping rather than adding a GRANT migration if it turned out to be wrong. The workflow queries the data API before any race runs, precisely so the answer is a diagnosis rather than twenty failing assertions:

```
HTTP 200   billing_credit_accounts?select=id&limit=1
```

**The assumption held.** No `42501`, no migration, no opportunistic fix. The underlying gap — that a newly provisioned database should derive its PostgREST rights from versioned repository configuration under a deliberate least-privilege decision — is a `docs/ROADMAP.md` entry and stays open.

## Two runs, and what each one bought

### Run #1 — `cf010db` — red, and the defect was the test's

Three classes passed on the first attempt. The fourth reported `expected 300000 to be 100000` twice.

The diagnosis came from the code rather than from adjusting the expectation. `settleReservation` and `releaseReservation` in `service.ts` own the **account** — the ledger entry and the reservation row — and never touch `billing_credit_allocations`. Lots belong to `operation-billing.ts`, one layer up, which settles the allocations and *then* calls into `service.ts`. The observed `300000` was correct: `settleOperationCredits` settles at the full reserved amount, so a fixed-price hold has nothing to hand back.

So class D was rewritten to drive `settleOperationCredits` and `releaseOperationCredits`, which is what production calls. That made the E1 double-return defect unreachable through that path — nothing comes back, so nothing can come back twice — and a third scenario was added at `settleReservationAllocations`, the only place a hold settles for less than it reserved and therefore the only place that defect lives.

The same run would have hit a second problem immediately afterwards. Deleting the fixture's auth user does **not** clean up by cascade: `billing_credit_allocations` references grants and reservations `ON DELETE RESTRICT`, and a cascade reaching a grant while an allocation still points at it raises `23503` in an order PostgreSQL does not promise to avoid. Teardown now deletes allocations first, explicitly, and checks what it removed rather than assuming.

### Run #2 — `5646e53` — green

```
Test Files  5 passed (5)
     Tests  12 passed (12)
  Duration  38.07s
```

| Class | Result |
|---|---|
| **A** — 20 concurrent holds against a balance funding exactly 10 | 10 admitted, 10 refused, **every one of 20 iterations**. Race wall-clock min 121 ms, max 222 ms, mean 147 ms |
| **B** — 10 concurrent ledger posts; 5 releases against 5 admissions | no lost delta on either materialised column, 20 iterations each |
| **C** — 2 concurrent allocations of one reservation | **SQLSTATE reaching the client path: `23505`**; exactly 1 allocation row persisted, 20 iterations |
| **D** — settle ‖ release, settle ‖ settle, partial ‖ partial | one charge, one terminal state, capacity moved once, 20 iterations each |

Class A is the scenario `contention.ts` has cited since PR #46 and that no committed test contained. It is now committed, and it ran against real MVCC.

Class C is what E1 could only assert as a string in a migration file and E2a could only read back from the deployed database's catalogue. PostgreSQL itself refused the duplicate, the code reached the client path, and one row survived every time.

### Run #3 — `59fa9d8` — green

The same twelve tests, after class D gained an assertion that the money agrees with itself whatever the reservation status says: a charge implies the ledger and the lot both show the same 300, and no charge implies neither does. Green, 2 m 46 s, `supabase start` 83 s. Three runs, two configurations of the suite, and the only red one was red for a defect in the test.

## A finding: one race is not rare, it is deterministic

Class D counts terminal-state combinations rather than asserting a truth table, because E1's answer to a charge whose hold was released was to make `settleReservation` **report** it as `charge_without_hold` rather than to prevent it. Asserting a rule the domain does not hold would be writing new business logic inside a concurrency test.

The count says something the counting was meant to find out:

```
D — 20 iterations of settle ‖ release
  released/charges=1/allocated=300000: 20
```

**Twenty of twenty.** When `settleOperationCredits` races `releaseOperationCredits` on one reservation, the outcome is not occasionally the `charge_without_hold` state — it is always that state. The reason is structural rather than lucky: settle does strictly more work before its close (settle the allocations, read the reservation, look for an existing charge, post the charge) than release does (release the allocations, read the reservation), so release reaches `closeReservation` first every time and settle's charge lands beside a hold already marked released.

Three things this is **not**:

- **Not a money defect.** The charge, the ledger and the lot all agree on the same 300; the assertion added after this run checks exactly that, in both directions. What disagrees is the reservation's *status*.
- **Not proof of a production defect.** An operation either completes or fails; nothing in the current lifecycle calls both entry points for one reservation concurrently. The race is synthetic.
- **Not something E2b fixes.** Preventing it means deciding which of the two callers wins, and that is a domain decision with an ADR-sized argument behind it, not a change to make inside a concurrency sprint.

It is recorded in `docs/ROADMAP.md` as what it is: if those two paths ever *do* become concurrently reachable, the result is deterministic and it charges a customer against a hold marked cancelled.

## What the gate costs

Run #2, end to end: **2 minutes 45 seconds**; run #3, **2 minutes 46 seconds**.

```
checkout, pnpm, node, install       26s   (pnpm cache hit)
supabase start (4 containers)       81s
point the harness at the stack       1s
verify the data API                 <1s
race matrix, 4 classes × 20         39s
supabase stop --no-backup           14s
```

E2a's plan estimated 7–10 minutes and named `supabase start` as the dominant, least predictable term. It is dominant and it was **81 seconds on both runs** — the estimate was roughly three times too high, and the honest reason is that it was a guess where the plan said it was a guess.

The gate runs on pull requests touching `src/modules/credits/**`, `src/modules/operations/**`, `supabase/migrations/**`, `supabase/config.toml` and its own configuration, and on demand. Not on every change: a UI edit cannot make a billing race fail.

## Secrets

**None.** The job is granted no repository secret. Its credentials are the local stack's own, read from the CLI by its default variable names, masked before they enter the environment, and mapped onto names only this harness reads.

The target guard is structural rather than a policy. It requires loopback, refuses the deployed project ref by name, and refuses a key equal to the application's own — and because it reads `CONCURRENCY_SUPABASE_URL` and `CONCURRENCY_SERVICE_ROLE_KEY` and never the application's variables, adding a secret to this workflow later would not make the deployed database reachable. Twelve assertions in `harness.test.ts` pin that, in `pnpm test`, where CI sees them on every change — including one that no refusal message ever repeats the value it refused.

`configured.concurrency.ts` is deliberately not skippable. Every other file is wrapped in `describe.skipIf`, which is what lets them be collected without a database and which would otherwise let a misconfigured job go green having tested nothing.

## The permitted claim

> For the four named race classes, over 20 iterations each, run against PostgreSQL 17 through PostgREST over HTTP with the application's own billing code and a schema built from this repository's own migrations, every persisted invariant held. Safety and liveness are reported separately.

Any wider sentence is wrong. It is four classes, twenty iterations, one local topology.

## What this still does not prove

- **Not the deployed topology.** The local stack runs no Supavisor (`[db.pooler] enabled = false`); hosted Supabase puts PostgREST behind its own pooling, so connection and queueing behaviour under load differ. There is no network latency either, which compresses arrival order — that makes contention *more* aggressive locally, so it is good at finding races and bad at predicting production timing.
- **Not rare races.** A race of probability *p* is missed by *n* attempts with (1 − *p*)ⁿ. Twenty iterations miss a 15% race 3.9% of the time and a 5% race 36% of the time. Repetition raises the chance of observing a defect; it never proves absence.
- **Not `CONTENTION_ATTEMPTS = 10`.** The value was not changed and is not shown to be minimal. How many compare-and-swap rounds a caller needed is not observable from outside `admitHold`, and instrumenting the function under test would change it, so the suite reports the race's wall-clock instead and says that is what it is.
- **Not `40001` or `40P01`.** Both remain unreachable by construction on these paths; E2a verified the premises against the live schema. No artificial test was built to provoke them, and the harness's classifier names them anyway, because proving something unreachable and refusing to notice it are different things.
- **Not production data volumes.** Fixtures are synthetic and small.
- **Not universal coverage.** The gate is path-filtered. A change outside those paths that would break it is not caught — a stated limit, not an oversight.

The deferred items are untouched and nothing here argued for them: the stale-hold sweeper, the lease/reconciliation model, and any drift repairer.

## Verification found two real defects; the fixes below are corrective work it triggered

Everything above this section is what the original two runs closed. What follows did not happen as planned work — it happened because the record above was checked rather than trusted, and the check found two real financial-correctness defects. **This is not part of the original E1 fix set the seven commits above closed; it is corrective work the E2b verification pass triggered, done under E2b because the proof it needed was the same real-PostgreSQL gate.**

The question asked was concrete: is a concurrent `settleOperationCredits`/`releaseOperationCredits` race on the same reservation structurally unreachable in production, or does class D's "nothing today calls both paths concurrently" line actually hold? Enumerating every caller answered it. It does not hold.

### Defect A — no billing authority above the primitives, for agent execution

`finishAgentExecutionStep` (the durable workflow) and `expireStaleAgentExecution` (the request-time staleness backstop `getAgentExecutionStatus` calls on every poll) both read `agent_execution_runs.status` and called into settlement or release without checking whether they had won anything. Both are real, both run concurrently in production — the workflow durably in the background, the backstop from whichever browser tab happens to poll the run page — and nothing prevented exactly the `charge_without_hold` state class D demonstrated at the primitive level.

The fix needed no new mechanism. `completeAgentRun` and `failAgentRun` were already compare-and-swap on `agent_execution_runs.status` and already returned whether they won; the boolean was simply never checked. `78b1888` makes both callers return immediately on losing that swap, before either reaches billing — the same pattern the three deterministic operation families already use on `operation_runs.status`. It is deliberately narrow: it decides who may finalize the money, not whether the 40-minute-plus-grace staleness deadline is itself a correct liveness signal. A run genuinely still working past that deadline still gets failed by a wrong-but-uncontested expiry; that is the pre-existing, still-open lease/liveness gap in `docs/ROADMAP.md`, unchanged by this fix and not silently resolved by it.

Proof, in two layers:

- **Unit/fake** (`billing-authority.test.ts`, `78b1888`): drives the real callers — not the raw primitives again, which would only re-prove the symptom — against `FakeDatabase`. Three of four assertions were red before the fix, confirming the defect; all four green after.
- **Real PostgreSQL** (`agent-finalization.concurrency.ts`, class E): three scenarios, 20 iterations each — both actors racing with whoever is due, the workflow winning deterministically when the expiry is not yet due, and the expiry winning deterministically with the late workflow arriving after. Every iteration: exactly one agent-run terminal transition, exactly one billing terminal effect, the `charges === 1 && reservationStatus === "released"` combination asserted impossible rather than counted, and the hold closed either way. Getting this to run at all took six more CI round-trips (the corrective commits below) — every one of them a real fact about the schema (an invalid `stage` value, two more 64-character identity columns, `ON DELETE RESTRICT`/`CASCADE` ordering, the `execution_specs` immutability trigger reaching through a cascade, and a zero-padding collision between iterations 1 and 10 in the fixture's own identity helper) rather than a flaw in the fix itself, which was green against the fake on the very first attempt and never changed after `78b1888`.

### Defect B — a failed start leaked its hold, deterministically

`startAgentExecution` takes the Credit hold before calling `executor.start()` — money before work — and its own comment already said the hold would be released if that call refused. The code never did it. Not a race: the run row this path claims stays `queued` forever, `expireStaleAgentExecution` ignores `queued` by design (a run that has not been picked up yet cannot safely be declared dead), and there is no reservation sweeper. Every failed start suppressed capacity the customer could spend for as long as the account existed.

`2d99764` calls the same `releaseOperationBilling` the adjacent `agent_reservation_invalid` branch already used — reusing the existing guard-on-active-reservation primitive rather than adding a new one.

Proof, in two layers:

- **Unit/fake** (`service.test.ts`, `2d99764`): a `FakeExecutor({ fail: true })` drives `startAgentExecution` through the real `!started.ok` branch and asserts the persisted end state — reservation inactive, zero reserved credits, posted credits unchanged, zero charge-kind ledger rows, zero lot capacity still allocated, operation failed.
- **Real PostgreSQL** (`agent-start-failure.concurrency.ts`, `c37304c`): the same refusing executor against a real database, 20 iterations, each asserting the operation lands `failed`, the reservation reads `released`, no charge posts, and every lot on the account reads back to zero allocated. Each iteration needs its own execution spec — the branch under test fails the *operation* without touching the `agent_execution_runs` row `claimAgentExecutionRunRow` wrote moments earlier, which stays `queued`, one of the statuses the run-identity uniqueness index still treats as live — so a shared spec would make every iteration after the first see a live run and return `"running"` instead of exercising the failure. Building that fixture is what surfaced the zero-padding collision named above, in the one shared `identity64` helper every class in this suite uses; `c37304c` fixed it at the shared function.

### What this closes, and what it deliberately still does not

Closed: for agent execution specifically, a concurrent settle/release race on one reservation is no longer reachable through the two callers named above, proven under real MVCC in both winner directions, and a failed start no longer strands its hold, proven the same way.

Still open, unchanged by this work: whether `started_at` + the sandbox limit + a grace window is the *right* way to decide a run is stale (the lease/liveness gap in `docs/ROADMAP.md`); that `settleOperationCredits` and `releaseOperationCredits` are mutually exclusive as primitives — they are not, and class D's finding stands; and that any future caller pair reaching both of those primitives concurrently for one reservation is safe — each needs the same kind of upstream authority established for it explicitly, nothing enforces it structurally.

## Commits

```
3a12944  docs(repo): record the ci database concurrency decision
aaae4ac  build(repo): expose public tables to data api roles in local config
ac3bb7d  test(billing): add the real-postgres concurrency harness
a18c1aa  ci(billing): add the concurrency gate as a manual workflow
2c0a48e  test(billing): prove hold safety and liveness under real contention
6873475  test(billing): prove no lost updates on materialized balances
bddd2f3  test(billing): prove the allocation unique index under real conflict
cf010db  test(billing): prove settle and release leave one terminal state
5646e53  fix(billing): drive settlement races through the layer that owns lots
59fa9d8  ci(billing): run the concurrency gate on billing and migration paths
```

The gate was brought up on a branch-scoped push trigger, because
`workflow_dispatch` is unreachable until a workflow file is on the default
branch and this branch has no pull request — so without it there would have
been no way to execute a change to the gate before shipping it. It was removed
once the suite was green twice, and the final trigger was `pull_request` on the
billing, operations, migration and configuration paths, plus `workflow_dispatch`
for when it reaches the default branch.

### Corrective commits (Defect A, Defect B) and their CI runs

The push trigger above was reinstated for exactly this work — the two fixes
needed a real-database run and the branch still had no pull request — and
removed again once green.

```
78b1888  fix(agent): make the run-status swap the only billing authority
2d99764  fix(agent): release the hold when a run never starts
2113221  test(billing): race the workflow finalizer against the stale-run expiry
           run #4   FAILED — fixture: invalid operation_runs.stage value
bee0113  fix(billing): correct D's over-strong claim, fix E's fixture stage
           run #5   FAILED — fixture: operation_runs.input_identity not 64 chars
ccc6bb3  fix(billing): pad the fixture's other two 64-char identities
           run #6   FAILED — teardown: RESTRICT/CASCADE ordering hazard, 23503
e11f2cd  fix(billing): delete the scaffolding in an FK-safe order before teardown
           run #7   FAILED — teardown: execution_specs immutability trigger, 23001
5f92b6d  fix(credits): stop the class E teardown from fighting an immutable table
           run #8   GREEN — class E: 15/15
b4b1589  test(credits): prove Defect B's release against real PostgreSQL
           run #9   FAILED — fixture: identity64 zero-pad collision, 23505
c37304c  fix(credits): stop the shared identity helper colliding on padding
           run #10  GREEN — classes A–E plus Defect B: 16/16
```

Every failure after `78b1888`/`2d99764` was in the harness or the fixture,
never in the fix under test: the fix's own unit-level proof
(`billing-authority.test.ts`, `service.test.ts`) was green on its first attempt
and was never touched again. Six round-trips bought a working real-database
harness, not a corrected fix.
