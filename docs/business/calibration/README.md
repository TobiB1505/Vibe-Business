# Economy Calibration Runs

Sprint 0055. Five controlled internal agent runs, executed to give the Economy
Intelligence engine the evidence it was measured to be missing.

**Nothing here activates a price.** `CREDIT_RATE_CARDS` stays `[]`, no billing,
Stripe, wallet, subscription or settlement logic is touched, and no migration is
created. Every run is recorded as `execution_origin = 'dogfood_fixture'`.

## Why these five runs exist

Sprint 0054 built the estimator and then measured it honestly: a leave-one-out
backtest over runs #3–#9 gave **24.3% mean absolute error, +51.3% at worst**,
with the `complex` class never once observed. The cause was named at the time
and is not the engine — it is the evidence:

- Seven runs, six of them the same kind of work.
- **Zero runs carrying repository size.** The `repo_*` columns landed at
  2026-08-20T20:00Z; the newest run was created at 15:07Z the same day.
- No `complex` observation at all.
- Every run marked `non_production_economics`.

These five runs are designed to close the countable part of that gap.

## The run design, and why each one is what it is

| Run | Fixture | Class | How it gets there | What it teaches |
|---|---|---|---|---|
| 1 | `calibration-1-small-copy` | `small` | public pages, no named surface | A second `small` observation, and a repeat of run #8's evidence against a repository that has grown |
| 2 | `calibration-2-complex-multi-surface` | `complex` | `seo_metadata` + `pricing_page` | The **first `complex` observation in Vibe's history** |
| 3 | `calibration-3-standard-logic` | `standard` | `sitemap` alone | The first non-presentational change — is `standard` internally consistent? |
| 4 | `calibration-4-standard-validation-heavy` | `standard` | `seo_metadata` alone | Class held fixed, validation effort varied, so validation cost separates from class |
| 5 | `calibration-5-complex-structural` | `complex` | `legal` + `docs_help` | A second `complex` on a *different* surface pair |

Every one of those classes is asserted in `calibration.test.ts` against the
production classifier. A calibration set whose classes turn out wrong after the
money is spent has measured nothing.

### Why `complex` is never reached by risk

The classifier escalates to `complex` on high or prohibited risk — but
`MAX_AGENTIC_V1_RISK` is `moderate`, so an agentic run at high risk is
**refused**, producing a blocked run and no cost data. It also escalates on
sensitive evidence (payments, checkout, authentication), which are the surfaces
Vibe should not be practising on.

Surface count is what remains, and it is the honest route: two named business
surfaces make a change genuinely broader, and the class says so.

## Running one

Each run is three commands and one human decision. **Only the middle step spends
money, and only a human can take it.**

### 1. Freeze the prediction

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS=<project-uuid> \
VIBE_DOGFOOD_PROJECT_ID=<project-uuid> \
VIBE_CALIBRATION_RUN=1 \
pnpm agent:calibrate
```

This compiles the fixture through the real pipeline and **spends nothing** — the
preflight imports no provider client and no execution starter. It prints a
report and a JSON snapshot.

Save them as `run-1-prediction.md` and `run-1-prediction.json` and **commit them
before starting the run**. That commit is the freeze: there is no predictions
table, so git's timestamp is what proves the estimate preceded the run.

### 2. Start the run

In the deployed app, as the project's owner:

```
/app/projects/<project-uuid>/agent-dogfood/dogfood-fixture--calibration-1-small-copy
```

This is the only start path. It is gated by the operator allowlist, re-resolves
ownership from the session, and goes through the one idempotent
`startAgentExecution`.

Wait for validation to finish, then note the agent run id.

### 3. Reconcile

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
VIBE_CALIBRATION_RUN=1 \
VIBE_CALIBRATION_AGENT_RUN_ID=<agent-run-uuid> \
VIBE_CALIBRATION_SNAPSHOT=docs/business/calibration/run-1-prediction.json \
pnpm agent:calibrate
```

Reads the real ledger rows, compares them against the **frozen** prediction —
never a recomputed one — and explains the variance from measured signals only.
Save as `run-1-actual.md`.

From run 2 onward, pass `VIBE_CALIBRATION_PREVIOUS_RUN_ID=<previous-run-uuid>`
so repository drift has a left-hand side. Without it, drift is `unknown`, which
is the honest answer and not the useful one.

## What this cannot tell us

Stated up front so the final report does not have to discover it:

- **Five runs do not move an estimate.** The adjustment policy's sample floor is
  20 comparable observations. After all five, every cohort is still below it and
  every correction is still exactly 1. What five runs buy is *coverage* — the
  first `complex` data, the first repository context, the first logic change —
  not a corrected model.
- **All five stay `non_production_economics`.** They are dogfood runs on Vibe's
  own project. Nothing here tells us what a customer's repository costs.
- **One project, one repository.** The repository-complexity multiplier is
  calibrated against a reference scale that is Vibe's own tree. Five more runs
  against the same tree do not test it.

## Files

- `run-N-prediction.md` — the frozen pre-run record, committed before the run.
- `run-N-prediction.json` — the `PredictionSnapshot` reconciliation reads back.
- `run-N-actual.md` — what it cost, how wrong the prediction was, and why.
- `CALIBRATION_REPORT.md` — the cross-run analysis, written after run 5.

## Related

- [ECONOMY_MODEL.md](../ECONOMY_MODEL.md#economy-intelligence-sprint-0054)
- [ADR 0038 — The Economy Intelligence Layer](../../decisions/0038-economy-intelligence-layer.md)
