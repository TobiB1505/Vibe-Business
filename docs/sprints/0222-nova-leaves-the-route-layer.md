# Sprint 0222 — Nova leaves the route layer

The first slice of [ADR 0109](../decisions/0109-nova-first-application-shell.md):
the Nova surface moves from `src/app/app/projects/[projectId]/` into
`src/features/nova/`, the project index becomes a composition, and the layering
`app → features → modules` becomes a build failure instead of a sentence in two
docblocks. Nothing a founder sees changes; no address changes; no domain module
changes. The audit that derived this slice and the seven after it is
[docs/audits/2026-09-16-nova-first-restructure](../audits/2026-09-16-nova-first-restructure/README.md).

## What was wrong

The brief was to turn *a dashboard with an AI assistant* into *an AI business
operator with a visual workspace* without a rewrite. The audit found that the
domain layer needs nothing for that, that Nova's ranking, catalogue, voice and
every visual primitive of a chat except the composer already exist, and that
what stands in the way is where the surfaces live: the Nova, Agent and Plan
screens are directories under a route, `src/components/nova/blocks/*` imports
ten components out of `src/app/**/agent/*` to compose them into the thread, two
domain files borrow types from the same place, and one Server Action imports a
layout component to build its redirect. Putting the Agent's view into a pane
beside the thread was route-tree surgery, not an import.

The rule that would have prevented it — every Server Action lives under
`src/app/`, nothing under `src/modules/` imports one — was written in
`src/modules/nova/actions.ts` and the module README, and was already false in
three places nobody had counted (`src/modules/auth/actions.ts`, and two
type-only crossings). The README also still said Home was Business Health,
nineteen sprints after ADR 0085 made it Nova.

## What changed, and why that shape

**Twenty-two files moved, none rewritten.** The seventeen files of
`projects/[projectId]/nova/` are `src/features/nova/home/`; the binding table
`nova-actions.ts` is `src/features/nova/bindings/`; the two voice components are
`src/features/nova/voice/`. Every relative import that used to reach a sibling
route directory is now an explicit `@/app/...` import — visible, and recorded.
`page.tsx` imports `NovaHome` and `NovaOpeningScreen` from the feature. Flat
inside `home/` rather than the sub-folders the target map draws, because every
file in it moves together and the value of this slice is the layer, not the
tree; `threads/`, `messages/`, `composer/` and `tools/` land *beside* `home/`
in Slices 4 and 5, which is what the folder was named for.

**The boundary is a test with a register.**
`src/lib/consistency/feature-boundaries.test.ts` resolves every import in every
non-test file under the five layers — alias or relative — and fails on an import
into a layer above the importer's. Every crossing that exists today is an entry
in `TRANSITIONAL_CROSSINGS` with the slice that retires it, and the test also
fails when an entry stops matching a real import, so the register cannot rot.
The same shape as `REVIEWED_SITES` for the service-role client, for the same
reason: a rule that was a convention for a year was already broken and nobody
knew.

What the register holds at HEAD, counted by the test rather than by hand:
twelve component files importing from `src/app` (the Nova blocks, two landing
components, the product-scan experience, four palette readers), two domain files
importing types from the Agent's route directory, four domain files importing
from components (one of them a whole screen, `coding-agent/ui/`), and six Nova
feature files importing the Agent's stages and the Server Actions that still
live beside the routes. `lib` imports nothing above it and nothing below the
features imports a feature — those two have no register and no exceptions.

**CLAUDE.md rule 86** names the layering, and the "Where to look" table gets a
row for it. **ARCHITECTURE.md §5** records the two new layers above the
modules. **`src/modules/nova/README.md`** and the `actions.ts` docblock say
where the binding lives now and stop claiming Home is Business Health. Three
older decisions carry a dated pointer to 0109 on their status line (0045, 0085,
0086), their text unchanged.

**Ten path-pinned tests were re-pointed, not loosened.** `nova-ui.test.ts` and
`status-vocabulary.test.ts` read the feature directory; `nova-room.test.ts`,
`atmosphere.test.ts`, `nova-opening-beats.test.ts`, `one-loop.test.ts` and
`workspace-routes.test.ts` name the new paths; the two voice tests resolve the
component from the feature and the page from the route, and hold both to the
same rule. Every sweep still asserts it found files.

## What was decided against

- **Moving the Agent and Plan surfaces in the same sprint.** It is the next
  slice and it closes twenty-six register entries; it also touches
  `test-support.ts`, `one-loop.test.ts` (ten paths) and a dozen `*-ui.test.ts`
  files. Two moves in one commit is one move nobody can review.
- **Moving `nova-actions.ts` into the domain module.** It imports eleven Server
  Actions; the domain must not depend on a surface's file layout, which is the
  whole rule. It is composition, and it lives with the surface.
- **A permissive rule for `modules → components`.** Three of the four
  crossings are type imports of a tone vocabulary and one is a formatter, and
  a view builder naming a primitive's type is exactly the coupling that later
  puts a `<Surface>` in a store. Registered with a slice, not permitted.
- **Any visible change.** The rail, the seven sections, the thread, the phone's
  tab bar and every address are byte-identical in what they render.

## What has not been proved

- **Nothing was opened in a browser.** This slice changes import paths and
  adds a test; the Playwright suite was not run, because no fixture and no
  screen changed. Rule 69's fourth question is unchanged from
  `docs/ROADMAP.md`'s standing entry: the thread has still never been seen with
  real data.
- **The register is complete only as far as the resolver sees.** It follows
  `@/` and relative specifiers in `import`/`export … from` statements. A
  dynamic `import()` with a computed path, or a `require`, would not be seen;
  none exists in `src/` today, and the walk asserts it found crossings at all.
- **Node 22 ran the suite; the engine field says 24.** The environment could
  not provide Node 24. Nothing here is version-sensitive, and the baseline was
  taken on the same runtime, but "green on 22" is what was measured.

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (route types regenerated, `tsc --noEmit`).
- `pnpm test` — 542 files, 9,559 tests, all passing (541 / 9,548 before this
  sprint; the difference is the boundary test).
- `pnpm test:e2e` — not run; see above.
