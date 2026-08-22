# Sprint 0055 — Economy Intelligence Dogfood Calibration v1

**Status:** implemented. Lint (0 errors) / typecheck / full unit suite (5,966 tests
across 328 files) / build green. No migration, no persistence beyond the existing
schema, no UI, no Credits UI, no billing change, no price change.
`CREDIT_RATE_CARDS` is still `[]`.

## Problem

Sprint 0054 built the Economy Intelligence estimator and backtested it against
seven historical runs: 24.3% mean absolute error, no repository-context data on
any of them (the columns landed after the last run in the dataset), and the
`complex` pricing class never once observed. The engine existed; the evidence
it needed to prove itself did not.

This sprint's job was narrow and stated up front: produce that evidence.
**Calibration Engineer, not feature developer** — five controlled internal
agent runs, predict → freeze → execute → validate → reconcile, stop after each
one and wait rather than batch them. No Credits UI, no billing, no pricing
change, no database migration, no production user impact.

## What was run

Five dogfood fixtures in `src/modules/coding-agent/dogfood/calibration.ts`,
executed against Vibe's own repository, each recorded as
`execution_origin = dogfood_fixture` / `non_production_economics = true`.

| Run | Fixture | Class | Predicted | Actual | Error | Comparable |
|---|---|---|---:|---:|---:|---|
| 1 | `calibration-1-small-copy` | small | $0.2873 | $0.1388 (floor) | -51.7% | no — `actual_incomplete` |
| 2 | `calibration-2-complex-multi-surface` | complex | $0.5329 | $0.1994 (floor) | -62.6% | no — `actual_incomplete` |
| 3 | `calibration-3-standard-logic` | standard | $0.3644 | $0.2506 | -31.2% | yes |
| 4 | `calibration-4-standard-validation-heavy` | standard | $0.3169 | $0.7014 | +121.4% | yes |
| 5 | `calibration-5-complex-structural` | complex | $0.3210 | $0.2964 | -7.7% | yes |

Mean absolute error over the three comparable runs: **53.4%** — roughly double
Sprint 0054's 24.3% leave-one-out backtest. That backtest measured the
estimator against runs it had effectively already seen (the same seven it was
built from); these three are the first genuinely held-out measurements, and
the honest number is worse. See [ECONOMY_MODEL.md](../business/ECONOMY_MODEL.md)
and [docs/business/calibration/README.md](../business/calibration/README.md)
for the full per-run record.

Runs 1 and 2 are not comparable — not because anything about them was wrong,
but because they landed before this sprint's own metering fix. Below.

## What the sprint found, in the order it was found

**1. Run 2 failed twice, correctly, on a false premise — not an agent defect.**
The original fixture cited `live.seo.meta_description_missing`. Both
`src/app/privacy/page.tsx` and `src/app/terms/page.tsx` already had their own
`metadata.description`. The agent read the files, found nothing to do, and
stopped (`agent_produced_no_change`) — twice, reproducibly. That is the
correct behaviour for a step whose premise no longer holds. Checking further
found the same problem in two more fixtures: `live.seo.sitemap_missing` and
`live.seo.robots_txt_missing` are both false on the live site — `/sitemap.xml`
and `/robots.txt` already resolve. Three of five fixtures needed rebuilding on
defects re-verified live and in source: canonical links (run 2), Open Graph
metadata (runs 3 and the legal half of 5), and a first-activity empty state on
the authenticated dashboard (run 5) — the last one deliberately outside SEO
entirely, to see the agent work on application code rather than public-page
metadata.

