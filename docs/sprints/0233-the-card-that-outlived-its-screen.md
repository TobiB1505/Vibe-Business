# Sprint 0233 — The card that outlived its screen

Slice 8, in the order its own correction demanded: rewrite, then delete.

## What was wrong

Eight browser assertions titled **"Nova Home"** drove a fixture that mounted a
Focus Card, a Working Strip, an Attention Stack, a Product Identity and a Health
Score — the screen the thread replaced. They passed. They were correct about
that card. They were about nothing a founder could reach.

That is a worse state than no coverage, because a green suite is read as
coverage. [Sprint 0230](0230-three-files-nothing-reached.md) found it while
scoping the deletion and stopped: deleting the components first would have left
the product with **less** coverage than it had.

## What was built

The fixture mounts the room a founder opens — `NovaRoom`, `NovaThreadHeader`,
`NovaPresence`, `NovaRail` and `NovaFocusThread` — given a view model the
production ranking produced. What is stood in for is the **control**: the route
has no session, and the claim under test is what a founder can see before
pressing.

The claims survived the move intact, because they were never about those
components:

| Claim | Where it is asked now |
| --- | --- |
| One dominant action, with its price, before any click | the focus region, the price, and exactly one button |
| Never a currency or a percentage | unchanged |
| A paused run reads as waiting, never as working | the line under her name |
| A stall is named as a stall | the same line |
| Nothing to do means no invented button | the focus region, and zero controls |
| The other true things carry no controls | three sentences, and no button between them |
| It all survives 375px, 768px and 1280px | unchanged |

## What it found

**A stalled run read as analysis.** `NovaHeaderLive` said
`{ word: stageLabel, tone: "active" }` for *any* operation the ranking held —
so a run the product had already decided was probably lost said **"Analyzing
business"**, in mint, with a pulsing dot beside it. The last stage it reported,
coloured as activity.

A paused run was only accidentally right: `asking_founder`'s stage label happens
to read *"Waiting for you"*, so the word was correct and the **tone** was not.

`statusForOperationPhase` has had the honest answer since before that component
existed — *Stalled*, amber, because a stall is inferred from a clock rather than
observed. The word comes from the phase now, and a live stage is used only while
the phase is `working`.

This is the defect the migrated assertion existed to catch, sitting in
production while its test passed against a card.

## What moved rather than retired

**A missing score explaining itself** is asserted against the production
business map in `business-audit.spec.ts` — *"only 2 of 9 areas could be
assessed"*, the words, and the colour that is not the healthy one. Home has no
score on it: Business Health is its own destination and its own artifact, and
the assertion here was of a component that is gone.

**The evidence drawer's `aria-expanded` and its focus trap** moved to
`product-understanding.spec.ts`, against a panel that mounts `CitationCount` the
way four production surfaces do. The drawer itself was never legacy — only the
screen the test opened it from.

**A 44px tap target on an attention row** described a stack of links. The other
true things are sentences now, with no controls at all, which is the stronger
version of the claim and is asserted as such.

## What was deleted

`legacy-focus-card.tsx`, `legacy-attention-stack.tsx`, `legacy-working-strip.tsx`,
`legacy-product-identity.tsx`, `legacy-health-score.tsx`, and the
`narrow-widths.test.ts` sweep entry that was the last thing referencing one of
them.

## What is retained, and why

Four components no route mounts, each carrying real browser coverage of real
copy rules. Retiring them is **re-pointing 24 assertions**, not deleting four
files, and the ROADMAP names what each costs:

- `home-status.tsx` — 11 browser tests. The "Command Center" vocabulary retires
  with it, not before.
- `intelligence-summary.tsx` — 13.
- `understanding-progress.tsx` — covered by a design-token assertion.
- `agent-panel.tsx` — what `agent-streaming.spec.ts` uses to observe a
  `<Suspense>` boundary the **live** Agent route relies on. It needs a stand-in
  before it can go, and building one is not deleting a file.

This is the same finding Sprint 0230 recorded, one deletion further along: the
order is rewrite, then delete, and the rewrite is the work.

## What has not been proved

- **The retained four are still fixture-only**, which means 24 browser
  assertions still describe screens no founder reaches. They are honest about
  what they mount; they are not honest about what a founder uses.
- **The stall fix has never been seen against a real stalled run.** It is
  asserted against a fixture whose operation carries `stalled: true`, which is
  the same flag `operationPollPhase` reads in production — but a real run
  presumed lost has not been watched.

## Validation

- `pnpm lint`, `pnpm typecheck` — clean.
- `pnpm test` — 558 files, 9,785 tests.
- `pnpm test:e2e` — 900 browser tests.
