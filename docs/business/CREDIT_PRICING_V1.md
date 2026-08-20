# Credit Pricing v1 — Design and Simulation

**Status: analysis and simulation only.** No `CREDIT_RATE_CARD` is activated by
this document. `credits/rating.ts`'s `CREDIT_RATE_CARDS` is unchanged and
still `[]`. No Stripe logic, no Reservation/Settlement logic, and no real
Credit balance changed. Every number below comes from either a pure function
in `src/modules/economy/` (all listed, all tested, none wired into billing)
or a direct 2026-08-20 read of Supabase project `dcbwlctscooefwnivxzv`.

This is Sprint 0052, the direct continuation of the "economy sprint" chain —
0049 (Business Audit unit economics), 0050 (agent execution unit economics,
backfilled), 0051 (sandbox metering fix, rate-card founder attestation). Those
sprints answered "what does a run cost Vibe?" This one answers "what would
Vibe charge, and does the number make sense?" — and stops there. Nothing here
authorizes charging anyone.

---

## Addendum — Sprint 0053, 2026-08-20

**n is now 7.** Run #9 delivered after this document was written, and is in
`economy/historical-runs.ts` and `ECONOMY_MODEL.md`'s PART I table.

**Nothing below was re-run, deliberately.** Every margin, mean and stress
figure in this document is a computation over the **six** runs available on the
day, and is left stated that way. Restating them as seven-run figures without
re-running them would be a fabrication; re-running them on one extra
observation would be motion, not evidence. One run does not move a checkpoint —
§13's own checkpoints are 25, 50 and 100.

**Three things this document should say differently, and now does:**

1. **The failure rate is 5/12 = 41.7%**, not 5/11 = 45.5%. Run #9 delivered;
   no failure was reclassified. `economy/failure-economics.ts` derives this
   rather than storing it, so §8's conclusion — every simulated card clears its
   own failure-adjusted margin — holds a fortiori at the lower rate.

2. **`execution_origin = 'planner'` does not mean production-rate.** All **12**
   runs still carry `non_production_economics = true`, set by the internal
   dogfood allowlist path (`coding-agent/authorization.ts`). Run #9 was
   planner-originated and looks like customer traffic in every column except
   that flag. §12's "no production-rate data exists anywhere" is unchanged, and
   is worth re-reading with run #9 in mind.

3. **A new kind of doubt, not a resolved one.** Run #9 re-ran run #6's Action
   Step — same `step_key`, same pricing class, same quote — and cost **2.00× at
   the floor, 2.16× in model spend**, because the repository had grown three
   relevant files underneath it. §10's price-stability proof still holds and is
   still correct; that is exactly what makes this a finding. The same price was
   charged for twice the cost, and the quote could not have known. See
   `ECONOMY_MODEL.md` → "Same step, same price, 2× the cost".

**The verdict is unchanged: NOT READY TO IMPLEMENT.** `small` still has one
observation, `complex` still has zero, and the recommendation below stands
exactly as written.

---

## Addendum — Sprint 0054, 2026-08-20

**Credits remain deactivated. Economy Intelligence is prepared.**

`CREDIT_RATE_CARDS` in `credits/rating.ts` is still `[]`, `resolveRateCard`
returns null at every instant, and no Stripe, wallet, balance, top-up,
reservation or settlement logic changed. `src/modules/economy/sprint-0054-safety.test.ts`
is the executable form of that sentence.

