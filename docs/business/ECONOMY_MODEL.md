# Agent Economy Model

**Status:** analysis only. Nothing in this document is implemented as pricing.
`CREDIT_RATE_CARDS` remains empty, no billing or credit behaviour changed, and
no UI shows any of this.

**Relationship to [CREDIT_ECONOMICS.md](CREDIT_ECONOMICS.md):** that document
priced Vibe's *predictable* operations — audit, opportunities, planning — from
real data, and modelled agentic execution because none existed yet. Agentic
execution now has six completed runs. This document replaces the modelled
figures with measured ones and corrects two claims that were true when written
and are no longer. It does not restate the rest.

Every number below was read from Supabase (`dcbwlctscooefwnivxzv`) on
2026-08-20 and is frozen in `src/modules/economy/run-economics.test.ts` so it
cannot drift silently.

---

## What is already tracked (PART A)

### Agent execution — `agent_execution_runs`, 90 columns

| Metric | Column | Populated? |
|---|---|---|
| Provider calls | *(via `ai_usage_events.job_id`)* | ✅ all runs |
| Provider cost | `ai_usage_events.provider_cost_usd` | ✅ 197/209 rows |
| Input / output tokens | `input_tokens`, `output_tokens` | ✅ |
| Thinking tokens | `thinking_tokens` | ✅ — **billed inside output**, see below |
| Cache read / write | `cache_read_input_tokens`, `cache_creation_input_tokens` | ✅ 129 / 137 rows |
| Duration | `duration_ms` | ✅ 9/11 runs |
| SDK iterations | `sdk_loop_iterations` | ⚠️ from run #4 only |
| Tool calls | `tool_calls_allowed`, `tool_calls_denied` | ❌ **0 on every run** |
| Files read | `files_read` | ❌ **0 on every run** |
| Sandbox runtime | `sandbox_usage_events` (`operation = agent_execution`) | ✅ 11 rows, duration + CPU |
| Completion metrics | `implementation_mutations`, `convergence_mutations`, `repair_cycles` | ⚠️ from run #8 only |
| Verification metrics | `verification_commands`, `verification_ms` | ⚠️ from run #6 only |

Two things follow. `tool_calls_allowed` and `files_read` are recorded as zero on
every run including successful ones — the columns exist and nothing writes them,
so no cost driver can be tested against tool use today. And the metric set grew
over the six runs, so **no cross-run comparison is valid on any metric younger
than the run it is compared against**.

### Validation — `validation_runs`, `sandbox_usage_events`

Per-phase durations live in `validation_runs.steps` (`install`, `typecheck`,
`test`, `build`), and sandbox lifetime in `sandbox_usage_events`. All measured.
`active_cpu_ms` and `network_egress_bytes` began being recorded partway through
(7 of 27 validation rows).

### Billing / credits

The infrastructure is complete and deliberately unpriced:

- `billing_credit_accounts`, `_allocations`, `_grants`, `_ledger`, `_quotes`,
  `_reservations` — reservations, holds, settlement, release, refund
- `billing_usage_events` — unified metering with `raw_cost_nano_usd`,
  `cost_status`, `rating_status`, `rated_credits`
- `CREDIT_RATE_CARDS = []` in `credits/rating.ts` — **empty by design.** Rating
  returns `rate_card_not_configured` for real usage.

Reservation and settlement already run on every agent execution; they reserve
and settle against a quote, not against a price.

---

## Two corrections to CREDIT_ECONOMICS.md

**1. "No caching contribution is currently measured or billed."** No longer
true, and the reversal is large. Cache columns exist, are populated, and for
agentic execution cache tokens are **55–70% of provider cost** — the single
largest component. That document's cost model, built on input/output only, does
not describe an agentic run at all.

**2. "A modeled medium Agent task (~$15 retail)."** Measured agentic runs cost
**$0.1444–$0.3465** in provider spend. The modelled figure was roughly two
orders of magnitude high. Any Credit sizing derived from it needs redoing.

---

## The six runs (PART C)

All `claude-sonnet-5`, all `non_production_economics = true`.

| Run | Wall clock | Calls | Provider cost | Output tok | Cache read | Cache write | Files |
|---|---|---|---|---|---|---|---|
| #3 | 523.9s | 21 | **$0.3465** | 9,426 | 646,620 | 47,881 | 2 |
| #4 | 388.4s | 13 | $0.2272 | 6,081 | 320,411 | 38,778 | 2 |
| #5 | 191.8s | 15 | $0.3199 | 7,778 | 504,374 | 54,176 | 2 |
| #6 | 79.9s | 10 | **$0.1444** | 4,195 | 149,390 | 26,600 | 2 |
| #7 | 120.9s | 13 | $0.2515 | 9,310 | 277,657 | 38,701 | 8 |
| #8 | 198.7s | 17 | $0.2144 | 6,551 | 317,319 | 31,883 | 3 |

Mean **$0.2507**, σ $0.0737, CoV 29%.

**The ledger is exact.** Recomputing each run from `ai/pricing.ts`'s own rates
($2/MTok input, $10/MTok output, 0.1× cache read, 1.25× cache write) reproduces
the stored `provider_cost_usd` to four decimals on all six. Thinking tokens are
billed inside output, not separately — the recomputation only balances if they
are not added again.

### Cost composition

| Component | Share of provider cost |
|---|---|
| Cache write | 34–46% |
| Cache read | 21–37% |
| Output | 24–37% |
| Input | 2–4% |

