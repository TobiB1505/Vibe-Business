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
once the suite was green twice, and the final trigger is `pull_request` on the
billing, operations, migration and configuration paths, plus `workflow_dispatch`
for when it reaches the default branch.
