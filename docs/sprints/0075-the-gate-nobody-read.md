# Sprint 0075 — the gate nobody read

Status: **Two CI jobs repaired, one false proof claim retracted. No production code changed.** Every defect here is in a test fixture or a label table; what makes it a sprint rather than a chore is how it was found — by opening a check that had been red for five consecutive runs while five pull requests were merged over it.

## How this was found

While waiting on PR #83's checks, the `Billing concurrency` job came back red. Reading its history: **run #12 was the last green one.** Runs #13, #14, #15, #16 and #17 all failed, and all five of their pull requests were merged.

Run #13 is Sprint 0069, the sprint that raised `ITERATIONS` from 20 to 60.

The local gate this repository runs before every push — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — cannot see any of it. `vitest.config.mts` excludes `*.concurrency.ts`, and it must: those files need a real PostgreSQL and skip themselves when none is configured. So a green local run says nothing whatsoever about the gate, and five sprints in a row took it as though it did. This is rule 69's failure mode with the fourth question left unasked.

## Defect 1 — a fixture that ran out of money

`agent-finalization.concurrency.ts` failed inside `createRunningAgentRun` with **"fixture could not reserve Credits for the agent run"**: a fixture out of funds, surfacing as though the billing code had refused.

`FUNDING` was a flat `creditsToUnits(5000)`. Each iteration of each scenario takes one `agent_execution_dogfood` hold of 100 Credits, and a hold that settles is spent for good. Three scenarios × 20 iterations, with only some settling, fit under 5,000. Three × 60 does not: the worst case is 18,000.

`agent-start-failure.concurrency.ts` carried the same flat 5,000 and is sharper still — its second scenario exists to prove the hold is **left active** for a winner to settle, and this suite has no winner. Every iteration takes 100 Credits and never returns them. It would have exhausted at roughly iteration 50 even with defect 2 fixed.

Both now derive their funding from `ITERATIONS`, the scenario count, and `internalChargeFor("agent_execution_dogfood")` — so the number cannot drift from what it is meant to cover, and it tracks the real price rather than restating it. Deliberately the exact worst case with no padding: each iteration takes exactly one hold, so exhausting the account means the suite took more holds than it has iterations, which is a defect worth failing on.

## Defect 2 — a fixture describing a row production cannot produce

`agent-start-failure.concurrency.ts`'s second scenario failed with `new row for relation "operation_runs" violates check constraint "operation_runs_completed_has_result"`.

The scenario models "another finalizer already won the terminal transition" by having the executor update the operation to `completed` through an independent client before refusing. It set `status`, `stage` and `completed_at` — and no `result_id`. The constraint is `status <> 'completed' or result_id is not null`, and the finalizer being modelled (`finishAgentExecutionStep` → `completeOperationRun`) always passes the agent run's id.

So PostgreSQL rejected the write on the first iteration of every run. **The scenario has never once executed.** The row it needed was already there to point at: `claimAgentExecutionRunRow` runs immediately before `executor.start`, and the fixture now reads it.

## The retraction

Sprint 0070's record says, in bold: *"Proven against real PostgreSQL: a second scenario in `agent-start-failure.concurrency.ts`…"*.

That sentence was false when written, and run #14 — the CI run of Sprint 0070's own pull request — is red with the constraint error above. The claim was written from a local `pnpm test`, which does not execute `*.concurrency.ts` at all, and the job that does was never opened.

[0070's record](0070-failed-start-release-authority.md) now carries a dated bracket saying so, with the original left standing per rule 83. Its **FakeDatabase** proof is unaffected and stands: that one was reproduced red and restored green, and it is what actually established the fix.

## Defect 3 — "Seo" is not a word

Separately, probing what `describeEvidenceId` returns for every id the builders mint found four falling through to derived prose:

```
live.form.login_like.login   ->  "Form login like login"
live.seo.title               ->  "Seo title"
live.seo.canonical_missing   ->  "Seo canonical — not observed"
live.seo.sitemap_missing     ->  "Seo sitemap — not observed"
```

`SEO_LABELS` — "A map of your pages", "Instructions for search engines", "Which version of a page is the real one" — has existed in `live-product-intelligence/human-view.ts` all along, written for exactly this audience. Nothing consulted it from the evidence labeller, so the founder-facing "Why?" disclosure on a technical-SEO Move showed the identifier with its punctuation removed and a capital on the front.

`live.seo.*` now resolves through that table. Unlike `live.surface.*`, polarity here really is in the id — `buildLiveEvidence` mints the bare id only when the signal is present and the `_missing` variant only when absent — so a positive reading is honest and the caller's "— not observed" suffix lands on the right half.

Two fixtures also described ids nothing mints. `audit-scenarios.ts` cited `live.seo.canonical_not_observed`, mixing the authenticated vocabulary with the live namespace; corrected to `canonical_missing`. And `e2e/action-plan-ui.spec.ts` has now been re-pinned twice as the words beneath it improved — first to `"robots txt missing"`, then to `"Seo robots txt"`, neither of which anybody wrote. It now pins the real sentence, so the next improvement has to be a deliberate change to a label rather than a silent change to an identifier.

## Proof, and its honest limit

Defect 3 is proven red-then-green: removing the `live.seo.*` branch turns 21 tests red — the 20 harvested family ids plus the explicit assertion — and restoring it turns them green.

**Defects 1 and 2 are not proven here, and cannot be.** This environment has no PostgreSQL target configured, so `*.concurrency.ts` skips itself; the CI job is the only place these run. What is established is the diagnosis — both errors are quoted from the job log, and both mechanisms are arithmetic or a constraint predicate rather than a hypothesis. The verdict is CI's, and this sprint is not finished until run #18 is green.

## What this does not do

**It does not add a local way to run the gate.** Doing so would mean a second Postgres in the developer loop, which ADR 0040 considered and rejected. The correct fix for "nobody read the check" is to read the check.

**It does not fix `live.form.*`.** `"Form login like login"` still renders, because there is no label table for form kinds and inventing one is a different change. Named here rather than quietly widened — the same treatment Sprint 0073 gave `live.surface.pricing_page`.

**It changes no production code.** Every edit is a test fixture, a test, a label table lookup, or a document.