What changed is that the numbers in this document are now answerable to
something. Sprint 0054 built a predictive layer — see
[ECONOMY_MODEL.md](ECONOMY_MODEL.md#economy-intelligence-sprint-0054) and
[ADR 0038](../decisions/0038-economy-intelligence-layer.md) — and three of its
findings bear directly on the recommendation below.

**1. The estimator is off by about a quarter, and the reason is the dataset.**
A leave-one-out backtest over runs #3–#9 gives 24.3% mean absolute error and
+51.3% at worst, with no systematic bias. Runs #3 and #6 are the *same step*
2.5× apart. This does not weaken the execution-class model — §12's price
stability argument is unaffected, because a class quote is deliberately *not* a
cost estimate — but it does say how far a per-run cost prediction currently is
from being usable for a maximum-authorization ceiling.

**2. Repository growth is now a stress axis, and it is the one that bites.**
§9's stress tests could not vary it. With it included, Model C holds above 75%
on every single axis — provider +100% at 80.3%, failure rate 40% at 84.4%,
repository 5× at 81.4% — and lands at **59.0%** with all four compounded. The
"combined stress" figure in §9 (76.7%) was computed without a growth term and
should be read as the three-axis number it is.

**3. Credits still price a class, and the engine reinforces why.** A
cost-derived Credit figure would have moved 2.16× between run #6 and run #9 for
a byte-identical step. `simulatePreRunQuote` therefore reads the class, never the
estimated cost, and returns `null` Credits unless a caller names one of the
hypothetical A/B/C scenarios from `credit-rate-card.ts`. Its `activated` field is
the literal `false`.

**What the predictive layer adds for a later settlement sprint.** A
`PredictionSnapshot` type that replays to its own estimate exactly, so a quote
can be explained six months later; a protected cost that buffers by confidence
for Vibe's internal planning and is never customer-facing; and a clamped
adjustment proposal that no code applies.

**The verdict below is unchanged.** Confidence is still LOW, n is still 7, the
`complex` class still has zero observations, every run is still
`non_production_economics`, and no rate card is activated. Sprint 0054 did not
make the recommendation stronger — it made the evidence behind it measurable,
and measuring it lowered rather than raised the case for acting now.

---

## 1. The Product Unit

Vibe does not sell tokens, model time, provider calls, tool calls, sandbox
minutes, or changed bytes. It sells **`validated_agent_improvement`**:

```
Planner Step → Agent Execution → Prepared Change → Independent Validation
                                                     = validated Prepared Change
```

A customer pays for the last box, not for what filled it. This is not a
slogan — it is the reason PART A below excludes every metric that exists only
*inside* the box (tokens, duration, tool calls) from the pricing input. A
price that depended on those would charge the customer for how inefficiently
the agent happened to work, which is Vibe's problem to solve, not the
customer's to fund.

## 2. Why not token-based

Sprint 0050's own PART D finding, reused here rather than re-derived: across
the six historical runs, provider cost correlates **r = 0.960** with
cache-token volume and **r = −0.035** with changed files, **r = −0.219** with
changed bytes. Run #7 changed eight files for $0.2515; run #3 changed two for
$0.3465. **Cost tracks how much context the agent re-read, not what the
customer received.** A per-token or per-call price would bill the customer
for Vibe's own context-management overhead — the opposite of what "buying a
validated improvement" means.

## 3. The Execution-Class model

Three classes, not a scoring engine: `small`, `standard`, `complex`
(`economy/execution-class.ts`, exported as `ExecutionPricingClass` —
deliberately *not* named `ExecutionClass`, because that symbol already exists
in `execution-contract/schema.ts` for an unrelated concept, the agent's
*capability* class, currently fixed at `application_code_change`. Reusing the
name would have made the two collide in any file that needed both).

Escalate-first, mirroring the same doctrine `execution-contract/risk.ts` and
`validation/depth.ts` already use for adjacent decisions — no input
combination can talk a risky or broad step down to a cheaper class:

1. Non-mutating `changeKind` → no class at all (never reaches agent execution, never priced)
2. `riskClass` is `high`/`prohibited` → `complex`
3. Cited evidence names a sensitive surface (`SENSITIVE_EVIDENCE_PREFIXES`, exported from `validation/depth.ts` for exactly this reuse — one taxonomy, not two that could drift) → `complex`
4. Cited evidence implies ≥2 named business surfaces → `complex`
5. Cited evidence implies exactly 1 named business surface → `standard`
6. A mutating step cites no evidence at all → `standard` (escalate on silence, never the cheapest tier)
7. Public-pages-only, zero named surfaces → `small`

## 4. Classification inputs — what is trusted, and what was rejected

**Used**, because each is resolved before the agent starts and is immune to
prompt injection (Vibe-minted evidence ids, not model prose):

- `riskClass` — computed by `classifyExecutionRisk` in `buildExecutionSpec`, before `persistAgentExecutionSpec`, before the agent runs at all.
- `changeKind` — the trusted Action Step field.
- `evidenceIds` — validated at planning time against the evidence pack; a model can cite Vibe's ids, never invent one.
- The Execution Surface Requirement's `surfaces` (`execution-context/surface.ts`'s `deriveExecutionSurfaceRequirement`) — itself a pure function of `changeKind` + `evidenceIds`, so it adds no new trust surface.

