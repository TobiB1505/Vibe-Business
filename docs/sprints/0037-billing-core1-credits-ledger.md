# BILLING CORE-1 — Vibe Credits, Usage Ledger & Rating Foundation

**Status: implemented, shadow mode, unmerged.** No customer is charged, no workflow is paywalled, and no production Credit rate exists.

## Why now

Agentic Execution introduces highly variable provider cost — repeated agent turns, repair loops, sandbox compute, optional browser verification. Before building an agent that can spend an unbounded amount, Vibe needs one canonical economic layer that can answer what an operation consumed, what it cost, what it rates to in Credits, what is reserved, and what may safely start.

Billing Core 1 builds that layer and rates existing usage in shadow. It does not build the agent, Stripe, or final pricing.

---

## Pre-flight: the cost architecture that already existed

The first deliverable was a map, not code. Vibe already had substantial provider-cost accounting, and the fastest way to get this sprint wrong would have been to build a second one.

| Provider usage source | Canonical storage | Price calculation | Operation identity | Missing billing abstraction |
|---|---|---|---|---|
| Anthropic inference | `ai_usage_events` (insert-only, no SELECT policy) | `calculateProviderCost()` in `src/modules/ai/pricing.ts` — integer nanodollars, effective-dated | `job_id` = domain result id (unique index); `user_id`, `project_id` denormalized | No Credit rating, no customer-facing balance |
| Deep Scan browser | `deep_scan_provider_usage` | **none** — `provider_cost_usd` is always `null` by policy | `session_id` | Cost is genuinely unknown, must not become zero |
| Sandbox (validation) | `sandbox_usage_events` | **none** — null in practice | `validation_run_id` | Units measurable (CPU ms, bytes), cost unknown |
| Sandbox (preview) | `sandbox_usage_events` | **none** | `preview_session_id` (unique) | as above |
| Review browser | `review_browser_usage` | **none** | `review_artifact_id` (unique) | as above |

Four separate provider ledgers, deliberately never unioned — the stated reason, repeated in each migration, is that browser-seconds and CPU-ms are not tokens and merging them "would make every future cost question ambiguous."

**What did not exist:** any credit account, balance, ledger, reservation, quote, rate card, Stripe integration, or customer-facing cost surface. `src/modules/credits/` and `src/modules/usage/` were boundary-reserved stubs containing only a README.

**Production Credit rate:** none. `ARCHITECTURE.md §3.11` records it as an explicit **`[Open decision]`** — *"Credit pricing / credit-to-cost conversion rate is not decided"* — and `PRODUCT.md §12.1` states that until Credits exist, *"No price is shown, no balance is invented."* This sprint therefore builds the rating architecture and ships **zero production rate cards**. See *Production Credit rate status* below.

### Constraints this inherited rather than invented

- **Integer nanodollars.** `pricing.ts` computes in whole nanodollars (1e-9 USD) and renders a decimal string only at the end. Any billing arithmetic that used floats would disagree with the existing ledger by construction.
- **`ai_usage_events` is unreadable by the client.** It has an insert policy and no select policy — "the absence of a select policy is the access control." A customer-facing balance can never be a view over it.
- **`recordAIUsage` never throws.** It swallows insert errors so a ledger write cannot fail an audit the user already paid for. It is therefore not a suitable authority for "the customer was charged."
- **Unknown cost is never fabricated.** `buildDeepScanUsage` pins `providerCostUsd: null` as a *literal type* — the type system forbids inventing a browser cost. Billing had to preserve that discipline, not paper over it.
- **The repo has no transactional RPC.** Exactly one Postgres function exists (`set_updated_at`). Atomicity is achieved with partial unique indexes and claim-then-write. Billing followed that idiom rather than introducing plpgsql (see *Concurrency* below).

---

## Schema plan (written before the migration, per §45)

Five tables. Rate cards deliberately are **not** a table — see *Credit rating architecture*.

| Table | Purpose | Why it must exist separately |
|---|---|---|
| `billing_credit_accounts` | One wallet per owner; carries materialized `posted_credits` / `reserved_credits` | The atomic reservation primitive needs a single row to lock |
| `billing_credit_ledger` | Append-only posted balance changes (GRANT/PURCHASE/CHARGE/REFUND/ADJUSTMENT) | Financial history must be reconstructable and immutable |
| `billing_credit_reservations` | Holds, not charges | A reservation is released or settled; a ledger entry never is |
| `billing_credit_quotes` | Pre-reservation estimate + maximum | Bindable to a later reservation; an estimate is not a hold |
| `billing_usage_events` | Provider-neutral normalized usage, referencing canonical source rows | Rating needs one shape across Anthropic/browser/sandbox |

