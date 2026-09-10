# Sprint 0204 — The line things cross

**Date:** 2026-09-09
**Decision:** module seven of the landing page is the boundary — what enters Vibe, what is kept, and what is refused before it is ever asked for.

## The objection every block above it postpones

A product that asks for access to the repository somebody's company is built on
has to answer *what do you keep* before it answers anything else. The page had
that claim as one tile in a bento — three lines, no picture, easy to skim past —
and the honest answer is unusually good: conclusions, plus the evidence paths
that justify them, and nothing else (rule 26).

## The seventh shape

Two tiles, a staircase, a narrowing, a passage, a thread, a ladder — and now a
**line with things crossing it**. The subject is a boundary, so the picture is
one: paths on the left, a rule down the middle, and on the right either a
sentence that got through or nothing at all.

The rule is drawn per row rather than once behind the list, so it survives a row
being added, removed or reordered, and a browser guard measures that the five
segments share one x and each reaches the next — which is what makes five
segments read as one boundary instead of five ticks.

## The policy decides the sides, not the marketing file

`isSensitivePath` is the product's own rule and it runs at render time. A page
that *listed* "we never read .env" would be a promise; a page that asks the
function which side each path falls on is showing the mechanism, and it cannot
drift from the product because it is the product. Widen the policy and this
block moves a row on its own.

The distinction the policy carries is worth the block by itself: observing that
a sensitive path **exists** is fine and useful — a repository with a
`.env.production` is telling you something — while retrieving its content is
refused outright (rule 28).

## A guard that was testing the row's own text

The first version filtered rows by the words "Never opened" — which come from
the row's data, not from the policy. A mutation that decoupled the strike-through
from `isSensitivePath` left it green, and the two refused paths went on reading
as ordinary ones with the label still attached.

It reads the computed `text-decoration-line` now and asserts the struck rows are
exactly the sensitive ones. Same lesson as 0202's omission guard and 0203's focus
guard, three sprints running: a test that names something adjacent to its subject
passes when the subject breaks.

Three guards, three mutations: the treatment decoupled from the policy, the rule
shortened so the segments no longer meet, and the query-string clause softened.
All caught, the first only after the guard stopped reading prose.

Unit 9,475 · browser 794 with 3 new · tsc clean · eslint 0 · build clean