**Rejected**, and why:

- **`resolveValidationDepth`'s full depth** — not purely pre-execution. Its
  strongest signal, `sensitiveDomainsIn(changedPaths)`, needs a Prepared
  Change's `changedPaths`, which do not exist before the agent runs. Using it
  would make price depend on what the agent actually touched — the exact
  thing PART 8 (price stability) below forbids.
- **Actual tokens, duration, tool calls, cache tokens, changed-file count** —
  post-execution by definition, and §2 above is the empirical case for why
  they would price the wrong thing even if they were available early.
- **Task title / free prompt prose** — not a machine API; a reworded step
  could talk itself down a tier. Never read by this classifier.
- **Agent's own final message** — the agent narrating its own diligence is
  not evidence of anything; §41 of this repository's working agreement
  ("model output must never control...") applies here as much as to commit
  messages.

## 5. Historical classification of runs #3–8

Read directly from Supabase on 2026-08-20 — `agent_execution_runs` joined to
`execution_specs` joined to `action_plan_steps`, `status = 'succeeded'`, in
creation order (`economy/historical-runs.ts`).

| Run | Task | Structured signals | Surfaces | Proposed class | Confidence | Cost floor | Cost upper |
|---|---|---|---|---|---|---|---|
| #3 | Add robots meta directives to public and signed-in pages | `moderate` / `product_change` / `live.seo.robots_meta_missing` | `[seo_metadata]` | **standard** | confirmed | $0.4331 | $0.4814 |
| #4 | (same plan step, retried) | same | `[seo_metadata]` | **standard** | confirmed | $0.2845 | $0.2845¹ |
| #5 | (same plan step, retried) | same | `[seo_metadata]` | **standard** | confirmed | $0.3542 | $0.4027 |
| #6 | (same plan step, retried — the run that passed) | same | `[seo_metadata]` | **standard** | confirmed | $0.1739 | $0.2245 |
| #7 | Add canonical URLs to public pages | `moderate` / `product_change` / `live.seo.canonical_missing` | `[seo_metadata]` | **standard** | confirmed | $0.2821 | $0.3289 |
| #8 | Improve the primary landing-page call to action | `moderate` / `product_change` / `live.conversion.primary_cta` | `[]` | **small** | **limited²** | $0.2541 | $0.3017 |

¹ Run #4 was never validated (no Prepared Change reached validation), so its
floor and upper bound are identical — there is no validation-sandbox
component to bound.