### Failed runs cost real money

Two failed runs spent **$0.3085** and **$0.6158**. The dearer failure cost 78%
more than the dearest success. Across all eight attempted runs Vibe spent
**$2.4282**, of which **$0.9243 — 38% — bought nothing**.

So the number that should anchor pricing is not the succeeded-mean of $0.2507
but the **effective cost per delivered run of $0.4047**, a **61% uplift**. This
is the same shape `CREDIT_ECONOMICS.md` found for Business Audit (+33%), and it
is larger here.

### Validation and sandbox

| Stage | Mean duration | Priced? |
|---|---|---|
| Agent microVM | 298.1s (n=11) | ❌ |
| Validation microVM | 311.2s (n=19 passed) | ❌ |
| — install | 12.9s | |
| — typecheck | 87.9s | |
| — test | 86.8s | |
| — build | 111.0s | |

**≈10.5 minutes of microVM per agent run, and `provider_cost_usd` is null in all
43 sandbox rows.** No sandbox price exists anywhere in the codebase;
`validation/budgets.ts` knows the VM has four vCPUs and nothing about what four
vCPUs cost.

---

## Cost drivers (PART D)

Pearson correlation against provider cost, computed in Postgres over the six
successful runs:

| Driver | r |
|---|---|
| **Cache tokens (read + write)** | **0.960** |
| Cache read alone | 0.954 |
| Cache write alone | 0.935 |
| Output tokens | 0.838 |
| Provider calls | 0.768 |
| Wall clock | 0.617 |
| **Changed files** | **−0.035** |
| **Changed bytes** | **−0.219** |

**Cost is driven by context volume, not by delivered work.** The correlation
with changed files is statistically indistinguishable from zero and with changed
bytes is slightly negative. Run #7 changed eight files for $0.2515; run #3
changed two for $0.3465. Run #5 ran in under half of run #4's wall clock and
cost 41% more.

That is the finding with the most product consequence: **a Credit price
proportional to output would charge for the wrong thing.** What a run costs is
how much context it re-read, which is a property of the prompt and the harness —
things Vibe controls — not of the task the customer asked for.

n = 6. These correlations are directionally strong and statistically thin;
treat the sign and the ranking as findings, the magnitudes as provisional.

---

## Credit scenarios (PART E)

Applied to the six-run mean floor of $0.2507. Implemented in
`economy/run-economics.ts` so the arithmetic is reproducible, and reaching
nothing that charges anyone.

| Model | Retail | Credits | Realised margin |
|---|---|---|---|
| A — 1 Credit = $0.01, at cost | $0.2507 | 26 | 3.6% (rounding only) |
| B — 70% margin, $0.02/Credit | $0.8357 | 42 | ≥70% |
| C — 80% margin, $0.02/Credit | $1.2535 | 63 | ≥80% |

**Every margin here is over a floor, not a cost.** Ten and a half minutes of
unpriced microVM sits underneath all three.

### Break-even, which needs no invented price

Rather than guessing a sandbox rate, invert the question. At Model C's price of
$1.26 per run, and 632.8s of measured microVM:

| Sandbox rate | Realised margin |
|---|---|
| below **$0.72/hour** | still above 70% |
| **$5.74/hour** | zero |

So the exposure is bounded and checkable. When a real invoice arrives, this
table says immediately whether the pricing thesis survives it.

### Spread

| | Provider cost | Model C credits |
|---|---|---|
| Cheapest (#6) | $0.1444 | 37 |
| Mean | $0.2507 | 63 |
| Dearest (#3) | $0.3465 | 87 |
| Dearest failure | $0.6158 | *(unbilled)* |

A 2.4× spread between cheapest and dearest run. Flat per-run pricing is viable
at this spread; per-token pricing would expose the customer to a driver they do
not control.

---

## Missing metrics

| Gap | Consequence | Fixable by |
|---|---|---|
| **No sandbox price** | No run's true cost is knowable | A vendor quote. Nothing in code. |
| `tool_calls_allowed` / `files_read` always 0 | Tool use cannot be tested as a driver | Writing the columns that already exist |
| `active_cpu_ms` partial (7/27) | Cannot bill CPU instead of wall clock | Recording it for every run |
| No workflow-invocation metering | Vercel function cost invisible | New metering |
| n = 6 | Correlations are thin | More runs |
| All runs `non_production_economics` | No production-rate data at all | A production run |

---

## Open decisions

1. **Get a sandbox price.** Everything else waits on it. It is the largest
   unmeasured input and the only one that cannot be fixed from inside the
   codebase.
2. **Price per run, not per token.** The data supports it: cost correlates with
   context volume, which the customer neither sees nor controls, and not with
   delivered work, which is what they think they are buying.
3. **Decide who pays for failures.** $0.9243 of the $2.4282 spent across all
   eight attempted runs bought nothing. Charging only for delivered results is
   the customer-fair answer and needs a **61% uplift** on the succeeded-mean to
   stay whole — price against $0.4047, not $0.2507.
4. **Redo the Credit sizing in CREDIT_ECONOMICS.md** against $0.25/run rather
   than the modelled $15.
5. **Sonnet 5 rises 50% on 2026-09-01** (already in `ai/pricing.ts`). Mean run
   cost moves from $0.2507 to roughly $0.376 with no code change.
6. **Re-measure after Sprint 0047.** Risk-adaptive validation skips the unit
   suite on a `fast` run — 87s of the 311s validation microVM. None of the runs
   above ran under that policy.
