# Sprint 12B — Business Outcome Measurement Foundation

**Status**

| Slice | State |
| --- | --- |
| MeasurementPlan domain, RLS, service, UI | ✅ Complete |
| Vendor-neutral `BusinessMetricSource` abstraction + registry | ✅ Complete |
| Versioned baseline / post-window semantics with explicit timezone | ✅ Complete |
| Minimum-data and neutral-band semantics, per metric, per window | ✅ Complete |
| BusinessOutcomeMeasurement domain + deterministic classification | ✅ Complete |
| Causality safeguards (domain, copy, tests) | ✅ Complete |
| Durable execution + `next_observation_at` scheduling contract | ✅ Complete |
| Tests + 17 deliberate regressions | ✅ Complete (17 killed; 3 survived first pass, all closed) |
| Browser E2E | ✅ 57 chromium tests (25 new), all green |
| Real dogfood | ✅ **Source-required — the honest current state** (dry run; live click blocked on the migration) |
| Migration deployed | ⛔ **Not deployed** — no linked Supabase CLI in this environment |
| Analytics connector | ⛔ Deliberately not built (§49) |

## Goal

Answer the third and last question in the trust loop, and — far more importantly — decline to answer it when the evidence does not support one.

> Did the change improve the business metric it was intended to improve?

## Delivery vs product outcome vs business outcome

```
DELIVERY          the approved change reached the repository     Sprint 11C
PRODUCT OUTCOME   the intended behaviour appeared publicly       Sprint 12A
BUSINESS OUTCOME  the metric it was meant to move, moved         ← this sprint
```

The first two are answerable by observation. The third needs somebody else's data, two elapsed windows, enough traffic, and a control group that does not exist.

All three are now rows in one ladder on screen, and the third is fed by the measurement domain rather than by the constant Sprint 12A left there:

```
Merged                Yes
Production outcome    Verified
Business impact       Not measured — no source
```

## MeasurementPlan

*What would we measure?* — deterministic, free, and answerable the moment a change is merged, with no analytics connection at all. That separation is the reason a project with nothing connected still gets a specific, truthful screen rather than a blank one.

Derived from `(capability, structured business context)`. **No model output**: the opportunity's title and problem text are deliberately not read, exactly as `capabilities.ts` refuses to read them, and for the same reason — model wording is not a machine API.

A capability with no honest metric produces `status = unsupported` with a stated reason. Inventing one would produce a measurement of something nobody intended to change, and it *will* eventually move.

## Metric source abstraction

```
BusinessMetricSource.getMetricSeries({ metric, window, aggregation }) → daily values
```

The engine asks for a metric over a window and receives **daily values**. It cannot learn a vendor's vocabulary, and it cannot be handed a pre-aggregated total — the aggregation is the policy's decision, and two adapters would eventually decide it differently. Daily granularity is also the only thing that makes `dataQuality` answerable: three missing days are invisible in a single total.

Failures are typed rather than thrown — `unauthorized`, `unavailable`, `rate_limited`, `metric_unsupported` — because those are four different sentences and four different next steps.

**No connector is built.** `NoConnectedMetricSources` returns nothing for every project. That is not a stub; it is a truthful statement of the current capability (§7, §49).

## Metric vocabulary

Six categories (`traffic`, `conversion`, `activation`, `revenue`, `retention`, `search_visibility`) and three keys — `search_impressions`, `search_clicks`, `organic_sessions`. Deliberately small: a vocabulary of forty metrics nobody can measure invites plans that can never be executed.

Each key carries its category, direction, aggregation, source kinds, **minimum observations per window** and **neutral band**. A `Record` over the closed union, so adding a key without deciding its minimums is a type error rather than a metric that silently defaults to "higher is better and any movement counts".

## Baseline semantics

```
… 28 complete days …  │ merge day │ … 14 settling days …  │ … 28 days …
◀───── baseline ─────▶│ excluded  │       excluded         │◀ measurement ▶
```

Whole calendar days. **The merge day is excluded from both sides** — partial on the before side, contaminated on the after side. Half-open intervals, so non-overlap is a comparison rather than an off-by-one argument.

The settling gap is capability-specific, because "how long until this could plausibly show up" is a property of what changed. For SEO it is 14 days: a crawler may take a fortnight to come back.

## Measurement windows

Computed once, written to the row, read back, and part of the measurement's identity. A baseline re-derived at comparison time would change a historical result as the calendar advances.