² Run #8's `action_plan_steps` join is `null` (`step_key
'dogfood-fixture--low-ui-primary-cta'` never persisted a plan step — it is a
dogfood benchmark run, `coding-agent/dogfood/fixtures.ts`'s
`LOW_UI_PRIMARY_CTA`). Its `changeKind`/`evidenceIds` are read from the
fixture's own source instead of a persisted step — exact values, but
reconstructed from a different table than a production classification would
read, so it is marked `limited` per this sprint's own rule rather than
guessed into `confirmed`.

**No historical run reaches `complex`.** All six share `riskClass=moderate`,
`changeKind=product_change` — zero variance on those two axes — and cite at
most one named surface. This is the sprint's single most consequential
honest finding: **the `complex` tier has zero empirical cost coverage.** Its
pricing below is a structural/policy judgment, not something six runs of
real data can validate.

A second, narrower honesty note: run #6's *actual* changed files included an
authenticated-area layout (`src/app/app/layout.tsx`, per Sprint 0047's
benchmark), even though `live.seo.*` evidence never implies the
`authenticated_pages` scope (a pre-existing Sprint 0044 mapping gap, not
something this sprint patches). A pre-execution-priced run can in principle
touch more surface than its own evidence implied — a real pricing risk,
named rather than fixed here.

## 6. Credit unit and rate-card scenarios

`RETAIL_NANO_USD_PER_CREDIT = $0.01` (`economy/credit-rate-card.ts`) — a
**product/sales** simulation value, never Vibe's infrastructure cost per
Credit. The two stay structurally separate throughout this document, the
same way `economy/run-economics.ts`'s existing `CreditScenario` already keeps
them apart for its own flat cost-plus-margin model.

Three scenarios, exactly as specified — simulated, not decided:

| Model | Small | Standard | Complex |
|---|---|---|---|
| **A — Entry/Aggressive** | 100 Cr ($1.00) | 200 Cr ($2.00) | 350 Cr ($3.50) |
| **B — Balanced** | 150 Cr ($1.50) | 250 Cr ($2.50) | 450 Cr ($4.50) |
| **C — Margin Focused** | 200 Cr ($2.00) | 300 Cr ($3.00) | 500 Cr ($5.00) |

## 7. Per-run margins (PART G)

Every historical run under every model — `economy/credit-rate-card.ts`'s
`simulateAllHistoricalRuns()`, 18 rows. Margin is shown against both the cost
floor (best case) and the cost upper bound (worst case within what is
actually known — validation active CPU is unmeasured for these six runs;
Sprint 0051's point-estimate fix applies only forward).

| Run | Class | Model A margin (floor/upper) | Model B margin (floor/upper) | Model C margin (floor/upper) |
|---|---|---|---|---|
| #3 | standard | 78.3% / 75.9% | 82.7% / 80.7% | 85.6% / 84.0% |
| #4 | standard | 85.8% / 85.8% | 88.6% / 88.6% | 90.5% / 90.5% |
| #5 | standard | 82.3% / 79.9% | 85.8% / 83.9% | 88.2% / 86.6% |
| #6 | standard | 91.3% / 88.8% | 93.0% / 91.0% | 94.2% / 92.5% |
| #7 | standard | 85.9% / 83.6% | 88.7% / 86.8% | 90.6% / 89.0% |
| #8 | small | 74.6% / 69.8% | 83.1% / 79.9% | 87.3% / 84.9% |

Every model is profitable on every historical run in isolation, even at the
upper cost bound. That is expected and not yet the interesting number — none
of this table charges anyone for the *failed* attempts around these runs.

## 8. Failure economics (PART H) — a correction, stated once

`docs/business/ECONOMY_MODEL.md` names three failed runs by cost ($0.3085,
$0.6158 model-only; $0.3794, $0.6842, $0.0060 once sandbox is added). This
sprint's own charter says to verify such figures against the current
repository state rather than take them from a prompt — so `agent_execution_runs`
was queried directly:

```sql
select status, count(*) from agent_execution_runs group by status;
-- failed: 5, succeeded: 6
```

**Five failed attempts, not two or three.** Two of them recorded genuinely
zero measurable cost — no sandbox wall duration, no billed model call,
because they failed at provisioning before anything billable happened. That
is why earlier sprints' prose only ever named three: a tally of "failures
that cost money" correctly never mentioned the two that didn't. A failure
**rate**, which is what pricing coverage needs, has to count all five
attempts. This is a correction to the historical record, not a rewrite of
what those sprints measured under the question they were asking.

| | Value |
|---|---|
| Delivered runs | 6 |
| Failed attempts | **5** |
| Total attempts | 11 |
| **Historical failure rate** | **45.5%** (5/11) |
| Delivered floor (sum) | $1.7819 |
| Failed floor (sum) | $1.0672 |
| Total floor | $2.8491 |
| **Effective cost per delivered run** | **$0.4749** |
| Failure overhead per delivered run | $0.1779 |

$0.4749 is within half a cent of the $0.4752 figure already pinned in
`workflow-invocation-cost.test.ts` — the same underlying data, independently
re-derived; the tiny gap is rounding in intermediate display, not a
different dataset.

### Does each rate card cover its own failure overhead?

`economy/failure-economics.ts`'s `calculateDeliveredRunMargin` — average
revenue across the six delivered runs' real class mix, minus the
failure-adjusted effective cost of $0.4749:

| Model | Avg revenue/delivered run | Failure-adjusted cost | Gross profit | **Failure-adjusted margin** |
|---|---|---|---|---|
| A | $1.83 | $0.4749 | $1.36 | **74.1%** |
| B | $2.33 | $0.4749 | $1.86 | **79.6%** |
| C | $2.83 | $0.4749 | $2.36 | **83.2%** |

All three clear their own failure overhead. The gap between "margin on one
run in isolation" (§7) and "margin once failures are priced in" (here) is
material — 4–11 points — and is exactly the number a rate card decision has
to use, not the optimistic per-run figure.

## 9. Stress tests (PART I)

`economy/stress-test.ts`. Failure rate scales cost via
`f / (1 - f)` expected failed attempts per delivered run; AI and
infrastructure inflation scale the real historical provider-cost and
sandbox-cost components independently (`ai/pricing.ts` already schedules a
50% Sonnet rise on 2026-09-01 — this is not a hypothetical axis).

| Scenario | Model A margin | Model B margin | Model C margin |
|---|---|---|---|
| Failure rate 10% | 82.5% | 86.3% | 88.7% |
| Failure rate 20% | 80.9% | 85.0% | 87.6% |
| Failure rate 30% | 78.8% | 83.4% | 86.3% |
| Failure rate 40% | 76.0% | 81.2% | 84.5% |
| Failure rate 50% | 72.2% | 78.1% | 82.0% |
| Infra current | 74.1% | 79.6% | 83.2% |
| Infra +25% | 73.1% | 78.9% | 82.6% |
| Infra +50% | 72.2% | 78.1% | 82.0% |
| Infra +100% | 70.3% | 76.6% | 80.8% |
| AI current | 74.1% | 79.6% | 83.2% |
| AI +25% | 68.6% | 75.3% | 79.7% |
| AI +50% | 63.1% | 71.0% | 76.1% |
| AI +100% | 52.0% | 62.3% | 69.0% |
| **Combined (AI+50%, Infra+50%, Failure 40%)** | **64.1%** | **71.8%** | **76.7%** |

The isolated failure-rate axis alone never drops below 72% for Model A even
at a hypothetical 50% failure rate — because the historical rate (45.5%) is
already close to that and already priced into every margin above. **AI
provider inflation is by far the largest single risk to margin** — a 100%
AI-price rise alone drops Model A to 52%, well below any credible target,
while the equivalent infrastructure shock only costs 4 points. This matches
the composition finding from Sprint 0050: model spend, not sandbox time, is
the dominant real cost.

## 10. Margin targets (PART J)

`economy/stress-test.ts`'s `evaluateMarginTargets`, checked against
70/75/80/85% — a margin only "meets" a target if *every one* of average,
median, worst-case, failure-adjusted, and combined-stress margin clears it:

| Model | Avg | Median | Worst-case | Failure-adj | Combined stress | 70% | 75% | 80% | 85% |
|---|---|---|---|---|---|---|---|---|---|
| A | 80.6% | 81.7% | 69.8% | 74.1% | 64.1% | ✗ | ✗ | ✗ | ✗ |
| B | 85.2% | 85.4% | 79.9% | 79.6% | 71.8% | ✓ | ✗ | ✗ | ✗ |
| C | 87.9% | 87.8% | 84.0% | 83.2% | 76.7% | ✓ | ✓ | ✗ | ✗ |

Model A fails even 70% — its own worst-case single-run margin (69.8%, run
#8 at the upper cost bound) sits just under the line. **No model clears 80%
once combined stress is applied.** Model C is the only one that clears 75%
on every dimension including combined stress.

## 11. Economic sensibility check (PART K)

`economy/class-cost-analysis.ts`. The real question: are `small` and
`standard` different enough in cost to justify different prices, and is
`complex`'s premium backed by anything?

| Class | n | Mean floor | Std dev |
|---|---|---|---|
| small | 1 | $0.2541 | — (one point, no spread) |
| standard | 5 | $0.3056 | $0.0961 |
| complex | **0** | — | — |

`standard` costs **~20% more** than `small` on average (ratio 1.20) — real,
but modest, and resting on a single `small` observation. Every simulated
rate card prices the *standard-vs-small* premium far above that: 50–100%
(Model A: 2×, Model B: 1.67×, Model C: 1.5×). **That gap is a value-pricing
decision, not a cost-based one — and the sprint's own framing explicitly
allows this** ("a class can deliver much higher customer value while costing
Vibe barely more — that is a value-pricing effect, not an error"). It is
named here so the decision is visible rather than accidental.

`complex`'s premium (75–150% over `standard`, depending on model) is not
even that — it is priced against **zero cost observations**. Nothing in this
sprint's data contradicts the assumption that a multi-surface or
sensitive-surface change costs more to execute and validate (more files,
deeper validation, `sensitive_domain_changed` forcing a `deep` validation
run per `validation/depth.ts`) — but nothing confirms it either. Activating
a real `complex` price on this evidence would be a policy bet, not a
data-backed number, and that has to be stated plainly rather than
implied by the table looking as complete as the other two rows.

## 12. Price stability (PART L)

Proved directly, not asserted: `economy/price-stability.test.ts` runs the
full quote pipeline (`deriveExecutionSurfaceRequirement` →
`classifyExecutionPricingClass` → `simulateCreditRateCard`) against run #3
($0.3465 real spend) and run #6 ($0.1444 real spend) — the same evidence
family, a 2.4× real-cost spread — and asserts an identical Credit quote under
every one of the three models. The quote function is typed to accept only a
pricing class, never a cost; the test proves that boundary holds end to end,
not just at the type level.

The target flow this validates:

```
Step (riskClass, changeKind, evidenceIds)
  → deriveExecutionSurfaceRequirement   (pre-execution)
  → classifyExecutionPricingClass       (pre-execution)
  → simulateCreditRateCard              (pre-execution)
  = a fixed Credit quote
  → [Agent runs, spends whatever it spends] → [Validation]
  → Settlement against the quote, never against a post-hoc price
