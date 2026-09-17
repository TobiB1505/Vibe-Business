# Sprint 0224 — The surfaces leave the routes

Slice 2 of [ADR 0109](../decisions/0109-nova-first-application-shell.md):
ninety-eight files leave `src/app/app/projects/[projectId]/` for the six
features that own them, four view types go the other way into the domain, and
`src/modules` stops importing anything above it. Nothing a founder sees
changes; no address changes; no domain engine changes.

## What was wrong

The route directory was the product. Thirty-two Agent components, nine Plan
components, the Business Health screen with its loader, the product's scan and
understanding surfaces, twelve loose gate panels, the settings views and the
experiments card all lived under `projects/[projectId]/`, beside the
`page.tsx` files that mounted them. A route file was the only kind of file the
directory was named for and the smallest part of what it held.

The consequence was not tidiness. `modules/coding-agent/agent-workspace.ts`
returned `AgentTask`, `ValidationCheck`, `PreviewChange` and `MergeSummary` —
four types declared inside components in that directory — so the domain's read
model could not be read, moved or reused without the route tree it described.
It compiled because a `type` import is erased. Slice 1 made that visible by
moving the blocks into `src/features`, at which point those imports became
`modules → features`: the layering inverted, which
`feature-boundaries.test.ts` refuses unconditionally and no register entry can
excuse. The test caught the work in progress, which is what it is for.

## What changed, and why that shape

**Ninety-eight files moved; none was rewritten.**

| To | What |
| --- | --- |
| `features/agent/` | the 32 workspace components, the 7 gate panels, `change-origin`, `change-rationale`, `change-diff-section`, `agent-panel`, and their six source-assertion suites |
| `features/plan/` | the 9 plan components, `prepare-change-panel`, `question-promise.test.ts` |
| `features/health/` | `content.tsx`, both `business-brain/` components, the audit lifecycle and notices, `run-audit-button`, `needs-user-panel`, `provenance-panel`, `reasoning-trail`, `home-status` |
| `features/product/` | `understanding-*`, `deep-scan-*`, `scan-handoff`, `scan-glyphs`, `live-browser-canvas`, `intelligence-summary`, `live-intelligence-summary` |
| `features/experiments/` | `experiment-card` |
| `features/project-settings/` | `project-settings-view`, the two forms, the two danger controls, `activity-feed` |
| `src/lib/test/ui-source.ts` | the shared control-label extractor, renamed from `test-support.ts` |

What is left under `projects/[projectId]/` is what the directory is named for:
nineteen route files, twenty-five Server Actions that Slice 3 moves, and two
route-level suites — `workspace-routes.test.ts`, which is about the routes, and
`command-center-ui.test.ts`, which sweeps several surfaces at once.

**Four types went the other way.** `AgentTask`, `ValidationCheck`,
`PreviewChange` and `MergeSummary` are
`src/modules/coding-agent/workspace-view.ts` now, copied verbatim out of the
components that declared them; `ChangeCost` is `modules/credits/change-cost.ts`.
The components import them. `AgentTaskRating` is written as a union because the
label tables stayed with the component, and `Record<AgentTaskRating, string>`
keeps the two from drifting — which the inferred `keyof typeof IMPACT_LABELS`
did by construction.

**`src/modules`, `src/components` and `src/lib` now import nothing above them.**
That was the point of the slice, and it is a grep with no results rather than a
claim. The register holds thirty-five entries, every one of them a feature
binding a Server Action that has not moved yet, and Slice 3 takes the whole
section at once.

**The source-assertion suites were re-pointed, not loosened.** `source()` takes
a path relative to `src/` now, because the panels these suites cover no longer
share a directory — the gate panels are `features/agent/`, the audit's are
`features/health/`, and the routes that mount them are still under `app/`. A
single base directory would have to be a guess, and a guess that resolves to
the wrong file of the same name is the silent pass the module exists to
prevent. Seven suites that carried their own copy of that reader now take the
shared one.

## What was decided against

- **`commands.ts` stubs.** The audit's Slice 2 line suggested them,
  re-exporting the actions that had not moved. A stub that re-exports from the
  route tree is the same crossing with an extra hop and a file to delete in
  Slice 3. The register names the crossings instead, which is what it is for.
- **`queries.ts` per feature.** The same Slice 2 entry named it and its own
  "not in this slice" line excluded it. The exclusion is right: splitting a
  loader is a change to what a route reads, and this slice changed nothing
  about that.
- **Deleting the five files nothing mounts.** `agent-panel`, `home-status`,
  `intelligence-summary`, `live-intelligence-summary`, `reasoning-trail`,
  `understanding-progress` and `validation-panel` moved with their features and
  are named in those READMEs. Slice 8 deletes what nothing reaches; mixing a
  deletion into a move makes a ninety-eight-file diff harder to read, not
  easier.
- **Following the audit on `reasoning-trail.tsx`.** It listed the file with the
  change views for `features/agent/`. It renders a `BusinessConclusion`, which
  is an audit concept, so it went to `features/health/`. The audit grouped it
  by where it sat in the directory rather than by what it draws.

## What has not been proved

- **Nothing was opened in a browser.** Ninety-eight files changed address and
  none changed content. No fixture, no component body and no rendered output
  moved, so the Playwright suite was not run. `docs/ROADMAP.md`'s standing gap
  is unchanged.
- **The move was mechanical; the classification was not.** Which feature owns
  `needs-user-panel` or `prepare-change-panel` is a judgement about what the
  file is for, made from its callers. A different reader could put either
  somewhere else and no test would object.
- **One rewrite pass was wrong and the tools caught it, not me.** Relative
  imports inside moved files were first resolved against the new directory
  instead of the old, and a later pass rewrote `source()` arguments in three
  suites that have their own local reader with a different base. The typecheck
  found the first and the suite found the second; both are fixed, and neither
  would have been visible in a diff review.
- **Node 22 ran the suite; the engine field says 24.**

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 542 files, 9,561 tests, all passing (unchanged from before the
  slice; no test was added or removed, and every path-pinned suite was
  re-pointed).
- `pnpm test:e2e` — not run; see above.
