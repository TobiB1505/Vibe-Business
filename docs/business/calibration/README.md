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
| 2 | `calibration-2-complex-multi-surface` | `complex` | `seo_metadata` + `legal` | The **first `complex` observation in Vibe's history** |
| 3 | `calibration-3-standard-logic` | `standard` | `sitemap` alone | The first non-presentational change — is `standard` internally consistent? |
| 4 | `calibration-4-standard-validation-heavy` | `standard` | `seo_metadata` alone | Class held fixed, validation effort varied, so validation cost separates from class |
| 5 | `calibration-5-complex-structural` | `complex` | `sitemap` + `robots` | A second `complex` on a *different* surface pair |

Every one of those classes is asserted in `calibration.test.ts` against the
production classifier. A calibration set whose classes turn out wrong after the
money is spent has measured nothing.

The same test also checks each surface against a file that exists. The first
draft of runs 2 and 5 cited a pricing page and a docs page — this repository has
neither. Classification reads evidence ids and never touches the filesystem, so
both classified correctly and the suite went green while the work was
impossible. A fixture has to be *possible*, not just well-classified.

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
VIBE_DOGFOOD_PROJECT_ID=<project-uuid> \
VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS=<project-uuid> \
VIBE_CALIBRATION_RUN=1 \
VIBE_CALIBRATION_OUT=docs/business/calibration \
pnpm agent:calibrate
```

Secrets come from **`.env.local`** — the probe config loads it, so the Supabase
and GitHub App variables do not belong on the command line where they would land
in shell history. Anything set explicitly in the shell still wins over the file.

This compiles the fixture through the real pipeline and **spends nothing** — the
preflight imports no provider client and no execution starter.

It reads the repository, so `.env.local` must carry the **GitHub App**
variables (`GITHUB_APP_ID`, `_SLUG`, `_CLIENT_ID`, `_CLIENT_SECRET`,
`_PRIVATE_KEY`) alongside the Supabase ones — a prediction is pinned to a commit,
and knowing the commit means reading the repository.

It writes `run-1-prediction.md` and `run-1-prediction.json`, and **refuses to
overwrite either**. **Commit them before starting the run**: there is no
predictions table, so git's timestamp is what proves the estimate preceded the
run. Drop `VIBE_CALIBRATION_OUT` to print to stdout instead.

### 1a. If the prediction is refused

A refusal now prints the reason the resolver actually gave, not just the
`not_executable` wrapper around it. The two worth recognising:

**`admission refused: repository_head_moved`** — the default branch has moved
since Vibe last analysed the repository, so the commit the prediction would be
pinned to is no longer `main`'s head. This is ADR 0014 working: a moved default
branch blocks execution rather than triggering merge reasoning. Fix it by
**re-analysing the project** from the app, which re-pins the snapshot to the
current head. Nothing here starts that for you — it is the user's action, not
the harness's.

Merging *anything* to `main` between two calibration runs triggers this. The
practical rule for a calibration session: land no PRs while runs are in flight,
or re-analyse after each one.

**`resolved mode: deterministic`** — the fixture matched a registry capability
and would never reach the agent. That is a fixture defect, not a state problem;
`calibration.test.ts` now blocks the one pair that can cause it.

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
VIBE_CALIBRATION_RUN=1 \
VIBE_CALIBRATION_AGENT_RUN_ID=<agent-run-uuid> \
VIBE_CALIBRATION_SNAPSHOT=docs/business/calibration/run-1-prediction.json \
VIBE_CALIBRATION_OUT=docs/business/calibration \
pnpm agent:calibrate
```

Reads the real ledger rows, compares them against the **frozen** prediction —
never a recomputed one — and explains the variance from measured signals only.
Writes `run-1-actual.md`. This half needs only Supabase.

From run 2 onward, pass `VIBE_CALIBRATION_PREVIOUS_RUN_ID=<previous-run-uuid>`
so repository drift has a left-hand side. Without it, drift is `unknown`, which
is the honest answer and not the useful one.

## Resolved during this sprint — validation CPU metering

Every `passed` validation in production recorded `active_cpu_ms: null` through
calibration runs 1 *and* 2 — the second observation with Sprint 0055's first
fix (reading `currentSession()` after the snapshot) live and exercised in the
exact deployment that produced the null. That ruled out "unverified" and made
it "verified not to work."