**Timezone is explicit on every window**, never implicit. "Seven days before the merge" is a different dataset in `America/Los_Angeles` than in `Europe/Berlin`, and the difference is concentrated exactly where the traffic is. The fallback is UTC — documented and deterministic — because a Vercel function's locale is a deployment detail and must not decide what a customer's week was.

`measurement-policy-v1` versions the whole ruleset. Historical rows are never silently recalculated.

## Minimum-data rules

Held on the metric, checked on **both** windows independently, and checked **before** the movement is examined.

That order is the point. A 40% "improvement" computed from eleven visitors is not a small result — it is not a result — and checking the movement first would let it be reported as one. §14's own example (10 before, 8 after) classifies as `insufficient_data` with no percentage stated at all.

A combined total would let a strong baseline carry an almost-empty post-window. Data quality is assessed the same way, per window and taken at its worst — a correction the tests forced during implementation, see below.

## Classification

```
1. is the direction one we implement?   → else refuse, never guess
2. enough data on BOTH sides?           → else insufficient_data
3. movement outside the neutral band?   → else neutral
4. which way, given the direction?      → improved / degraded
```

Missing days are **absent, not zero**. Summing a gap as zero converts an analytics outage into a reported collapse in the customer's traffic — wrong, and alarmingly so.

`target_range` is declared in the union and refused by the classifier with a typed reason, so a future metric declaring it cannot be silently treated as higher-is-better.

## Causality safeguards

The sentence this sprint exists to prevent:

> "This change caused a 9.8% increase in conversion."

Vibe compared two periods and found a difference. A launch, a holiday, a competitor's outage, a seasonal swing, another merge the same day, or an algorithm update are all equally consistent with the numbers.

So: everything is named `observed…`; the UI label is **Observed change**, never "impact" or "uplift"; every stated movement carries a disclaimer that is a field on the server's card rather than a string in a component; and `causality.ts` holds a phrase list — including the softer forms "drove", "led to", "thanks to", "resulted in" — asserted against the UI copy and the domain vocabulary in tests.

The checker is **negation-aware**, which it had to become during implementation: the disclaimer necessarily contains the word "caused", and a naive substring match flagged the very sentence it exists to enforce. A checker that forced the product to stop denying causation would have been worse than none.

## BusinessOutcomeMeasurement

Eight statuses, and **five of them are not results**:

```
waiting_for_source   nobody has connected the data          ← every project today
waiting_for_window   the post-change period has not elapsed
measuring            collecting
improved / degraded / neutral                                 ← the three results
insufficient_data    there was data, and not enough of it
failed               Vibe could not measure
```

`insufficient_data` and `failed` are the two most likely to be mis-worded. Neither is "no impact", and the UI is structurally prevented from rendering them that way.

## Scheduling

`next_observation_at` on the row: a measurement is *due* when that instant has passed, and the durable operation performs exactly one attempt of an already-due measurement.

**The deliberate opposite of Sprint 12A**, and the reason is timescale. That workflow slept between attempts because its window was fifteen minutes. This one compares windows measured in weeks, and a workflow sleeping six weeks would hold a durable slot, across deploys, for a period during which the answer cannot change.

**The honest limitation, stated rather than glossed:** no scheduled runner exists in this architecture, so nothing currently notices that a measurement has become due. The preview lifecycle set that precedent — expiry converges lazily on read, with no cron, no scheduler and no sweeper, because none exists. Adding one is new infrastructure ahead of the decision that authorises it (CLAUDE.md rules 3, 24).

`next_observation_at` plus its partial index are shaped so a future runner is a **consumer** of this schema rather than a redesign.

## Database / RLS

Two tables, and the split matters: a plan is knowable for free at merge time; a measurement needs a source, two elapsed windows and enough traffic. Collapsing them would make "we know what to watch" and "we watched it" the same row.

| Statement | Who may |
| --- | --- |
| INSERT | the project owner — the policy independently verifies a **merged** merge whose read-back head is the approved commit, and (for a measurement) a `ready` plan naming this exact metric and direction |
| UPDATE | **nobody**. No update policy on either table |
| DELETE | nobody, ever |

Constraints that carry weight:

- `business_measurement_result_has_values` — a stated result must have a baseline, an observed value, both sample sizes, a data quality and **non-empty provenance**. A mutation that skips collection cannot store a green result.
- `business_measurement_windows_do_not_overlap` — enforced from below, because it is the kind of arithmetic mistake that reads as correct.
- `business_measurement_failed_has_reason`, `..._insufficient_has_quality`, `..._windows_are_ordered`.
- No value column has a zero default: a missing value and a measured zero are different facts.