```

Nothing in this sprint wires that settlement step — Reservation and
Settlement logic (`billing/`) is untouched, as required.

## 13. New pure functions (PART M)

All in `src/modules/economy/`, all pure, none imported by any billing,
Stripe, reservation, or settlement module (verified in
`sprint-0052-safety.test.ts`):

| Function | File |
|---|---|
| `classifyExecutionPricingClass` | `execution-class.ts` |
| `simulateCreditRateCard` | `credit-rate-card.ts` |
| `calculateDeliveredRunMargin` | `failure-economics.ts` |
| `stressTestCreditEconomics` | `stress-test.ts` |
| `analyzeClassCostDifferentiation` | `class-cost-analysis.ts` |
| `reconstructHistoricalClassification` | `historical-runs.ts` |
| `evaluateMarginTargets` | `stress-test.ts` |

## 14. Nothing activated (PART N)

`sprint-0052-safety.test.ts` pins: `CREDIT_RATE_CARDS` is still `[]`,
`resolveRateCard` still returns `null` for real usage at any instant, and
running every simulation this sprint added does not mutate it. No file this
sprint touches contains the string `stripe`, and none imports from
`credits/` or `billing/`.

---

## Recommended v1 Rate Card

**Model C — Margin Focused: `small=200`, `standard=300`, `complex=500` Credits.**

Justification, against every figure computed above:

- **Historical gross margin**: 87.9% average, 87.8% median across the six real runs — highest of the three models.
- **Failure-adjusted gross margin**: 83.2% — the only model that stays comfortably clear of both 70% and 75% once real historical failure spend (45.5% failure rate, not the 2-3 failures earlier prose implied) is priced in.
- **Worst-case single-run margin**: 84.0% — never drops below 80% on any of the six real runs, even at the upper cost bound.
- **Stress-test margin**: 76.7% under the combined stress scenario (AI+50%, infra+50%, failure rate 40%) — the only model that stays above 75% under the worst scenario this sprint tested. Models A and B fall to 64.1% and 71.8% respectively under the same stress.
- **Pricing simplicity**: three numbers, same 1.5×/1.67× step structure as the other two models — no added complexity for the higher margin.
- **Product value**: a 500-Credit ($5.00) complex-tier price is defensible as *product* positioning (a multi-surface or sensitive change is a materially bigger deliverable) even though §11 above shows it is not backed by real complex-tier cost data — Model C's margin cushion on `small`/`standard` (where real data exists) is large enough to absorb a `complex` cost that turns out higher than assumed, which A and B's thinner margins are not.

Model A is not recommended: it fails its own 70% target on worst-case margin
(69.8%) using only real historical data, before any stress is applied at all.
Model B is workable but leaves less margin for the AI-price risk this
document's own stress test shows is the dominant one (a 50% AI-price rise —
plausible, given Sonnet's own scheduled 50% rise on 2026-09-01 — drops Model
B to 71.0%).

**Recommended target margin: 75%.** 80% is not achievable by any simulated
model once realistic combined stress is applied; 70% leaves too little room
for the AI-inflation risk that is already scheduled, not hypothetical. 75%
is the highest target Model C clears on every dimension tested.

### Confidence: **LOW**

Not `MEDIUM` and not a caveat added after the fact — the dataset genuinely
does not support more, and this sprint's own charter said that would be okay.
Specifically:

- **n = 6** delivered runs total, all `non_production_economics = true`. No production-rate data exists anywhere.
- **`complex` has zero cost observations.** Its price is a policy judgment wearing the same table format as the other two rows, which have real data. This is the single largest gap between what this document shows and what it can actually defend.
- **`small` has exactly one observation** (run #8). Its mean, min, and max are the same number; there is no spread to reason about.
- **The historical failure rate (45.5%) is itself n=11**, small enough that a materially different real rate (30% or 60%) would not be a surprise.
- **Run #8's classification is `limited` confidence**, not `confirmed** — it is the entire evidentiary basis for the `small` tier, and it comes from a dogfood fixture, not a persisted plan step.

