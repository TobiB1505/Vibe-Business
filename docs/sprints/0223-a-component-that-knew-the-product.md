# Sprint 0223 — A component that knew the product

Slice 1 of [ADR 0109](../decisions/0109-nova-first-application-shell.md): thirty-four
files leave `src/components` and `src/app` for the features that own them, and
the component layer stops being able to reach the route tree at all. Nothing a
founder sees changes; no address changes; no domain module changes.

## What was wrong

Slice 0 drew the boundary — `app → features → modules`, and nothing below the
feature layer may import a feature — and then the plan for the next slice broke
it. Moving the Agent and Plan surfaces into `src/features` while
`src/components/nova/blocks/*` still composed them forces `components →
features`, which is the one import the boundary forbids and the one the
register may never legalize. The review caught it before it was built.

Pulling on that found the real shape. Fourteen files under `src/components`
were features wearing a component's address:

- **The nine blocks.** `blocks/review.tsx` mounts three Agent stages, two of
  the Agent's action wrappers and its validation checks. That is a screen
  composed out of another screen, in the directory reserved for things that
  render a shape.
- **Three whole domain views.** `ProductScanExperience` (1,382 lines, two
  Server Actions, a poll), `FounderInputCard` (419 lines, the founder's only
  bounded free-text field), `DiffView` over a `PreparedDiff`.
- **Two landing embeds**, and behind them a landing page of twenty files that
  is a surface in its own right.

Plus four layout primitives reaching into `src/app` for `palette.ts` — a module
under the route tree that is not a route, which was enough to make the frame
depend on the route layer's file layout.

## What changed, and why that shape

**Thirty-four files moved, none rewritten.**

| From | To | Why |
| --- | --- | --- |
| `components/nova/blocks/` (9) | `features/nova/thread/blocks/` | feature composition — a block is the thread's frame around another feature's view |
| `components/product-scan/` (1) | `features/product/` | domain view |
| `components/founder-input/` (1) | `features/founder-input/` | domain view, shared by the Agent, the Plan and the thread |
| `components/change/diff-view.tsx` | `features/agent/` | domain view of a prepared change |
| `components/marketing/` (20) | `features/marketing/` | a product surface |
| `app/palette.ts`, `app/palette.test.ts` | `src/lib/` | cross-cutting, below both layers |

`features/nova/thread/` is named for what arrives in Slice 5 beside it; the
blocks are the only thing in it today.

**The register lost four entries and moved eight.** The twelve `components →
app` crossings are gone: four (the palette) are closed permanently, and eight
travelled with their files and are `features → app` now, which Slice 2 closes
by moving the screens they compose. The total did not grow, no new *kind* of
crossing appeared, and the `components` section of `TRANSITIONAL_CROSSINGS` is
deleted rather than emptied.

**What replaced it is an assertion, not a promise.** `feature-boundaries.test.ts`
now holds that *no file under `src/components` imports from `src/app` at all* —
unconditionally, with no register consulted. A component that needs something
from the route tree is a component with product knowledge, and the answer is to
move the file. Eighty-seven files remain under `src/components` and none of
them reaches upward.

**Five path-pinned test suites were re-pointed, not loosened**: the block
reader and the barrel assertion in `nova-ui.test.ts`, five file paths in
`landing-contract.test.ts`, two in `narrow-widths.test.ts`, one each in
`design-tokens.test.ts` and `command-center-ui.test.ts`. Every sweep still
asserts it found files.

## What was decided against

- **Allowing `components → features` for the blocks.** It is the whole reason
  this slice exists. A component that may compose a feature is a component with
  product knowledge, and one exception would have made the rest of ADR 0109
  decorative.
- **Moving `src/components/system/*`.** Thirteen files that name a module's
  types and label tables — `FindingCard`, `CostDisclosure`, `EvidenceDrawer`,
  `SourceCoverage`, `ActionBlock`, `Wallet`, the status vocabulary. Each
  renders one view type and composes no screen, which is the line. DESIGN.md
  names them as Vibe's semantic components and they stay.
- **Moving the shell.** `project-shell.tsx` holds `PROJECT_SECTIONS` and is
  product knowledge by any reading, along with thirteen other files in
  `components/layout/`. They cross no boundary today and Slice 7 rewrites them
  for the new navigation; moving them twice is churn. `src/components` is
  therefore not primitive-only yet, and saying so is better than implying it.
- **Splitting the marketing directory.** Only two of its twenty files reach
  into the route tree. Moving those two would have left one surface in two
  layers, which is worse than either whole.
- **Reformatting ten files.** Each was already unformatted at HEAD and this
  slice changed one import line in each; rule 84 says a change does not
  reformat code it is not already editing.

## What has not been proved

- **Nothing was opened in a browser.** This slice changes import paths. No
  fixture, no component body and no rendered output changed, so the Playwright
  suite was not run. The standing gap in `docs/ROADMAP.md` is unchanged: the
  thread has still never been seen with real data.
- **"No product knowledge in `src/components`" is half mechanical.** The test
  proves no component imports a feature or a route. It cannot prove a component
  is a primitive — `blocks/audit.tsx` would have passed every mechanical check
  the day its import moved. The classification is in ADR 0109 §2 and the
  audit's §C.2, and it is a judgement a reviewer makes.
- **Node 22 ran the suite; the engine field says 24.** Unchanged from the last
  sprint, and nothing here is version-sensitive.

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (two relative `./palette` imports were found here
  rather than by the alias sweep, and fixed).
- `pnpm test` — 542 files, 9,561 tests, all passing (542 / 9,560 before this
  sprint; the difference is the new component assertion).
- `pnpm test:e2e` — not run; see above.