Provenance is bounded derived data only — source kind, adapter, metric, window, days returned, retrieved-at. Never a token, a vendor account id, a raw payload, or the daily series.

## Audit events

`business_measurement.created` / `.started` / `.completed` / `.insufficient_data` / `.failed`. They carry the metric, the classification, the sample sizes and the observed relative movement; never a credential, a vendor name, or a payload.

## UI

`## Business impact`, after Production outcome. Ten states, and the four that are not results each read as what they are.

```
## Business impact
Measurement source required

Search impressions
Reach the people looking for a product like yours

Connect an analytics source so Vibe can measure whether this change affected
the business metric it was intended to improve.

Production behavior was verified, but Vibe does not yet have a connected data
source to measure search or traffic impact.
```

A result:

```
Improved

Search impressions
Before 420 · After 486 · Observed change +15.7%

Baseline            17 Jul – 13 Aug 2026 (UTC)
Measurement window  29 Aug – 25 Sep 2026 (UTC)

This is an observed change between the defined measurement windows. It does not
by itself prove that this code change caused the difference.
```

`Degraded` renders through the same branch with the same values and a signed percentage. `insufficient_data` shows what was needed beside what was seen. No revert, rollback or redeploy control exists anywhere.

## Browser E2E

25 new chromium tests, 57 total, all green: source-required (and never "No impact"), scheduled with dates and timezone, measuring with a factual day count, improved with values and disclaimer, degraded shown as fully as improved, insufficient data with its requirement, the ladder reflecting the real business state, reload recovery, and no deploy/revert control on any of the seven scenarios.

Same limitation as 11C.1 and 12A: states come from fixtures, so `page.tsx` wiring and RLS remain unproven at that layer.

## Tests

2574 tests across 130 files, all green. 195 new across eight files.

## Mutation validation

17 applied and reverted. **17 killed.** Three survived the first pass; each exposed a real gap, closed rather than explained away.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | minimum-sample check removed | killed |
| 2 | metric direction ignored (always higher-is-better) | killed |
| 3 | neutral band removed | killed |
| 4 | baseline and post windows overlap | killed |
| 5 | baseline recomputed at collection time instead of stored | killed |
| 6 | migration grants an UPDATE policy (client forges a result) | killed |
| 7 | a result offered without a connected source | killed |
| 8 | observed change relabelled as caused | killed |
| 8b | the observed-change disclaimer dropped | killed |
| 9 | double click creates duplicate measurements | killed |
| 10 | a source failure becomes `degraded` | **survived → killed** |
| 11 | the UI hides the degraded values | **survived → killed** |
| 12 | a measurement rewrites the merge record | **survived → killed** |
| 13 | a plan invents a metric for an unsupported capability | killed |
| 14 | missing days summed as zero | killed |
| 15 | rendering the page creates a plan | killed |
| 16 | a workflow enqueued before the window closes | killed |
| 17 | the `next_observation_at` due marker never recorded | killed |

### The three that survived, and what each taught

**10 — a source failure becoming a verdict.** The failure tests all used a source that failed *both* reads, so the mutation on the post-window path was never reached. But that is the realistic shape: the baseline is history and returns instantly, while the recent window is what a provider rate-limits. Fixed by teaching the fake source to fail one specific window, and adding the test — a source failing on the post-window must never become "the metric fell".

**11 — the UI hiding a negative result.** The assertion checked that the result branch *contained* `<BeforeAfter …>`, which stays true when it is wrapped in `{card.state !== "degraded" && …}`. The element is still in the file; the bad news is gone from the screen. Fixed with an assertion that the values render unconditionally. (The browser suite did catch this one — the source test did not, and both layers now do.)

**12 — a measurement rewriting the merge record.** This one is worth stating carefully. The behavioural mutation was **inert under the in-memory database**, whose update builder does nothing without a terminal call, so the test could not observe it and reporting it as killed would have been false confidence.

The property that actually matters is stronger and exactly checkable: the measurement module never references the delivery tables at all. Asserted structurally, plus a behavioural check that a degraded run leaves the merge, the approval and the prepared change untouched. Both the structural mutation and the original now die.

### A correction the tests forced

`assessDataQuality` originally summed both windows' returned days. A complete 28-day baseline against a 3-day post-window is 31 of 56 — which passes a "half the total" test and is plainly not a partial comparison. Now assessed per window and taken at its worst, the same argument as the per-side sample minimum: one side cannot vouch for the other.

## Quality gate

| Command | Result |
| --- | --- |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 2574 tests, 130 files |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 57 chromium tests — see note |
| `pnpm db:status` | ⛔ no linked Supabase CLI here |
| `pnpm db:lint` | ⛔ same |

