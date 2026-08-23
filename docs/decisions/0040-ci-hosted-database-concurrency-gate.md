# 0040 - Where a real-database concurrency test runs, and what it may reach

Status: Accepted

Date: 2026-08-22

> **Second revision, 2026-08-23, the privilege gap closed elsewhere.** The "Local data API parity, and what it is not" section below names a gap this ADR deliberately did not close: that a newly provisioned Vibe database should derive its PostgREST rights from versioned repository configuration rather than a platform default. [ADR 0043](0043-data-api-privilege-model.md) closes it — explicit per-table, per-role grants plus revoked default privileges — and `auto_expose_new_tables` is consequently gone from `supabase/config.toml`, ahead of its 2026-10-30 removal date. The sentence "The 54 migrations contain **no `GRANT`**" below was true when written and is left standing per rule 83; at HEAD the count is higher, function-level grants exist (Sprint B1), and table-level grants now exist too. This ADR's `42501` guardrail is inverted by that change and improved: CI now proves the repository's own grants are sufficient rather than proving a platform default exists.

> **Revision, 2026-08-23, closing part of the "not established" gap this ADR named itself.** This ADR's own "What this decision does not establish" section named a real limit of the path filter — "a change outside these paths that would break it is not caught" — without checking whether the filter's three directories (`src/modules/credits/**`, `src/modules/operations/**`, `src/modules/coding-agent/**`) were actually the full set of production call sites reaching the tested primitives. They were not: `src/modules/billing/webhook-service.ts`'s Stripe-funded `grantCreditLot` calls, `src/modules/billing/overview.ts`'s live `getBillingOverview` repair calls, and two `src/app/app/**` server-action directories calling `ensureWelcomeGrant` all reach `postLedgerEntry`/`reconcileAndRepair*` from outside the filter. §7 and the workflow's own `paths:` list are revised below to include them. This is a widening of an already-accepted filter's boundary, not a reversal of the filtering decision itself — the cost reasoning in Consequences is unchanged, and stays true at the wider boundary. Sixty-iteration confidence (was twenty) and `CONTENTION_ATTEMPTS` round-count observability (was unmeasurable) are recorded as closed in [docs/ROADMAP.md](../ROADMAP.md); local/CI parity with the deployed project's Supavisor and network-latency topology is investigated and found not closable within this suite's own constraints — recorded there, not reopened here.

## Context

Every "database-level financial invariant" test in this repository runs against
`FakeDatabase` — a hand-written re-implementation — or string-matches migration
text. [Sprint 0057 E1](../sprints/0057-e1-ledger-hold-correctness.md) reproduced
eleven financial defects against that fake and named the ceiling in its own
record: the fake models statement atomicity honestly and does not serialize the
sequences around it, so it reaches lost updates faithfully and cannot reach
MVCC, real row locks, or real request arrival order.

[Sprint 0057 E2a](../sprints/0057-e2-real-postgres-concurrency.md) set out to
close that and could not. Three environments were tried and each was refused for
a different reason:

- **A Supabase preview branch** — `PaymentRequiredException: Branching is
  supported only on the Pro plan or above`. The organization is on the free
  plan. Nothing was created and nothing was billed.
- **A local Supabase stack** — `supabase start` could not pull images:
  `production.cloudfront.docker.com` and `pkg-containers.githubusercontent.com`
  are denied by the agent session's egress policy.
- **The production project** — excluded on instruction, and not a valid target
  anyway: the race matrix writes deliberately conflicting rows into an
  append-only ledger, and production is where the only customer-shaped financial
  data lives.

A direct PostgreSQL driver would have unblocked a local run. It was refused, and
the reason outlives the blocker: the production path is
`@supabase/supabase-js → PostgREST → PostgreSQL`, and `admitHold`
compare-and-swaps **because** PostgREST can express neither a column-relative
update nor a multi-statement transaction. A proof over a connection the
application never opens is a proof about different code.

## Decision

**The real-database concurrency suite runs on a GitHub-hosted runner against a
disposable local Supabase stack, and may reach nothing else.**

Concretely:

1. **The stack is local and disposable.** `supabase start` on the runner, using
   this repository's own `supabase/config.toml` (which already pins
   `major_version = 17`, matching the deployed project) and its own 54
   migrations. `supabase stop --no-backup` deletes the volumes afterwards, in a
   step that runs even on failure.

2. **Four containers, not thirteen.** `postgres`, `kong`, `postgrest`,
   `gotrue`. `kong` stays because it is the gateway hop production has;
   `gotrue` stays because `billing_credit_accounts.user_id` references
   `auth.users` and `auth.admin.createUser()` is the way to create a fixture
   user over HTTP rather than through a driver. Everything else is excluded with
   `supabase start -x`.

