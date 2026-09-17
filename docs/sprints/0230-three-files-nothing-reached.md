# Sprint 0230 — Three files nothing reached

Slice 8 of [ADR 0109](../decisions/0109-nova-first-application-shell.md), in
part. Three components that no screen and no fixture mounted are deleted, with
the three sweep entries that were the only thing keeping them referenced.

**Most of Slice 8 is not done**, and what is left is named precisely below with
why — including one finding worth more than the deletions.

## What was deleted

```
src/features/product/live-intelligence-summary.tsx
src/features/health/reasoning-trail.tsx
src/features/agent/validation-panel.tsx
```

None had an importer. Each was referenced by exactly one thing: a sweep that
walked a list of files asserting something about all of them —
`command-center-ui.test.ts`'s copy check, `customer-language.test.ts`'s
root-problem check, `approval-ui.test.ts`'s merge-control check and
`ui-source.test.ts`'s label check.

That is the shape worth naming, because it is how dead code survives a green
suite: **a file with no importer and one assertion about it looks maintained.**
The assertion passes, the file appears in a list, and nothing distinguishes it
from the three files beside it that a founder can actually reach.

`customer-language.test.ts` lost a whole `it` rather than one line: its claim was
that `ReasoningTrail`'s JSX does not read `conclusion.rootProblem`, which is a
claim about a component that no longer exists.

## What is left, and why it is left

**Four components are fixture-only rather than dead**, and deleting each one
deletes browser coverage that has no replacement:

| File | Mounted by | What its spec proves |
| --- | --- | --- |
| `features/health/home-status.tsx` | `/e2e/home-*` | `command-center.spec.ts`, 11 tests about a screen Nova replaced |
| `features/product/intelligence-summary.tsx` | `/e2e/intelligence-*` | `repository-intelligence.spec.ts`, 13 tests |
| `features/agent/agent-panel.tsx` | `/e2e/agent-*`, `agent-streaming` | the `<Suspense>` boundary streaming, which the real route relies on |
| `features/product/understanding-progress.tsx` | one fixture branch | — |

Deleting the first two is straightforward and deletes 24 browser assertions with
them. Deleting `agent-panel.tsx` costs the streaming proof, which is about a
structure the **live** Agent route uses and would need a new stand-in first.
None of that is hard; all of it is the kind of work where a tired hand removes
one assertion too many, and a browser suite that has quietly stopped checking
something is worse than one that checks the wrong screen.

**And one finding that is worth more than the deletions.** `e2e/nova-home.spec.ts`
is two suites in one file. The first half drives `/e2e/study-block` and tests the
thread production renders. The second half — from line 211 — drives
`/e2e/nova-priced`, `nova-review`, `nova-waiting`, `nova-stalled`,
`nova-settled` and `nova-unscored`, and every one of those scenarios mounts
`design-studies/legacy-focus-card.tsx`, `legacy-attention-stack.tsx`,
`legacy-working-strip.tsx`, `legacy-product-identity.tsx` and
`legacy-health-score.tsx`.

So eight browser assertions titled *"Nova Home"* are about **the card the thread
replaced**. They are not wrong — they pass, and what they assert was true of that
card — they are about a screen no founder can reach, under the name of one they
can. `e2e/ground.spec.ts` drives `/e2e/nova-priced` for the same reason.

That is the defect this whole slice exists to remove, and it is the one case
where deleting the dead file *first* would leave the product with less coverage
than it has now. The order is: rewrite those eight against a fixture that mounts
`NovaFocusThread` — `study-moments` already does, and Slice 5's and Slice 6's
scenarios do — then delete the legacy studies.

## What was not touched

**The "Command Center" vocabulary.** `src/modules/projects/command-center.ts`
builds the view model `HomeStatus` renders, so the name goes when the screen
does. The audit's own answer to *what is dashboard legacy* says of the adjacent
case: *keep the function, retire the name* — and renaming a module ahead of
deleting its one consumer is churn in both directions.

**No address was removed**, which is Slice 8's own boundary: retired addresses
stay 307s.

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 9,746 tests, all passing (9,748 before; the difference is the
  one retired `it` and one sweep row).
- `pnpm test:e2e` — unchanged; nothing deleted here was reachable from a browser.
