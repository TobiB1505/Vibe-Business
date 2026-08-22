# E2 — REAL POSTGRES CONCURRENCY — what could not be run, and what was found instead

**Status: implemented, not merged. The sprint's central goal was not reached.** No migration. No pricing change, no new dependency, no AI call, no money spent — including no Supabase cost, because the environment E2 depends on could not be created. `CREDIT_RATE_CARDS` is still `[]`.

## What E2 was for

[E1](0057-e1-ledger-hold-correctness.md) closed its record with a boundary it named deliberately: *"application-level financial races reproduced and fixed", not "correct under real PostgreSQL concurrency"*. Eleven defects were reproduced against `FakeDatabase`, which models statement atomicity honestly and does not serialize the sequences around it — so it reaches lost updates faithfully and cannot reach MVCC, real row locks, or real arrival order.

E2 was to run the same invariants against real PostgreSQL through the real access path, in an isolated disposable environment, and to reconstruct the 20-way concurrency scenario that `contention.ts` cites but no committed test contains.

**That run did not happen.** The reasons are infrastructure, they were established rather than assumed, and they are recorded below in full so the next attempt starts from evidence rather than from this plan again.

## Why the environment could not be created

Three candidate environments, in the order they were tried.

### 1. A Supabase preview branch — refused by plan

The authorized approach. Cost was confirmed first at **$0.01344/hour**, the project ref was derived from `NEXT_PUBLIC_SUPABASE_URL` rather than remembered (`dcbwlctscooefwnivxzv`, name `Vibe-Business`, PostgreSQL 17.6.1.155, region `eu-north-1`), and the organization was read back before the call. Creation was refused:

```
PaymentRequiredException: Branching is supported only on the Pro plan or above
```

The organization `Vibe-Business` is on the **free** plan, and it holds exactly one project. Nothing was created and nothing was billed — note that `get_cost` returns an hourly price regardless of whether the plan permits the branch, so the quoted figure was not a signal that it would work.

### 2. A local Supabase stack — blocked by egress policy

`supabase/config.toml` already pins `major_version = 17`, matching production, and no `supabase/.temp` exists, so the CLI is linked to no remote project and `supabase start` is unambiguously local. PostgreSQL 16 is installed natively in this environment and the Docker daemon, which an earlier analysis recorded as unavailable, started without incident.

`supabase start` then failed on every image layer:

```
gateway answered 403 to CONNECT (policy denial or upstream failure)
  production.cloudfront.docker.com:443
  pkg-containers.githubusercontent.com:443
```

Both hosts are denied by this session's egress policy, as is `github.com` for a direct PostgREST release download. Package registries (`registry.npmjs.org`, `pypi.org`) are reachable, but PostgREST is a Haskell binary distributed as a container image or a GitHub release, and neither host is permitted. The partial stack was torn down and the daemon stopped.

### 3. Production — refused on instruction, and it would not have been valid anyway

Not attempted. The race matrix creates deliberately conflicting financial writes, the ledger is append-only by design so there is no cleanup that is not itself a contradiction, and production is where the only customer-shaped financial data lives. The instruction for this sprint was explicit that a failure to reach an isolated environment is a **stop**, not a fallback, and the plan committed to the same thing before the first attempt.

### What a `pg` driver would and would not have bought

A direct Postgres connection would have made a local run possible. It was excluded deliberately, and the reason survives the blocker: the production path is `@supabase/supabase-js → PostgREST → PostgreSQL`, `admitHold` uses compare-and-swap **because** PostgREST can express neither a column-relative update nor a multi-statement transaction, and a proof over a connection the application never opens would be a proof about different code. Introducing one to unblock this sprint would have replaced a missing result with a misleading one.

## What was found instead

The sprint was not empty. Two defects were reproduced against the real database — both financial, both pre-existing, both now fixed — and one untested constant now has a test.

### `pnpm billing:dogfood` was broken in two independent ways

It is the only thing in this repository that runs the billing projection against real data, and it had been failing since agentic execution first ran.

**Cache tokens were priced on one side of the reconciliation only.** `ai/usage.ts` passes `cacheReadInputTokens` and `cacheCreationInputTokens` into `calculateProviderCost` and stores the result in `provider_cost_usd`. `credits/projection.ts` re-priced the same row from input and output alone. Every agent turn therefore disagreed with its own ledger row by the whole cache bill, and `reconcileAiUsage` reported each disagreement as a §69 semantic mismatch — which is exactly what a §69 mismatch means.

Measured against the live ledger before the fix, and the numbers are not a coincidence:

```
total AI usage rows                314
rows carrying cache tokens         234
rows with a stored cost            302
costed rows carrying cache         234
reported cost mismatches           234
```

One example disagreed by more than five times: `$0.001454` recomputed against `$0.008380` stored. `ECONOMY_MODEL.md` had already measured cache at 55–70% of agent provider cost, so the size is the size that was predicted.

This was recorded as a known gap in `docs/ROADMAP.md` before the sprint. What the roadmap did not say, and what running the probe showed, is that the gap was not merely a reporting omission — it was actively failing the only real-data check in the repository.

**The shadow-mode invariant asserted the wrong thing.** The probe asserted `billing_credit_accounts` and `billing_credit_ledger` were *globally* empty. That was true when Core-1 shipped and stopped being true the moment Core-2 wired Credits into the operation start paths; against the live database it found 2 accounts and 51 ledger entries. The probe was asserting something about the product's history rather than about itself.