## Limitations of the n=6 dataset

Every number in this document inherits these, stated once rather than
re-qualified in every section above. As of Sprint 0053 the dataset is n=7; the
list below describes the six runs every figure above was computed over, and
item 7 records what the seventh added.

1. Six delivered runs, five failed attempts, eleven total — a small sample for any rate, ratio, or standard deviation.
2. `complex` (0 runs) and `small` (1 run) are the two tiers this document can say the least about; `standard` (5 runs) is comparatively solid.
3. All data is `non_production_economics = true` — dogfood and benchmark traffic, not paying customers.
4. Only three distinct evidence families appear across all six runs (`live.seo.robots_meta_missing`, `live.seo.canonical_missing`, `live.conversion.primary_cta`) — the real diversity of future customer tasks is unknown.
5. Validation active CPU is unmeasured for all six historical runs (Sprint 0051's fix applies only forward), so every margin above uses a floor/upper-bound pair rather than a single point estimate.
6. `riskClass` and `changeKind` show zero variance across the dataset (all `moderate`/`product_change`) — the escalation rules for `high`/`prohibited` risk and non-mutating steps are entirely untested against real data.
7. **Added by run #9 (Sprint 0053):** cost is a function of **repository state**, not only of the task, and this dataset measures repository state for exactly zero of its runs. The same step at the same class cost 2× more against a repository that had grown three files. `agent_execution_runs` now records `repo_tree_entries`, `repo_files_analyzed`, `repo_bytes_analyzed`, `repo_routes_detected`, `repo_surfaces_detected` and `context_candidates_available`, but every historical row is null — the columns did not exist when those runs happened. This is the largest *newly identified* gap between what this document assumes and what it can defend, and unlike the `complex`-tier gap it is one that more runs alone will not close unless the size is recorded alongside them.
8. **`context_candidates_sent` is saturated** in the runs above. Run #9 sent 12 against `BRIEF_BUDGET.maxCandidates = 12`, so that column cannot distinguish a repository offering twelve relevant files from one offering fifty. Any reasoning in this document that treats it as a measure of task size is reasoning about a capped number.

## Recalibration checkpoints (PART Q)

Not built — deliberately out of scope for a sprint that activates nothing —
but named so v1 has a stated path to becoming v2 rather than staying
permanently provisional:

- **After 25 delivered runs**: re-run `analyzeClassCostDifferentiation` — enough data to put a real standard deviation on `small`, and possibly the first `complex` observations if a customer task ever cites a sensitive surface or spans multiple named surfaces.
- **After 50 delivered runs**: re-run `computeHistoricalFailureEconomics` — the 45.5% historical failure rate is dogfood/benchmark behaviour; production failure behaviour (different task diversity, different repositories) could differ materially in either direction.
- **After 100 delivered runs**: re-run the full stress-test and margin-target evaluation against the *actual* observed class distribution, AI pricing (Sonnet's scheduled rise will have taken effect by then), and infrastructure rate, rather than this document's simulated stress points.
- **On any `complex`-tier run**: treat it as a standing item regardless of count — the first real complex-tier cost observation is the single most valuable data point this pricing model is currently missing, and its cost should be compared against the assumed 1.5–2.5× standard-tier premium the three models embed.
- **On repository-context size, from the first run that records it**: correlate model spend against `repo_routes_detected` / `repo_tree_entries` / `context_candidates_available` using `economy/cost-drivers.ts`. This is the driver run #9 identified and the one input this pricing model currently has *no* observations of. Two specific questions it answers and nothing else can: does a Credit's cost scale with repository size within a class (which would mean a flat per-class price silently cross-subsidises large repositories), and how often is the brief clipped at `maxCandidates` (which would mean the compiler's own cap, not the task, is setting the context bill). Repository size is a **correlate of the model share, never a fourth cost component** — see `cost-drivers.ts`'s own note on why a "50% Repository Context" slice would double-count model spend.
- **On any material rate-card change upstream**: `ai/pricing.ts`'s scheduled Sonnet increase (2026-09-01, +50%) or any founder-attested infrastructure rate change should trigger an immediate re-run of §9's stress table — this document already shows AI inflation is the dominant margin risk, so this is not a hypothetical trigger.

---

## Final verdict

**NOT READY TO IMPLEMENT CREDIT RATE CARD V1** — but closer than any prior
sprint in this chain, and the "not ready" is about statistical confidence,
not about a missing mechanism. Every function a real rate card would need
(`classifyExecutionPricingClass`, `simulateCreditRateCard`,
`calculateDeliveredRunMargin`, `stressTestCreditEconomics`) exists, is
tested, and is proven price-stable end to end. What is missing is data: one
`small` observation and zero `complex` observations is not a foundation for
activating real customer pricing, whatever the margin arithmetic says on top
of it. The recommended next step is not more design work — it is more
delivered runs, ideally spanning a wider evidence-family mix than SEO
metadata and one conversion-copy fixture, followed by a direct re-run of
this same simulation against real numbers rather than a repeat of this
document's reasoning.