3. **No secret, of any kind.** The workflow is granted no repository secret.
   The only credentials are the ones the local stack prints from
   `supabase status -o env`.

4. **The target guard is structural, not a policy.** The harness refuses to run
   unless the URL is loopback, refuses if the deployed project ref appears in
   it, and reads its configuration only from harness-specific variable names
   (`CONCURRENCY_SUPABASE_URL`, `CONCURRENCY_SERVICE_ROLE_KEY`). It never falls
   back to `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`. The
   deployed database is therefore unreachable *by construction* — adding a
   secret to this workflow later would not make it reachable.

5. **No new database driver.** No `pg`, no `postgres.js`, no testcontainers. The
   suite drives the application's own billing functions through
   `@supabase/supabase-js`, which is the shape of the thing under test.

6. **Its own file suffix and its own config.** `*.concurrency.ts` under
   `vitest.concurrency.config.mts`, so `pnpm test` cannot collect it and neither
   can `vitest.probe.config.mts` — which sweeps every `*.probe.ts`, including
   the billable AI probes. The same separation `*.canary.ts` already uses.

7. **Introduced on demand, then narrowed to the paths that can break it.**
   `workflow_dispatch` first, because the first run is an experiment with four
   named unknowns. Only after it is green twice does it also run on pull
   requests touching `src/modules/credits/**`, `src/modules/operations/**`,
   `src/modules/coding-agent/**`, `supabase/migrations/**` and its own
   configuration. A UI change does not pay for a container start. **Widened
   once** (see the revision notice above) to also include
   `src/modules/billing/**` and two `src/app/app/**` server-action
   directories, once found to reach the same tested primitives from outside
   the original three.

### Local data API parity, and what it is not

The 54 migrations contain **no `GRANT`**. The deployed project's billing tables
are reachable through PostgREST because of Postgres default privileges —
`public / tables → {postgres, anon, authenticated, service_role} = arwdDxtm` —
which Supabase's platform applied, not this repository.

Supabase is moving that platform default to *revoke* automatic grants, and
`supabase/config.toml` documents the new behaviour: when
`auto_expose_new_tables` is unset, new entities are not auto-exposed. A fresh
local stack would therefore refuse the harness with `42501 permission denied`
while the deployed project works.

**This ADR sets `auto_expose_new_tables = true` as local/CI parity with the
privilege model the deployed project is observed to have today. It is
explicitly not the intended permission architecture.** E2b tests the system as
it currently is; inventing a different privilege model inside a concurrency
sprint would mean the results describe a system that does not exist. The real
gap — that a newly provisioned Vibe database should derive its PostgREST rights
entirely from versioned repository configuration, under a deliberate
least-privilege decision for `anon`, `authenticated` and `service_role` — is
recorded in [docs/ROADMAP.md](../ROADMAP.md) and is not closed here.

The assumption is checked empirically on the first CI run. **If PostgREST
answers `42501` despite the setting, E2b stops and records the finding.** No
`GRANT` migration is slipped in opportunistically to make a red run green.

## Consequences

- A financial race can be observed under real MVCC for the first time, through
  the access path production actually uses.
- CI gains a job measured in minutes rather than seconds, which is why it is
  path-filtered rather than universal — and why a change outside those paths
  that would break it is not caught. That is a stated limit, not an oversight.
- The suite is reproducible on any developer machine with a working Docker
  daemon, by the same `pnpm billing:concurrency` command, against the same
  disposable stack. It needs no account, no project and no credential.
- `supabase/config.toml` now carries a setting whose only purpose is parity with
  an observed platform default. It becomes wrong the moment the deployed
  project's privileges change, which is one more reason the ROADMAP entry above
  matters.

## What this decision does not establish

- **Not that the billing system is correct under concurrency.** A green run
  covers the race classes the suite exercises, at the iteration count it
  chooses, on one local topology. The sprint record states the permitted
  claim in one sentence and forbids the generalisation.
- **Not equivalence with the deployed environment.** The local stack runs no
  Supavisor (`[db.pooler] enabled = false`), so connection pooling and queueing
  under load differ. There is no network latency, so arrival interleaving is
  compressed — which makes contention more aggressive locally, and therefore
  good at finding races and bad at predicting production timing.
- **Not a value for `CONTENTION_ATTEMPTS`.** E2b observes how many rounds real
  contention needs and records the number. It does not change the constant.
- **Not a licence to run anything else against a database in CI.** This ADR
  authorises one suite, against one disposable local stack, with no secret.

## Revisit when

The organization moves to a plan where preview branches exist, or the deployed
project's privilege model changes, or a second suite wants a database in CI.
