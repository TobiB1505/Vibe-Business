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
| #9 | $0.3115 | $0.0195 | $0.0160 | **$0.3470** | $0.3954 |

Floor (n=7): min **$0.1739**, median **$0.2845**, mean **$0.3041**, max
**$0.4331**. Upper bound mean **$0.3456**.

**Infrastructure adds 17.3% to the model spend** — material, and far from the
order-of-magnitude unknown the previous revision had to leave open. The share
fell from 18.5% not because infrastructure got cheaper but because run #9's
model spend was unusually high relative to its wall clock; see the finding
below.

Run #9 was added in Sprint 0053. Its two derived figures were recomputed with
this repository's own `deriveSandboxCost` and `VERCEL_SANDBOX_RATES` rather than
transcribed, and its model spend ($0.3115055 over 14 `ai_usage_events`) is
exact. Every aggregate on this page is now produced by
`economy/historical-runs.ts` and its siblings, so a dataset edit that broke one
of them fails a test rather than leaving a stale number here.

### Cost per delivered run, revised

Failure spend also rises once the agent microVM is priced: the two costly
failures spent $0.3794 and $0.6842 including sandbox, plus $0.0060 for a third —
**$1.0672** across all five failed attempts. With seven delivered runs at
**$2.1289**, total attempt spend is **$3.1961**:

**$0.4566 per delivered run** — a 50% uplift on the successful-run mean of
$0.3041.

Down from $0.4752 at n=6, and worth reading carefully: the effective cost fell
while the *mean run cost rose*. A fixed failure bill spread over one more
delivered run does that. The two move independently, and quoting a margin from
whichever is lower is exactly the mistake this section exists to prevent.

### Vercel Functions / Workflows: real prices, materiality unchanged

Sprint 0051's PART H reasoned about workflow-invocation cost with no real
price at all — every dollar figure in it was a labelled, deliberately-bounded
guess. The founder's second attestation (2026-08-20) replaced the price with
a real one: `$0.128`/CPU-hour, `$0.0106`/GB-hour, `$0.60`/million invocations,
**`$20`/million Workflow events** — 33⅓× a plain invocation, and the rate that
actually applies, since Vibe's two workflows are built on `"use step"` /
`"use workflow"` (Vercel Workflows), not bare Functions.

The step count was never a guess — `economy/workflow-invocation-cost.ts`
computes it from the real step graph (8 fixed agent steps + one poll per 20s
of agent wall clock + 11 validation steps) and each run's own measured
duration: **23–46 events per run**. What the founder's attestation could not
supply, because no price list can, is how long each step actually runs — that
stays an explicitly labelled assumption, `realistic` (500ms, a DB read/write)
or `generous` (2s, a deliberately pessimistic upper bound), never `measured`.