**2. That is a real product gap, not just a fixture-authoring mistake.**
`src/modules/execution-contract/freshness.ts` revalidates repository state,
plan currency, dependencies and ownership immediately before a run — never the
live-product evidence a step's classification rests on. Its own comment
justifies the omission by citing Rule 60 (never trigger a paid refresh), which
turns out not to apply: `live-product-intelligence/service.ts`'s
`inspectLiveProduct` has no `AIProvider` import anywhere in the module and is
already a free, user-triggerable, budget-bounded scan, distinct from the
AI-driven `business-audit/runner.ts` synthesis Rule 60 actually protects.
Nothing today stops a real user from starting an agentic execution against a
step whose live premise already resolved between audit and click — the agent
would behave exactly as it did here, investigate, correctly do nothing, and
(once Credits are live) cost the user Credits for a run that could not have
produced anything. Recorded as an open finding with three open design
questions in
[docs/business/calibration/README.md](../business/calibration/README.md#known-open-issue--live-product-evidence-is-never-revalidated-before-a-run),
not fixed here — closing it is a real extension of the freshness contract,
outside a calibration sprint's scope.

**3. The validation CPU-metering defect — root-caused on the fourth attempt.**
Every `passed` validation had recorded `active_cpu_ms: null` since Sprint 0051
first found it. Run 1 confirmed Sprint 0055's own first fix still didn't work
in production. Run 2's capture logged the one field nobody had needed to read
yet: `sessionStatus: "snapshotting"` — pulled from a real Vercel runtime log,
not inferred. `createSnapshot` resolves once the stop is *requested*, not once
the session has actually reached `stopped` and the provider's metering
pipeline has finished computing the figure. Every earlier attempt (Sprint
0051, 0053, this sprint's first pass) read before that transition finished,
regardless of which SDK object each one read. The fix polls the session's own
status, bounded at 10 × 500ms, via the same passive `Sandbox.get({ resume:
false })` this file already used elsewhere — no resume, no guess, a logged
poll count when the budget runs out. **Verified on three consecutive real
runs** (3, 4, 5): `active_cpu_ms` came back non-null every time.

**4. `complex` is finally observed — twice, with real variance.** Sprint 0054
recorded zero `complex` observations across seven historical runs. Runs 2 and
5 are both `complex`, on genuinely different surface pairs (`seo_metadata` +
`legal` vs `legal` + `dashboard_app`), and run 5 produced the single best
prediction in the entire five-run set (-7.7%) from the weakest historical
match available (`kind_matched`, 0.35 similarity, no shared surfaces with any
prior run).

**5. Run 4 is the largest error in the dataset, and the estimator's own
explainer says why it can't say why.** Run 4 was built to isolate validation
effort from pricing class by holding class fixed against run 3. Validation
cost came in close to run 3's ($0.0732 vs $0.0610) — the axis it was built to
measure behaved as expected. What actually drove the overshoot was model
spend: $0.5981, 3.5× run 3's $0.1706, for the same `standard` /
`single_surface` classification. `explainVariance` correctly reports
`unexplained: 100%` rather than reaching for the nearest plausible cause —
none of the tracked signals (repository drift, context pressure, validation
depth) predict a token-spend difference this large between two same-class
runs. That is a real, named gap in what the estimator can currently see, not
a wrong answer from it.

## What has not been proved

- **Real-world accuracy is worse than the backtest suggested.** 53.4% MAE on
  three held-out runs against 24.3% on the leave-one-out backtest. The
  backtest was optimistic.
- **Every cohort stays below the learning floor.** `minSamples: 20` — five
  more runs, three of them comparable, is not enough to propose a single
  correction. Every `cohortCorrection` in this dataset is still exactly `1`.
- **Model-spend variance within a class is unexplained.** Run 4 is the
  concrete case; nothing in the estimator's current signal set predicts it.
- **All five runs remain `non_production_economics`.** Sprint 0054 named a
  production (non-dogfood) execution as part of what would close its gap.
  Still zero.
- **The live-product evidence freshness gap is documented, not fixed.** A real
  user can still start a run against a stale premise today.
- **Repository context exists on twelve runs total** (five from this sprint,
  seven backfilled where derivable), not the roughly twenty Sprint 0054 named
  as a reasonable floor.

## Gate

Nothing activated. `CREDIT_RATE_CARDS` is still `[]`, `resolveRateCard` still
returns null at every instant tested, and no Stripe, wallet, balance, top-up,
reservation or settlement code changed. Every run stayed
`non_production_economics = true` and `execution_origin = dogfood_fixture`.

**Verdict: NOT READY for credit settlement.** The metering fix closes one real
gap and the fixture saga closes another (with a third, the freshness gap,
named rather than closed). But the number that matters most — how wrong the
estimator is on genuinely new data — moved in the wrong direction: 53.4% MAE
on three held-out runs is worse than the 24.3% the estimator scored against
data it was built from. Five more runs bought coverage, not confidence, and
the report says so rather than rounding the number toward the answer this
sprint was hoping for.

What would close the gap: enough comparable runs to test whether 53.4% holds
or was noise from n=3; a fix for the live-product freshness gap, or an
explicit decision to accept the risk it documents; and — the one line Sprint
0054 already named and this sprint did not attempt — one real, non-dogfood
production execution.