Rejected: a rate-card table (rating lives in code, mirroring `pricing.ts`), a separate charge table (a CHARGE *is* a ledger entry), and any copy of provider token counts already canonical elsewhere (billing stores the normalized quantity plus a reference, never a duplicate of the source row).

---

## What was built

`src/modules/credits/` — the boundary Sprint 0 reserved, now filled in:

| File | Role |
|---|---|
| `units.ts` | Exact integer Credit arithmetic. 1 Credit = 1000 units; anything inexact throws |
| `schema.ts` | Ledger kinds, reservation/quote statuses, usage SKUs, cost and rating status |
| `balance.ts` | Posted/reserved/available, reservation admission, settlement, release, refund — pure |
| `rating.ts` | Versioned effective-dated Credit rate cards, deterministic rounding. **Registry empty** |
| `projection.ts` | Provider-neutral projection from each canonical ledger. Pure |
| `store.ts` | Persistence, including the atomic reservation primitive |
| `service.ts` | The domain API: quote / reserve / settle / release / refund / grant |
| `reconciliation.ts` | Idempotent shadow reconciliation across all four provider ledgers |
| `dogfood.probe.ts` | Dev-only. Reads real history, makes **no provider calls** |

## Credit unit representation

One displayed Credit is **1000 integer credit units** (three decimals). Balances are `bigint`; provider cost stays in **integer nanodollars**, matching `ai/pricing.ts` so the two layers reconcile with no unit conversion. `creditUnits()` rejects any fractional, non-finite or unsafe value, and normalizes `-0` — which arises from negating a zero charge and would otherwise fail identity comparisons.

## Concurrency: how an overspend is actually prevented

The reservation invariant is `available >= requested`, and the guarantee is **not** the application check — by the time a caller acts on a balance it has read, that number is stale.

PostgREST cannot express a column-relative `set reserved = reserved + $1`, so admission is a **compare-and-swap**: the update carries the new value and is guarded by `eq(reserved_credits, <value read>)`. A caller that lost the race matches zero rows and did not take a hold.

CAS alone proved too strict during testing: two callers reserving 700 each against 1500 both read `reserved = 0`, the first won, and the second was refused **despite the balance covering it** — a funded customer told "insufficient credits" because somebody else was quick. So a failed swap re-reads and distinguishes the two causes: genuinely insufficient (terminal) versus contention (retry, bounded at 3). The safety direction never depends on the retry — it is guaranteed by the swap and, beneath it, by `billing_credit_accounts_available_non_negative`.

This follows the codebase's existing idiom (`operation_runs_single_active_idx`, the included-audit claim guard): move the collision into the database. No plpgsql was introduced; the repo has exactly one Postgres function and this sprint did not add a second.

## Shadow mode

Nothing is wired into an existing flow. The audit entitlement gate at `src/modules/operations/service.ts` is untouched, `AuditAccessMode`'s reserved `"credits"` value is still unreachable, and no workflow consults a balance. Confirmed on the live database after the dogfood: **0 credit accounts, 0 ledger entries, 0 reservations, 0 quotes** — 199 usage events measured, nobody charged.

## Real dogfood — historical usage, no new spend

Run against the live project's own history. No inference, browser or sandbox call was made, so the dogfood was free.

| Operation | Model | Runs | Input tok | Output tok | Known raw cost | Avg/run |
|---|---|---|---|---|---|---|
| `business_readiness_audit` | claude-sonnet-5 | 25 | 276,051 | 205,522 | $2.607322 | $0.104293 |
| `opportunity_generation` | claude-sonnet-5 | 10 | 103,306 | 43,445 | $0.641062 | $0.064106 |
| `product_understanding` | claude-haiku-4-5 | 8 | 33,089 | 6,620 | $0.066189 | $0.008274 |
| `action_planning` | claude-sonnet-5 | 1 | 8,246 | 2,747 | $0.043962 | $0.043962 |
| **Total AI** | | **44 costed** | | | **$3.358535** | |

| Source | Events | Costed | Cost unknown | Credit rating | Charged |
|---|---|---|---|---|---|
| `ai_usage_event` | 124 | 44 | 0 | `rate_card_not_configured` | NO |
| `sandbox_usage_event` | 67 | 0 | 25 | `rate_card_not_configured` | NO |
| `deep_scan_provider_usage` | 6 | 0 | 6 | `rate_card_not_configured` | NO |
| `review_browser_usage` | 2 | 0 | 2 | `rate_card_not_configured` | NO |

**33 unknown-cost events are reported as unknown, never as $0.** Browserbase and Vercel do not return an attributable price and none was invented.

### §69 reconciliation against the canonical AI ledger

Billing recomputes cost with the same authoritative module, at each row's own timestamp:

