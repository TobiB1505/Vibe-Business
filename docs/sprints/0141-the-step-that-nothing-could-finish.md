# 0141 — The step that nothing could finish

**Date:** 2026-09-04
**Decision:** [ADR 0090](../decisions/0090-a-founder-closes-what-vibe-cannot-run.md)

## What the founder reported

Three screenshots and one sentence: *"wir haben jetzt praktisch mindestens drei Probleme … Ich bin jetzt stuck."* A fresh audit, a fresh Action Plan and fresh Moves on this repository's own project, and then: the Agent cannot run on the current Move, the Moves cannot be continued, "Start here" does nothing.

Three symptoms. One cause, and two display defects that hid it.

## What the investigation found

**The repository was never the problem.** Vibe-Business's snapshot is `repo-intelligence-v7` — the version HEAD reads — `complete`, one build target at `.`, pnpm, Next.js, `build` script present. `resolveValidationProfile` returns **supported**. Both rescue screens built in Stufe 6 and 7 correctly stayed silent, because there was nothing stale and nothing to choose between.

**The plan's first step could be completed by nothing at all.** Step 01 is `actor: vibe`, `changeKind: research`. `resolveStepExecution` refuses it — correctly — and then no authority in the product admits it:

| Authority | Admits | Step 01? |
|---|---|---|
| Founder resolution | `founder_decision`, `founder_input` | no |
| Agent execution evidence | a verified run ending at a passed validation | no run can produce it |
| Founder attestation | `founder_action` + `founder_acts` | no |

`firstActionableStep` therefore returned step 01 on every read, forever, and steps 02–05 — including two `product_change` steps the agent was eligible to build — were unreachable behind it.

**"Start here" is not a button.** It is a status label in a `<span>` inside the row's `<summary>` (`plan-detail-panel.tsx:147`). Clicking it expands the row, and for a `vibe` step the expanded row holds description, purpose, "Done when" and dependencies — and no action of any kind. The founder's reading of the symptom was exactly right: there was nothing there.

**Two things the product knew and would not say.** `change_kind_not_executable` has had an honest sentence in `EXECUTION_REASON_LABELS` all along — *"This isn't a change to your product, so there is nothing for Vibe to build"* — and `stepResponsibility` dropped it, because the list it consults was scoped to *repository* reasons when Sprint 0136 added it. The row said "Not automated yet", which reads as a feature Vibe has not shipped yet, so the founder waits for something that was never coming. And the open founder decision for step 02 was **already in the database, answerable** — `service.ts:459` shows a question only when it hangs off the *actionable* step, and the actionable step was 01. The plan's own "NEEDS FROM YOU" list named that question while the screen offered no way to answer it.

**Absorption is not the missing authority**, though it looks like one. `dependencies.ts` folds an `analysis` prerequisite into a downstream agent run, but `listAgentStepCompletionEvidence` reads a run's `chain_step_keys`, never its absorbed preparation — so an absorbed step is routed past rather than finished, and a plan whose entry point is an `analysis` step deadlocks identically. Four such steps exist across stored plans, alongside this one `research` step.

## What was built

**The attestation opens to the set with no executor** (ADR 0090). One predicate, `isFounderAttestable`, enforced at the four layers that had each encoded the narrow rule separately — the completion projection, the server action, the render condition, and the `security definer` database function that is the actual authority.

The discriminator is `changeKind`, never `executionSupport`, and that is the load-bearing choice: `not_yet_supported` is also what every agent-buildable step carries, because the deterministic registry has one entry and misses nearly all of them. Keying on the stored support value would have given a founder a control that closes the work Vibe exists to do. The copy says what the click means and what it does not: *"It does not claim Vibe did the work."*

**The Agent screen stops going quiet.** A third notice beside the two from Stufe 4, for the refusal a founder actually hit: the plan's next step is named, its reason given, and the way on is a link — *"Confirm it on your Action Plan"* when the founder can clear it, *"Open your Action Plan"* when it is somebody else's. The control stays on the screen that owns the step's completion criterion, because a confirmation separated from the sentence it attests to is not a confirmation.

**The row says why.** `stepResponsibility` names `no_executor_for_vibe_work` and `change_kind_not_executable` instead of "Not automated yet" — the half of Sprint 0136's own argument that had been applied to repository reasons and not to these.

## Verification

Every fix was proved by breaking it and watching a named test fail.

Reverting the predicate to the old narrow rule fails *"admits Vibe's own work that no run could produce"* and *"completes the Vibe step no execution could reach"*. Rewriting it to key on `executionSupport` — the tempting wrong design — fails *"never admits a product change, whatever the Planner stored about it"*. Reverting the SQL to the two-column predicate fails five migration tests against real PostgreSQL, including the retry-convergence one.

The database half had **no test at all** before this: `attest_founder_action_step` has been the authority since ADR 0055 and nothing exercised it against a cluster. It now has thirteen, and the hardest of them assert the direction that must stay closed — a `product_change` refused under all three of its stored support values, and every other actor's work refused outright.

Browser, because the failure was a screen with nothing on it and no domain test can see that: one scene where the plan's entry point is a `vibe` step nothing can finish, asserting the confirmation is offered and that it does **not** say "Your action"; two scenes for the Agent notice, differing only in whether the founder can clear the step, because that single word is the whole value of the notice.

Domain 8,534 · SQL 390 · browser 514 · lint 0/0 · build green.

## What this does not do

**It does not close the absorption question.** Whether a run that absorbs an `analysis` prerequisite should also *complete* it is a separate authority — Vibe's own evidence rather than a founder's word — and it needs the absorbed keys to reach `listAgentStepCompletionEvidence`, which today they do not. Recorded as open in ADR 0090 rather than answered on the way past.

**It does not change what a plan's entry point is.** `firstActionableStep` still has no knowledge of absorption, so an absorbable step is still offered to the founder as the thing to do next. With the attestation open that is workable rather than fatal, but it is not right.

**It changes no execution authority.** Nothing here lets Vibe run, prepare, approve or merge anything it could not before. One thing moved: who may say a non-executable step is done.
