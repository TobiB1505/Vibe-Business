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
| Gateway tool calls | `tool_calls_allowed`, `tool_calls_denied` | ✅ **correctly 0** — see the correction below |
| Gateway file reads | `files_read` | ✅ **correctly 0** — see the correction below |
| Harness tool calls | derived from `agent_execution_events` | ✅ all six runs |
| Harness read ops / unique files | derived from `agent_execution_events` | ✅ all six runs |
| Sandbox runtime | `sandbox_usage_events` (`operation = agent_execution`) | ✅ 11 rows, duration + CPU |
| Completion metrics | `implementation_mutations`, `convergence_mutations`, `repair_cycles` | ⚠️ from run #8 only |
| Verification metrics | `verification_commands`, `verification_ms` | ⚠️ from run #6 only |

The metric set grew over the six runs, so **no cross-run comparison is valid on
any metric younger than the run it is compared against**. Sprint 0050
implements that as `economy/metric-availability.ts`, which distinguishes a
measured `0` from `unavailable` from `missing`.

### Correction — the "broken" tool metrics were not broken

An earlier revision of this document reported `tool_calls_allowed` and
`files_read` as *"0 on every run — the columns exist and nothing writes them"*.
Both halves were wrong.

Something does write them. `operations/agent-execution/execution.ts` records
`gateway.counters` after every run, with a comment stating exactly what it is
doing: *"Under the sandbox topology the trail is empty by construction: the
harness edits files with its own tools inside the VM and never calls back. It is
still written, because 'the gateway brokered nothing' is a fact worth having
recorded rather than an absence to infer."*

So those columns count **gateway-brokered** calls, and under ADR 0029 zero is
their correct and meaningful value. Nothing was broken; a column was read as
answering a question it does not answer.

The harness's own activity was recorded the whole time, in
`agent_execution_events` — 479 rows across the six runs, each `file_read`,
`file_edited`, `file_searched` and `command_started` carrying its tool and path.
`economy/harness-metrics.ts` derives from it, and keeps read *operations* and
*unique files* as separate fields so one file read five times can never mean
both 1 and 5:

| Run | Tool calls | Read ops | Unique files read | Edits | Searches | Commands |
|---|---|---|---|---|---|---|
| #3 | 37 | 16 | 14 | 2 | 2 | 17 |
| #4 | 20 | 11 | 10 | 2 | 1 | 6 |
| #5 | 28 | 17 | 15 | 2 | 6 | 3 |
| #6 | 14 | 6 | 4 | 2 | 0 | 6 |
| #7 | 30 | 18 | 10 | 8 | 1 | 3 |
| #8 | 22 | 7 | 6 | 4 | 7 | 4 |

**Bytes read is deliberately not derived.** `agent_tool_events` has a `bytes`
column and zero rows — it belongs to the gateway, which brokers nothing — and
the harness's `file_read` events carry a path with no size. Summing file sizes
from the repository would measure the files rather than the reads.

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

### Sandbox cost, now derived (Sprint 0050)

Sandbox time is no longer unpriced. `economy/infrastructure-rates.ts` holds a
versioned Vercel Sandbox rate card (`vercel-sandbox-2026-08-20`):

| Dimension | Rate |
|---|---|
| Active CPU | $0.128 / CPU-hour |
| Provisioned memory | $0.0212 / GB-hour |
| Sandbox creation | $0.60 / 1,000,000 |
| Outbound network | $0.15 / GB |
| Snapshot storage | $0.08 / GB-month |
| RAM per vCPU | 2 GB (verified from Vercel docs) |

**The prices are `founder_attested` and `verified: true`.** Three attempts
across two sprints to check them from the build environment all failed —
`vercel.com` is blocked by the egress proxy, and the Vercel
documentation-search tool returns the pricing page's worked examples but
never its price table. A fourth attempt — a screenshot of a different AI
assistant claiming to have browsed the page — was rejected as evidence: no
way to tell a real fetch from a recollection that happens to match, and not a
primary source regardless. What closed it was Vibe's own founder confirming
the five figures directly, on 2026-08-20 — a commercial sign-off, the same
kind of authority `credits/rating.ts` already requires before any Credit rate
can exist, applied one layer down to infrastructure cost. The rate card's
`sourceKind` says exactly this — `founder_attested`, not
`official_public_pricing` — so nothing here claims a technical verification
that did not happen. Cost derived from it is still labelled `estimated` rather
than `measured`, because it is a price applied to a measured quantity, not a
provider-reported cost.

They do reproduce Vercel's own worked example — 2 vCPU / 4 GB / 5 min fully
active = **$0.0284**, against Vercel's documented "about $0.03" — which is
pinned as a regression test.

**Vibe does not run the 2 vCPU default.** `SANDBOX_RESOURCES.vcpus` is 4, and
agent provisioning passes no override, so both microVMs are **4 vCPU / 8 GB** —
twice the example shape and twice its cost. That is `derived_from_configuration`,
reconstructed from pinned code, never called measured.

#### Wall clock is not active CPU

Vercel bills active CPU only while the VM works. The agent microVM records both,
and the measured utilisation is **32%–75%, mean 57%** — an agent waiting on a
provider response burns wall clock and no CPU. Assuming 100% would have
overstated agent CPU cost by roughly three quarters, so `deriveSandboxCost`
refuses: when `activeCpuMs` is null the CPU component is `unknown`, and a
separate, explicitly named `fullActiveCpuUpperBound` is offered instead.

#### What is derivable per run