```
billing_usage_events   3,358,535,000 nanoUSD
ai_usage_events        3,358,535,000 nanoUSD
difference                         0        reconciles exactly: true
```

Exact to the nanodollar across all 54 real calls, including effective-dated pricing.

### §43 idempotency

The full reconciliation ran twice against the live database. Second pass inserted **0** rows; every event reported already-present. Guaranteed by `billing_usage_events_source_sku_idx`, not by an application check.

## Internal calibration findings

- A business audit is the dominant cost at ~$0.104/run — roughly **2.4×** an opportunity generation, **12.6×** a product understanding, and **2.4×** an action plan.
- Product understanding on Haiku is an order of magnitude cheaper than anything on Sonnet, which is what it was configured for.
- Output tokens dominate audit cost: 205k output at $10/MTok versus 276k input at $2/MTok.
- **Every non-AI provider cost in Vibe's entire history is unknown.** 33 of 199 usage events carry real measured units with no price. Any future Credit rate covering sandbox or browser work needs a cost input that does not exist yet — that is a prerequisite for pricing agent execution, and it is a gap in provider reporting rather than in this layer.
- Sonnet's introductory pricing ends 2026-09-01 (+50% input, +50% output). Audit cost rises to roughly $0.156/run on that date with no code change.

## Production Credit rate status

**No production Credit rate exists, and none was invented.** `CREDIT_RATE_CARDS` ships empty; a unit test asserts it. Real usage rates to `rate_card_not_configured` with a **null** Credit amount. Test fixtures supply their own obviously-named `test-rate-card-v1`.

## Tests

**3926 unit tests pass** (202 files), up from 3830 — 96 new, no existing test disturbed.

Mandatory coverage: ledger walkthrough (§50), maximum budget both directions (§51), unknown cost (§52), rate-version immutability (§53), rounding and anti-fragmentation (§54), idempotency (§49), concurrency (§48), schema/CHECK pinning (§47), and no-client-writable-policy (§31/§32).

### Mutation testing (§78)

Twelve mutations applied and reverted, each verified in the diff:

| # | Mutation | Result |
|---|---|---|
| 1 | Reservation ignores available balance | caught |
| 2 | Actual may exceed reserved without approval | caught |
| 3 | Concurrent reservations overspend (CAS removed) | caught |
| 4 | Duplicate settlement posts two charges | caught |
| 5 | Deep Scan unknown cost becomes zero | caught |
| 6 | Latest rate card re-rates history | caught |
| 7 | Unpriced model rates as free | caught |
| 8 | Refund exceeds the original charge | caught |
| 9 | Per-event rounding (fragmentation overcharge) | caught |
| 10 | Duplicate reconciliation duplicates usage | caught |
| 11 | Float arithmetic admitted into balances | **SURVIVED → fixed** |
| 12 | Client-writable insert policy on the ledger | caught |

**Mutation 11 found a real test defect.** Deleting the integer check left the suite green, because `Number.isSafeInteger(1.5)` is also false and the range guard threw instead — the same error class via the wrong rule, with a misleading message. The assertions now pin each guard by message; the mutation is caught.

## Deferred to Billing Core 2

Stripe (checkout, webhooks, customer portal), subscription plans and monthly grants, credit-pack purchase, invoices, tax, coupons, the customer billing UI, and **enforcement** — requiring a positive balance to start an operation. The seam is `src/modules/operations/service.ts`, where the audit entitlement is already checked, and it was deliberately not touched.

## Risks and follow-ups

- **No production Credit rate**, so nothing is rated. Intentional, and the next commercial decision.
- **All non-AI provider cost is unknown.** Pricing agent execution needs a sandbox/browser cost input that no provider currently returns.
- **`ai_usage_events` has no `operation_run_id`.** Its `job_id` is the domain result id, so `billing_usage_events.operation_run_id` is null for backfilled history. Multi-usage-per-operation aggregation (§62, §63) is supported by the schema and indexes but unproven on real data until an operation writes usage with a run id.
- **Reconciliation inserts row by row** (~60s for 199 events over the network). Fine for a backfill, too slow for a hot path; a batched upsert is the fix when one is needed.
- **The materialized balance is a cache.** `reconcileBalance` proves it against the ledger and logs drift as a defect; nothing yet runs that check on a schedule.
- **CLI migration workflow unavailable in this container** (no access token or DB password), so the migration was applied through the management API — the same fallback the previous deployment sprint used. It stamped a wall-clock version (`20260817204827`) instead of the filename's, and the ledger was realigned to `20260817180000` so the file stays source of truth (rule 34). Deployment was verified structurally: 5 tables, 13 indexes, 5 policies (**all SELECT, zero write policies**), 12 named constraints, RLS on all five tables.