| | Realistic | Generous (dearest run, #3) |
|---|---|---|
| Share of the $0.4752 delivered-run floor | 0.19–0.37% | **0.94%** |

**Materiality conclusion unchanged: still not instrumented.** The event
charge alone — the one component now fully priced with no assumption at all —
is under 0.2% by itself even on the busiest run. The generous bound sits close
to the 1% line without crossing it, which is the honest way to say this
survived contact with a real price rather than that it was comfortably clear.

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

**Repository state is now recorded per run (Sprint 0053).**
`agent_execution_runs` gained `repo_tree_entries`, `repo_files_analyzed`,
`repo_bytes_analyzed`, `repo_routes_detected`, `repo_surfaces_detected` and
`context_candidates_available` — projected from the pinned snapshot's own
`AnalysisMetrics`, so nothing new is fetched and nothing about the repository is
persisted beyond six integers (Rule 26). `context_candidates_available` is the
one that de-saturates the existing metric: it makes "the brief was clipped"
distinguishable from "the repository offered exactly twelve".

`economy/cost-drivers.ts` splits measured spend across the three components that
are actually metered — model, validation, infrastructure — and carries
repository size **alongside** them as a correlate, deliberately not as a fourth
share. A "50% Repository Context" slice would be a category error: repository
size is not a billed component, and its entire cost effect is already inside the
model share. Counting it again would double the model spend in every total and
under-state the one component that dominates every run in this table. The
honest statement, once n allows it, is a regression — which needs the two as
separate quantities on the same row, which is the shape that exists now.

These columns are null for every run in the table above, including run #9: they
did not exist when those runs happened, and null is not zero. The first run that
records them is the first data point.

### Same step, same price, 2× the cost (Sprint 0053, 2026-08-20)

Run #9 re-ran run #6's Action Step. Byte-identical `step_key`, on a real
persisted plan step, classifying to the same Execution Pricing Class.

| | Run #6 | Run #9 |
|---|---|---|
| Wall clock | 79.9s | **201.5s** |
| Provider calls | 10 | **14** |
| Model spend | $0.1444 | **$0.3115** |
| Unique files read | 4 | **14** |
| Files read outside the brief | 0 | **4** |
| Brief candidates sent | 6 | **12 — the cap, exactly** |
| **Cost floor** | **$0.1739** | **$0.3470** |

**2.00× at the floor, 2.16× in model spend, with no change to the task.**

The longer run is correct behaviour, not a regression. The agent read exactly
the files this repository had gained since run #6 — `src/app/robots.ts`
(changed by the domain migration), `src/app/robots.test.ts` (new) and
`src/lib/env/app-url.ts` (new) — all inside the step's own subject area, then
wrote its own regression test and ran it. More context was read because more
relevant context now exists.

**The pricing consequence.** Sprint 0052's price-stability property still holds
and is still correct: a quote reads `riskClass`, `changeKind` and `evidenceIds`
before execution, so both runs quote *identically*. That is precisely why this
matters commercially rather than being self-correcting — the same price was
charged for twice the cost, and nothing in the quote could have known.

**The mechanism, and why it was invisible.** `context_candidates_sent` went
6 → 12 against `BRIEF_BUDGET.maxCandidates = 12`. The metric is **saturated**:
it cannot distinguish a repository offering twelve relevant files from one
offering fifty. Every `context_*` column measures what Vibe *sent* — a bounded,
Vibe-controlled compression — and none measured how large the thing being
compressed was. Sprint 0053 added that (see PART D below).

**What this does not license.** One observation. It establishes that cost is a
function of repository state, not the size of that function. A regression of
model spend against repository size needs n large enough to fit one, which is a
PART Q checkpoint rather than a number available today.

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

# Economy Intelligence (Sprint 0054)

Everything above measures runs that already happened. This chapter is about the
two questions a Credit system actually rests on:

- Before an agent starts: *what will this improvement probably cost?*
- After it finishes: *how wrong was that guess, and why?*

The engine lives in `src/modules/economy/intelligence/`. It is analysis only:
no migration, no persistence, no UI, no wiring into the execution flow, and
`CREDIT_RATE_CARDS` is still `[]`. See
[ADR 0038](../decisions/0038-economy-intelligence-layer.md).

## What already existed, and what was missing (PART A)

**Sufficient already.** Model spend to the nanodollar (`ai_usage_events`, priced
by `ai/pricing.ts`). Sandbox time (`sandbox_usage_events`, priced by
`sandbox-cost.ts`). The pre-execution classification inputs — `risk_class` from
`execution_specs`, `change_kind` and `evidence_ids` from `action_plan_steps`,
surfaces from `deriveExecutionSurfaceRequirement`. Validation shape from
`stepsForDepth`.

**Only needed connecting.** The pricing classifier existed and had exactly one
caller in the entire repository: `historical-runs.ts`, replaying the past. It
had never been asked about a run that had not happened yet.

**Genuinely missing.** Repository size on any delivered run — see *The gap that
decides everything* below.

## Predictive economics

`estimateExecutionEconomics` scales a historical baseline drawn from comparable
runs by three bounded terms:

| Term | Source | Bound |
|---|---|---|
| Repository complexity | tree entries, routes, candidate supply against a reference scale | 0.75×–1.75× |
| Repository drift | movement since the last execution | 1.0×–1.15× |
| Validation depth | assumed wall time, applied to the validation share only | ±15% of the estimate |
| Cohort correction | systematic bias for this class of work | 0.8×–1.25× |

Two properties are enforced by tests rather than by care.

**It cannot see what a run produced.** No tokens, no runtime, no sandbox
milliseconds, no usage row — a source scan checks for the identifiers. An
estimator that can reach actuals eventually becomes a bill, and then
prediction-versus-reality compares a number against itself and reports perfect
accuracy forever.

**Without a baseline it produces nothing.** A five-million-entry repository with
no comparable run estimates `unknown`, not a large number. That is what makes
"repository size alone produces no price" structural rather than aspirational.

The validation share is 0.15, derived rather than picked: the floor-to-upper band
on a delivered run *is* the validation active-CPU component, and it averages
$0.0484 across the six validated runs against a mean floor of $0.3041 — 15.9%.
Scaling the whole estimate by a depth ratio instead would have repriced model
spend because the test suite got shorter, by about 20% at `fast`.

## Repository context and drift signals

Two signals, deliberately not one.

**Complexity** — *how big is this at one commit?* A 100,000-file repository where
the step edits a README is large and cheap.

**Volatility** — *how much did it move since the last run?* This is what run
#6 → #9 actually was: same step, same class, 2.16× the model spend, against a
repository that had grown three files the step needed.

Neither contains a nanodollar amount, and a test asserts it. Repository size is
not billed by anyone; its entire cost effect is already inside the model spend,
so giving it a slice of the same total counts the money twice.

**Context pressure** is the third, and the one size cannot see:

```
candidatePressure = candidatesAvailable / candidatesSent
```

Because `candidatesSent` saturates at the brief cap of 12, a repository offering
200 relevant candidates and one offering exactly 12 are identical on that column
alone. When `candidatesAvailable` is unrecorded the ratio is `null` — never 1,
which would read as "nothing was discarded", the one conclusion the data cannot
support.

## Prediction vs reality

`deriveActualExecutionEconomics` splits a completed run into model, agent
sandbox, validation and infrastructure. Exactly one component may be `measured`:
the provider figure. Everything rate-derived is `estimated` however precisely
computed, and a test enforces it — a rate-derived number stamped measured is
indistinguishable from an invoice in every downstream reader.

Measurement confidence tops out at **medium** today, and that is the honest
answer: `sandbox_usage_events.provider_cost_usd` is null in every row Vibe has
ever written.

`compareEstimateToActual` answers comparability explicitly. An unpredicted run is
incomparable rather than infinitely wrong; a cost that is only a floor teaches
nothing; and an estimate made under one economy model version is never compared
against costs incurred under another, which would measure the version change
instead of the prediction.

**Variance explanation.** A variance is attributed only to signals that moved in
the same direction as it, from a closed vocabulary, citing measured quantities —
no generated prose, nothing interpolated from repository or website content.
`unexplainedShare` reports what the named reasons do not account for. A run 40%
over against a repository that did not move gets *no* reasons and an unexplained
share of 1, because a layer that always produces an explanation is a layer whose
explanations mean nothing.

Run #6 → #9, as the engine explains it:

> 42% more than expected, because the repository moved by 35 files and 6 relevant
> candidates since the last execution, and context pressure became severe — the
> brief could not carry every relevant candidate.

## Historical learning and cohort bias

Every delivered run is estimated against the dataset **without itself**. A
backtest that lets a run predict itself is a memory test.

| Run | Predicted | Actual | Error |
|---|---|---|---|
| #3 | $0.2863 | $0.4331 | **+51.3%** |
| #4 | $0.3151 | $0.2845 | −9.7% |
| #5 | $0.3016 | $0.3542 | +17.4% |
| #6 | $0.3366 | $0.1739 | **−48.3%** |
| #7 | $0.3134 | $0.2821 | −10.0% |
| #8 | $0.3125 | $0.2541 | −18.7% |
| #9 | $0.3030 | $0.3470 | +14.5% |

**Mean absolute error 24.3%. Worst case +51.3%. No systematic bias** — three
under, four over, median −9.7%.

That is not good, and the reason is visible rather than mysterious. With no
repository context the estimator is predicting little more than a class mean, and
runs #3 and #6 are the *same step* 2.5× apart. The fix is evidence, not a
cleverer formula.

`detectCohortBias` is what makes this a loop rather than a report: it groups
observations by pre-execution fields and detects a class of work being
mispredicted the same way every time. Below 20 comparable observations the answer
is exactly 1 — not a hedged 1.08 fitted to seven points. **Every cohort in
today's dataset is below the floor**, so the machinery is the deliverable and the
numbers are not yet.

## Safety margin

Expected cost is what Vibe predicts; **protected cost** is what Vibe plans
against because the prediction might be low.

| Confidence | Buffer |
|---|---|
| none | 50% |
| low | 30% |
| medium | 15% |
| high | 5% |

It is called protected rather than safe because it claims nothing about the run:
a $0.30 estimate at LOW confidence with a 30% buffer says Vibe plans against
$0.39 of risk, not that the run costs $0.39. It is internal, and
`quote-simulation.ts` does not read it — charging a customer for Vibe's
uncertainty is a decision nobody has made.

## Simulation, with the fourth axis

`stress-test.ts` varied provider inflation, infrastructure inflation and failure
rate. It could not vary repository growth, because that axis did not exist when
it was written — which meant it could not express the one cost movement Vibe has
actually observed in production.

Model C, simulated prices, gross margin per delivered run:

| Scenario | Margin | |
|---|---|---|
| current | 89.4% | acceptable |
| AI provider +100% | 80.3% | acceptable |
| infrastructure +100% | 87.8% | acceptable |
| failure rate 40% | 84.4% | acceptable |
| repository 2× | 84.0% | acceptable |
| repository 5× | 81.4% | acceptable |
| **everything at once** | **59.0%** | **watch** |

Every axis alone is survivable. All four together land 16 points below the 75%
target, and that number exists only because growth is now one of the axes.

One limitation stated rather than hidden: past roughly 5× growth the repository
policy's ceiling is doing the work instead of the evidence, so the simulation
cannot distinguish a 5× product from a 10× one.

## The gap that decides everything

**No delivered run carries repository size.** The `repo_*` and
`context_candidates_available` columns were added by
`20260820200000_repository_context_size.sql` — 2026-08-20T20:00Z. Run #9, the
newest, was created at 15:07Z the same day.

So the backtest above exercises the historical term and **cannot exercise the
repository or drift terms at all**. No Supabase read can recover the data; it was
never written. `metric-availability.ts` now records this, so a later analysis
reads `unavailable` rather than averaging seven nulls into a repository of size
zero.

`context_candidates_sent` is the one exception, landing a day earlier, so runs
#6–#9 carry it — which is what makes the 6 → 12 candidate movement a measurement.

---

## Missing metrics

| Gap | Consequence | Fixable by |
|---|---|---|
| ~~Rate card unverified~~ | ~~Sandbox cost is estimated, not confirmed~~ — **resolved**: `founder_attested` by Vibe's own founder on 2026-08-20, after three failed environment-side attempts and one rejected AI-relayed claim | done |
| Validation `active_cpu_ms` not recorded — **RE-OPENED (Sprint 0053)** | Validation cost still has a floor and a bound, on new runs as well as old. Sprint 0051 marked this resolved. It was not: the deployment carrying that fix went live at 15:00:59 on 2026-08-20 and the validation row written **sixteen minutes later** (run #9) still records `active_cpu_ms: null`, identical to every pre-fix row. Nothing surfaced it because `readTerminalUsage`'s `catch` was completely silent — the defect hid an entire sprint behind a bare `catch`. | Sprint 0053 moved the usage read to **before** `snapshot()` terminates the sandbox, and made both failure modes log. **Not yet verified in production** — this environment has no Vercel Sandbox credential, so it is confirmed only by the next real run recording a non-null value |
| ~~`tool_calls_allowed` / `files_read` always 0~~ | ~~Tool use untestable~~ — **resolved**: correct as gateway counters; harness activity derived from `agent_execution_events` | done |
| Historical runs #3–#8 have no validation point estimate | The six existing runs keep floor + upper bound forever | Not fixable — no second copy of the number exists to recover |
| Vercel Functions / Workflow invocation cost not instrumented | Immaterial under real prices too — 0.19–0.94% of a delivered run, event rate now attested, per-step duration still an explicit assumption | Not pursued — see PART H, Sprint 0051 and its addendum; revisit only if invocation count grows materially |
| n = 7 | Correlations are thin; the PART D table above is still the n=6 computation | More runs |
| Repository size unmeasured for every run in the dataset | The one cost driver run #9 identified cannot yet be quantified — **and now measurably so**: Sprint 0054's backtest exercises the historical term and cannot exercise the repository or drift terms at all, which is most of why mean absolute error sits at 24.3% | The columns exist as of Sprint 0053; the next run is the first observation. `metric-availability.ts` now records the dates, so this reads as `unavailable` rather than as seven zeroes |
| All 12 runs `non_production_economics` | No production-rate data at all. Note `execution_origin = 'planner'` does **not** make a run production-rate — the flag is set by the internal dogfood allowlist path (`coding-agent/authorization.ts`), so run #9 looks like production traffic and is not | A production run |

---

## Sprint 0052 — Credit Economics v1 (simulation only)

Full design, simulation and recommendation now live in
[CREDIT_PRICING_V1.md](CREDIT_PRICING_V1.md). Nothing in that document is
activated: `CREDIT_RATE_CARDS` is still `[]`, no Stripe/Reservation/Settlement
logic changed, no real Credit moved. Two things from it correct this
document's own numbers rather than restating them silently:

**The historical failure count was 5, not 2 or 3.** This document's "Failed
runs cost real money" section above (PART C-era analysis) named two failed
runs by model cost ($0.3085, $0.6158), and the "Cost per delivered run,
revised" section named a third once sandbox cost was added ($0.0060). Both
were correct descriptions of "failures that cost money" — but a direct
`select status, count(*) from agent_execution_runs group by status` on
2026-08-20 (Sprint 0052) found **5 failed rows, not 3**: two additional
attempts failed at provisioning with zero measurable cost (no sandbox wall
duration, no billed model call), so a tally built by listing costly failures
correctly never mentioned them. A failure **rate** has to count all attempts,
costly or not: **5 failed / 11 total = 45.5%**, not the ~25–33% a reader
would infer from this document's own earlier sections. The effective cost
per delivered run is unaffected ($0.4749 independently re-derived here,
matching the $0.4752 already pinned in `workflow-invocation-cost.test.ts` to
within half a cent) — only the *rate* changes, because the two zero-cost
failures do not move a sum but do move a count.

**Superseded arithmetic, same reasoning (Sprint 0053).** Run #9 delivered, so
the same direct query now returns 5 failed / 7 succeeded: the rate is
**5/12 = 41.7%**, and effective cost per delivered run is **$0.4566**. The
5/11 figure above is left standing as the record of what Sprint 0052 found —
it was right on the day. Nothing in `economy/failure-economics.ts` is
hardcoded to either number; both derive from `HISTORICAL_RUNS.length` and
`FAILED_ATTEMPT_COSTS`, so a delivered run moves the rate and the tests catch
the move.

**Three Execution Pricing Classes now exist** (`economy/execution-class.ts`):
`small`/`standard`/`complex`, derived from `riskClass` + `changeKind` +
`evidenceIds` only — pre-execution, deterministic, price-stable. All six
historical runs classify as `standard` (5, evidence implies one named
surface) or `small` (1, run #8, no named surface). **`complex` has zero
historical coverage** — see `CREDIT_PRICING_V1.md` §5/§11 for why that
materially limits confidence in any `complex`-tier price.

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
   stay whole — price against $0.4047, not $0.2507. **Quantified further by
   Sprint 0052**: the real failure rate is 45.5% (5 failed / 11 total, not the
   ~25–33% implied above), and `CREDIT_PRICING_V1.md` §8 shows every simulated
   rate card still clears its own failure-adjusted margin at that real rate.
   **Updated by Sprint 0053**: 41.7% (5 / 12) after run #9 delivered — the
   conclusion is unchanged and the direction is favourable, but a rate that
   moves four points on one run is a rate with an n problem, not a rate that
   improved.
4. **Redo the Credit sizing in CREDIT_ECONOMICS.md** against $0.25/run rather
   than the modelled $15.
5. **Sonnet 5 rises 50% on 2026-09-01** (already in `ai/pricing.ts`). Mean run
   cost moves from $0.2507 to roughly $0.376 with no code change. **Sprint
   0052's stress test confirms this is the dominant margin risk** — a 50% AI
   provider inflation drops the most conservative simulated rate card to
   63–71% margin, far more than an equivalent infrastructure-cost shock.
6. **Re-measure after Sprint 0047.** Risk-adaptive validation skips the unit
   suite on a `fast` run — 87s of the 311s validation microVM. None of the runs
   above ran under that policy.
7. **Choose a v1 Credit Rate Card.** Sprint 0052 simulated three candidates
   and recommends Model C (small=200/standard=300/complex=500 Credits,
   ~75% target margin) at **LOW confidence** — n=6, one `small` observation,
   zero `complex` observations. Verdict: **NOT READY TO IMPLEMENT**, pending
   more delivered runs across a wider evidence-family mix. See
   `CREDIT_PRICING_V1.md` for the full simulation and reasoning. **Unchanged by
   Sprint 0053**: n is now 7, `small` still has one observation and `complex`
   still has zero, so no checkpoint moved and the recommendation was not re-run.
   Run #9 adds a new *kind* of doubt rather than removing an old one — see the
   same-step cost variance above.