| | Agent microVM | Validation microVM (Sprint 0051+) | Validation microVM (historical) |
|---|---|---|---|
| Wall duration | ✅ measured | ✅ measured | ✅ measured |
| **Active CPU** | ✅ measured, all 11 rows | ✅ measured, fixed at the source | ❌ never captured |
| Egress bytes | ✅ measured | ✅ measured, same fix | ❌ never captured |
| vCPU / RAM | derived from configuration | derived from configuration | derived from configuration |
| Creation count | 1, known | 1, known | 1, known |
| Snapshot | none taken | none taken | none taken |
| **Result** | **complete cost** | **complete cost — a point estimate** | floor + upper bound only |

### Correction — validation active CPU was a bug, not an absence (Sprint 0051)

An earlier revision of this document listed validation active CPU as "not
recorded" — true as a description of the data, wrong about the reason.
Reading the compiled `@vercel/sandbox` SDK settled it: `captureValidatedArtifact`
calls `sandbox.snapshot()` for every *passing* run, then read
`this.sandbox.totalActiveCpuDurationMs` off the same local SDK instance. The
SDK only refreshes that cached field from `.update()` or `.stop()` —
`.snapshot()` refreshes an internal *session* object our code never read, and
the `Snapshot` it returns carries no usage fields at all. So the value read was
never the finished run's; it was the sandbox's state at construction, before
anything had run — `undefined` on every real invocation.

**Fixed at the source**, in `validation/vercel/provider.ts`: after a snapshot,
the adapter now re-fetches the sandbox with a fresh `Sandbox.get({ name,
resume: false })` — a real round trip against the provider's own record, which
the SDK documents as cumulative "across all sessions," independent of the
stale local cache. `stop()` (the failing-run path) was never affected; it
reads usage from its own return value, which the SDK populates correctly, and
that is why 7 of 8 failed validation rows already had it while 15 of 19
passed rows did not.

**Nothing historical changed.** There is no second copy of the number
anywhere in the schema to recover — the bug was that the provider was never
asked the right question, not that an answer was captured and discarded. Runs
#3–#8 keep the floor/upper-bound figures below. Every validation from this fix
forward gets a **complete point estimate** instead.

## Re-analysed run costs (PART I)

| Run | Model spend | Agent sandbox | Validation (floor) | **Floor** | Full-active upper |
|---|---|---|---|---|---|
| #3 | $0.3465 | $0.0706 | $0.0160 | **$0.4331** | $0.4814 |
| #4 | $0.2272 | $0.0573 | — *(not validated)* | **$0.2845** | $0.2845 |
| #5 | $0.3199 | $0.0183 | $0.0161 | **$0.3542** | $0.4027 |
| #6 | $0.1444 | $0.0127 | $0.0168 | **$0.1739** | $0.2245 |
| #7 | $0.2515 | $0.0151 | $0.0155 | **$0.2821** | $0.3289 |
| #8 | $0.2144 | $0.0239 | $0.0158 | **$0.2541** | $0.3017 |

Floor: min **$0.1739**, median **$0.2833**, mean **$0.2970**, max **$0.4331**.
Upper bound mean **$0.3373**.

**Infrastructure adds 18.5% to the model spend** — material, and far from the
order-of-magnitude unknown the previous revision had to leave open.

### Cost per delivered run, revised

Failure spend also rises once the agent microVM is priced: the two costly
failures spent $0.3794 and $0.6842 including sandbox, plus $0.0060 for a third.
Across all attempts **$2.8515**, delivering six runs:

**$0.4752 per delivered run** — a 60% uplift on the successful-run mean of
$0.2970, and up from the model-spend-only figure of $0.4047.

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
| ~~Rate card unverified~~ | ~~Sandbox cost is estimated, not confirmed~~ — **resolved**: `founder_attested` by Vibe's own founder on 2026-08-20, after three failed environment-side attempts and one rejected AI-relayed claim | done |
| ~~Validation `active_cpu_ms` not recorded~~ | ~~Validation cost has a floor and a bound~~ — **resolved (Sprint 0051)**: the bug is fixed at the source; every validation from now on gets a point estimate | done |
| ~~`tool_calls_allowed` / `files_read` always 0~~ | ~~Tool use untestable~~ — **resolved**: correct as gateway counters; harness activity derived from `agent_execution_events` | done |
| Historical runs #3–#8 have no validation point estimate | The six existing runs keep floor + upper bound forever | Not fixable — no second copy of the number exists to recover |
| Vercel Functions / Workflow invocation cost not instrumented | Believed immaterial (0.07–1.07% of a delivered run, reasoned not measured) | Not pursued — see PART H, Sprint 0051; revisit only if invocation count grows materially |
| n = 6 | Correlations are thin | More runs |
| All runs `non_production_economics` | No production-rate data at all | A production run |

---

## Open decisions

1. ~~**Verify the Vercel rate card.**~~ **Resolved.** Sprint 0051 named this
   the one remaining blocker on Credit pricing after three independent
   attempts across two sprints failed to reach the price table from this
   environment, and after a screenshot claiming a different AI assistant had
   browsed the page was rejected — no way to tell a real fetch from a
   recollection that happens to match, and not a primary source either way.
   Vibe's founder then confirmed the five figures directly, by name, on
   2026-08-20. `sourceKind` now reads `founder_attested` — a commercial
   sign-off, not a claim that this environment performed a technical
   verification it did not. The **NOT READY** verdict from Sprint 0051 is
   superseded on this specific point; see that sprint's own record for what
   was tried and rejected before this closed it.
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