It was repaired by replacing the invariant, not by removing it: the financial picture — account, ledger and reservation counts *and* the summed posted and reserved balances — is captured before the first `reconcileUsage` and compared after. Counts alone would miss a run that moved credits in place; balances alone would miss an offsetting pair. It is also stronger than the old assertion in one direction, because it catches a probe that removes rows.

`pnpm billing:dogfood` now passes, 3 of 3, against the real database.

### The cache **SKU** stays open, and the reason changed

`credits/schema.ts` had explained the absent `anthropic_cache_read_tokens` SKU with a reason that this sprint made false — that nothing priced cache, so metering it would meter something nothing charges for. Pricing exists now. What remains is narrower and is a genuine absence rather than a decision: the *quantity* is unmetered, and adding it means widening the `billing_usage_events.sku` CHECK constraint, so it is a migration rather than a comment's decision. It becomes chargeable behaviour rather than reporting detail the moment a Credit rate card exists, because `rating.ts` rates per SKU quantity. `CREDIT_RATE_CARDS` is empty, so nothing is mischarged today.

### `CONTENTION_ATTEMPTS` has a test, and the test says how much it pins

`contention.ts` records that the constant was found too low at 3 by the PR #46 stress test — 20 concurrent 100-credit requests against an exact 1000-credit balance admitted 8 of a correct 10. That test was never committed, and the roadmap named the consequence: nothing would fail if the number went back to 3.

The scenario is now committed against `FakeDatabase`, and it was measured against four values of the constant rather than assumed to bite:

```
 1 attempt    1 of 10 fundable callers admitted   FAILS
 2 attempts   10 admitted                         passes
 3 attempts   10 admitted                         passes
10 attempts   10 admitted                         passes, 12 consecutive runs
```

**So it proves the retry loop is load-bearing and does not pin the number ten.** Remove the loop and nineteen funded callers are refused; lower it to 3 and nothing fails, because the fake converges in fewer rounds than a real network does. That is the precise shape of what is still missing, and the test file says it in place of implying otherwise. The value ten is held separately by an explicit assertion, labelled as record-keeping rather than measurement.

Safety is asserted alongside liveness — `reserved` equal to the admissions actually made, `available >= 0` — so that a change chasing liveness cannot buy it by overspending, and the assertions read persisted rows (ten distinct active reservations of 100 each) rather than return values.

## Two structural claims, now verified against the live schema

E2 could not run concurrency, but it could read. Both of these were previously arguments from migration text; they are now observations.

**The unique index E1 added is structurally what it claims to be.** E1 asserted it by string-matching migration SQL. Read back from `pg_index` on the live database:

| index | unique | columns |
|---|---|---|
| `billing_credit_allocations_reservation_lot_idx` | **true** | `(reservation_id, grant_id)` |

Existence, uniqueness and column order, in that order. No `EXPLAIN` assertion was added: whether the planner chooses an index on tiny fixtures is not a property worth pinning.

**The deadlock argument's premises hold, on the paths examined.** Every `billing_*` table carries exactly one non-internal trigger, all of them `set_updated_at BEFORE UPDATE ... FOR EACH ROW`, and the function body reads `new.updated_at = now(); return new;` — it writes its own row and touches no other table, so no additional lock is taken. `billing_credit_allocations` references `billing_credit_grants` `ON DELETE RESTRICT`, `billing_credit_accounts` `ON DELETE CASCADE`, and `billing_credit_reservations` `ON DELETE RESTRICT`; an INSERT takes `FOR KEY SHARE` on the referenced rows while `takeFromLot` updates a non-key column under `FOR NO KEY UPDATE`, and those do not conflict. `compareSpendOrder` is a total order — expiry, then grant time, then id — so two concurrent allocations acquire lot locks in the same sequence.

**This is a statement about these paths, not about the database.** It says a deadlock is not reachable through the allocation and settlement code as written; it does not say the schema cannot deadlock. A real-database run would still be the thing that observes it rather than argues it.

## What E2 did not prove

Everything it was for.

- Nothing here was run under real MVCC, real row locks, or real request arrival order.
- No lost update, hold race, allocation race or settlement race was reproduced against PostgreSQL.
- `23505` was never raised by PostgreSQL against the new index; only the index's structure was read.
- The 20-way liveness scenario pins the presence of the retry loop, not the value `CONTENTION_ATTEMPTS = 10`.
- Nothing changed about CI: probes hold real credentials, CI holds none, and neither the dogfood nor any future concurrency suite can run there.

The deferred items are unchanged and were not touched: the stale-hold sweeper, the lease/reconciliation model, and any drift repairer. Nothing found here argued that one of them is required for correctness.

## What the next attempt needs

One of these, and it is a decision rather than a task:

1. **The Supabase organization on Pro**, which makes the preview-branch plan work exactly as written — including the target guard that refuses the production ref by identity on every run.
2. **An egress allowance for a container registry** (`production.cloudfront.docker.com`, `pkg-containers.githubusercontent.com`), which makes `supabase start` work locally at no cost, on a config that already pins PostgreSQL 17.
3. **CI with a Postgres service container and a PostgREST container**, which is the only one of the three that would also make the suite a regression gate rather than something someone must remember to run.

The race matrix itself (R1–R11), the harness design, the target guard and the invariant reader are specified in the plan this sprint was written from and did not change; only the environment did.

## Commits

```
611920e  Price cache tokens the way the AI ledger already prices them
c2e12bd  Make the dogfood assert what shadow mode claims, not that the database is empty
143b59b  Give CONTENTION_ATTEMPTS a test, and say how much of it that pins
```
