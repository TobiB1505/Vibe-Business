# Sprint 0206 — The euros lead

**Date:** 2026-09-10
**Decision:** module eight is what a month costs in money; the Credit prices stay underneath it.

## The correction

*"Nein, natürlich nicht die Credit-Preise, sondern die Monatsabos mit
Echtgeld."*

Sprint 0205 built this block as the Credit rate card — six operations, each
price resolved from `launch-v1`, all of it true and all of it answering a
question the reader cannot ask yet. A visitor who has not signed up has no
Credit balance to reason about, so "35 Credits" means nothing to them. The
question they *do* have is what a month costs, and it has a two-digit euro
answer.

So the euros lead: €0, €19, €49, from `listPlans()`. The Credit prices stay
underneath and quieter, because "1,000 Credits each paid month" is meaningless
without them.

## The line between the two halves

Between the plans and the prices sits the sentence that connects them: **1,000
Credits is 5 agent runs at the standard class, or 28 Business Brain audits.**

It is a division performed on the same rate card printed below it, not an
estimate written beside it — so changing either price changes this sentence, and
the two cannot come to disagree. A guard asserts the numbers rather than the
shape of the sentence, which is what makes that binding real.

Nothing else here is typed either: the plans, the Welcome grant and the Credit
packs all come from the billing catalogue, and every per-action price from
`resolveRetailPrice`.

## The pricing section is gone

Dissolved into this block, the same way four tabs and two bento tiles have
been: it was the same three cards, further down the page, under a heading that
said *Simple plans*. The block keeps `id="pricing"`, so the nav link and the
no-JavaScript guard that reaches for it still land.

## Two things this cost

**A contract that read only `page.tsx`.** The plan cards' `next=` destination —
the one thing that stops somebody who chose Builder arriving signed in with no
route to paying — was pinned in `landing-contract.test.ts` against the page
file. The cards moved into a component and the assertion went on passing
against a file that no longer contains them. Repointed, then broken to prove
it. That is the third contract this refactor has had to repoint, after the hero
and the proof section, and each time the lesson is the same one.

**And a `git checkout` on an uncommitted file threw the rewrite away.** It was
run to undo a deliberate mutation and took the whole euro version with it,
because that version had not been committed yet. Restored from the session
rather than from disk. `git stash` or a copied file is the tool for undoing a
mutation; `git checkout` is the tool for discarding work.

Four guards, four mutations: the euro shrunk to the size of the Credit line, the
conversion divided by the wrong class, the free row given a price, and the
released cost line deleted. All caught.

Unit 9,475 · browser 798 with 4 new · tsc clean · eslint 0 · build clean