**On `pnpm test:e2e`.** This container ships Chromium 1194 while `@playwright/test` 1.62 expects 1234, and `playwright install` is disabled. The suite was run through a scratchpad-only config pointing the repository's own config at the preinstalled binary; `playwright.config.ts` is unchanged, so CI and other machines are unaffected.

**On the Supabase CLI.** Same position as 12A: no CLI credentials and no `.env` here. Alignment was verified read-only instead — 22 local migrations, 22 remote, exact version-for-version agreement, no drift. The live `operation_runs` constraints were read before this migration was written.

## Migration — not deployed

`supabase/migrations/20260815120000_business_outcome_measurement.sql` is written, reviewed and pinned by contract tests. `to_regclass` confirms neither table exists on the remote database yet.

The sanctioned path is `pnpm db:status` → `pnpm db:push` → `pnpm db:lint` from a linked machine, and that machine is not this one. Applying the DDL through the reachable management connection was rejected for the reason Sprints 11C and 12A rejected it: it stamps its own migration version, diverging local and remote history.

**Until it is deployed, "Plan measurement" fails at INSERT** on `operation_runs_operation_type_check` and on the missing tables.

## Real SEO dogfood

Resolved from production state, not assumed:

| | |
| --- | --- |
| ChangeMerge | `82e4980e` · `merged` · 14.08.2026 14:40:56 UTC |
| Merged commit | `78cbdac32ea660edd20af4a9dfcc74be6c388700` |
| PreparedChange | `1232a8f9` · capability `nextjs_seo_foundations_v2` |
| Production outcome | `verified`, 1 attempt (Sprint 12A) |
| Business context | stage `prototype`, primary goal `launch` |
| Production URL | `https://vibe-business-fawn.vercel.app/` |

The live click is blocked on the migration. But the plan is a **pure function of facts now known**, so it was computed against them exactly:

```
Primary metric        search_impressions   (higher_is_better, search_visibility)
Secondary             search_clicks, organic_sessions
Business goal         "Reach the people looking for a product like yours"
Minimum per window    500 impressions
Baseline              2026-07-17 → 2026-08-14  (28 days, UTC)
Measurement window    2026-08-29 → 2026-09-26  (28 days)
Result available      2026-09-26
Connected source      none
→ card state          source_required
→ headline            "Measurement source required"
→ ladder              "Not measured — no source"
→ canStartMeasuring   false
→ canConnectSource    false
```

This is a **dry run against real production facts**, clearly not the live button click, and it is stated as such.

## Measurement source availability

**None.** Vibe Business has no analytics connector — not Search Console, not GA4, not PostHog. The codebase was searched before the module was written; the only mention of analytics anywhere is the Business Audit correctly recording that no such data is available to it.

Per §49 no connector was built to make the dogfood green. That is the next sprint.

## Business impact result

`source_required`. Not "no impact", not "unknown impact", and not a number.

That is the valid dogfood result §47 predicts, and it is the point: the product can now distinguish

> "We changed the product, and the intended behaviour appeared publicly"

from

> "We have evidence that the business improved."

## Provider / AI usage

`0` AI calls · `0` sandbox · `0` browser · `0` GitHub requests · `0` analytics calls.

Rendering a project page makes no provider call and creates no plan. Creating a plan is one insert. Starting a measurement is refused before anything is created when no source is connected — which is every project.

## Known limitations

- **No connector, so no real measurement is possible today.** Everything downstream of the source boundary is exercised only by test doubles.
- **No scheduled runner**, so nothing notices a due measurement. Named as the missing piece rather than papered over — `next_observation_at` is shaped for one.
- **One capability has a measurement profile.** Everything else is `unsupported`.
- **No re-measurement.** A terminal result is immutable.
- **`neutral` cannot distinguish "nothing happened" from "two effects cancelled out."**
- **No attribution.** A large observed movement says nothing about which of several merges in a window produced it — which is precisely why the disclaimer exists.
- **The browser suite still renders fixtures**, so `page.tsx` wiring and RLS remain unproven at that layer — the fifth sprint carrying this gap.
- **`pnpm db:status` / `db:lint` were not run.** Live constraints were read directly instead.

## Related

- [ADR 0021 — Business outcome measurement](../decisions/0021-business-outcome-measurement.md)
- [Sprint 12A — Production Outcome Verification](0012a-production-outcome-verification.md)
- [Sprint 11C — Safe Merge](0011c-safe-merge.md)