Run 2's own capture named the actual mechanism: `sessionStatus: "snapshotting"`,
read straight from a Vercel runtime log rather than inferred. `createSnapshot`
resolves once the stop is *requested*, not once the session has actually
reached `stopped` and the provider's metering pipeline has finished — every
attempt across Sprints 0051, 0053 and 0055's first pass read before that
transition finished, regardless of which object each one read. The fix now
polls the session's own status (bounded, 10 × 500 ms) via the same passive
`Sandbox.get({ resume: false })` this file already used elsewhere, and only
gives up — loud, with the poll count logged — once the budget is spent.
Committed and pushed; **not yet verified against a real production run**, the
same caveat this section carried before run 1.

A successful calibration run with `validation: not_measured` still means the
run contributes nothing to the learning dataset — the comparison stays
`actual_incomplete` regardless of which sprint's attempt is live. The next
run with a `passed` validation is what verifies this one.

## Known open issue — live-product evidence is never revalidated before a run

Run 2 (`calibration-2-complex-multi-surface`) failed twice with
`agent_produced_no_change`, and both times correctly: `src/app/privacy/page.tsx`
and `src/app/terms/page.tsx` already export their own `metadata.description`.
The fixture's evidence, `live.seo.meta_description_missing`, was true when the
fixture was written and false by the time it ran. The agent read both files,
found nothing to fix, and stopped — the honest outcome for a false premise, not
a defect in the agent.

Checked against the live site directly (`vibebusiness.de`) while diagnosing
this: `/sitemap.xml` and `/robots.txt` both already resolve with real content.
So `live.seo.sitemap_missing` — cited by run 3 and half of run 5 — is *also*
false right now. Only `live.seo.canonical_missing` (the other half of run 5)
and `live.seo.structured_data_missing` (run 4) checked out as still true.

**This is not a fixture-authoring mistake to fix and move past.** It is a real
gap in `src/modules/execution-contract/freshness.ts`. `FRESHNESS_CHECKS`
revalidates repository state, plan currency, dependencies and ownership
immediately before a run — but not the live-product evidence a step's
classification and rationale rest on. The module's own comment gives the reason:

> "It does not re-run a Business Audit... Re-auditing to change a file would be
> a paid operation triggered on the user's behalf, which Rule 60 forbids
> outright."

That conflates two different operations. Re-running the full Business Audit —
`business-audit/runner.ts`, which imports `AIProvider` and synthesizes evidence
into priced findings — is correctly forbidden by Rule 60. Re-running the scan
that *produces* a piece of live-product evidence is a different operation:
`live-product-intelligence/service.ts`'s `inspectLiveProduct` has no
`AIProvider` import anywhere in the module, is already a synchronous,
user-triggerable, budget-bounded action (`inspect-live-action.ts`), and already
carries a `reused` / `force` reuse policy. It costs nothing Rule 60 protects
against.

**What this means for a real user, not just this harness.** Nothing today stops
someone from starting an agentic execution against an Action Plan step whose
live-product premise resolved between the audit and the click — they fixed it
themselves, an earlier step already covered it, or enough time passed. The
agent behaves exactly as it did here: investigates, correctly finds nothing to
do, and stops. Under `non_production_economics` that costs Vibe some model
spend. Once Credits are live, it would cost a customer credits for a run that
could not have produced anything.

**Not addressed in this sprint** — Sprint 0055 is calibration, not feature
work, and this is a real extension of the freshness contract, not a bug fix.
Left for a follow-up sprint / ADR, with three open questions rather than a
design already decided:

1. **Scope the trigger.** Only steps citing `live.*` evidence need this: a
   repository-only step should not pay crawl latency it has no use for.
2. **Failure semantics.** Block admission the way `repository_head_moved`
   already does (send the user to re-analyse), or re-derive the step's
   classification from the fresh scan automatically? The second is more
   convenient and more dangerous — Rule 57 keeps model output and derived data
   away from silently steering paths/classification, and while this would be
   deterministic code rather than a model, an execution's classification
   moving underneath the user between audit and click is the same shape of
   surprise. The first is more consistent with how repository drift is already
   handled.
3. **Reuse window.** `inspectLiveProduct` already has a "recent enough for
   advice" freshness policy. Whether "recent enough for execution" should be
   the same window or a stricter one — likely stricter, since a stale answer
   here burns a run rather than just showing outdated advice — is undecided.

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
