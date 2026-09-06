# 0135 — The empty route table

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`
Decision: [ADR 0081](../decisions/0081-routes-belong-to-an-application.md)

## What this was for

[ADR 0078](../decisions/0078-the-validation-profile-is-a-build-contract.md) taught the validator where an application lives. Nothing else learned it, and the consequence was measurable against a real project rather than inferred.

## The finding

From the production database, across four connected repositories:

| Project | `routes.mode` | Routes |
|---|---|---|
| Vibe-Business | `app_router` | 39 |
| **planner-agent** | **`limited`** | **0** |
| Jandia-Arena | `limited` | 0 |
| Urlaubsplanung | `none` | 0 |

`planner-agent` is a Next.js App Router application. Its code is in `frontend/`, and `findRouterRoot` looked in `src/app/` and `app/` — both anchored at the repository root. The answer was not "could not read this", which would have been actionable. It was **an empty route table**, indistinguishable from a project with no router at all.

Everything downstream inherited the assumption. `resolveAppRoot` re-derived the root with `^((?:src/)?app)/` over route source paths, so it returned null and the **free** SEO capability refused with `unsupported_repository_layout`. The review classifier had no route table. Surface detection, which reads routes, was weaker for the same repositories.

**The shape of the result was backwards.** ADR 0078 had just made `planner-agent` servable by the *paid* agent at 150–350 Credits, while the *free* generator went on refusing it. The free half of execution was narrower than the paid half.

**And the plan screen promised what the button broke.** The registry's `matches()` asked `detectsFramework(repository, "nextjs")` — the repository-wide union, which says yes for an application three directories down — and never asked whether there was anywhere to write. The step was labelled as free work Vibe does; the start then refused it.

## Shipped

**The router is looked for inside the applications.** `detectRoutes` takes the build targets and searches `<target>/src/app/` and `<target>/app/`, preferring `src/app/` within one application because that is Next.js's own resolution order. With no build targets it falls back to `.`, so a repository the build detector cannot describe keeps exactly the search it had.

**Two applications with routers is refused, not resolved.** Picking the first would put a guess where a fact belongs. That is `resolveAppRoot`'s own rule, moved one layer earlier to where the evidence is: the detector can see all the candidates; the writer only ever saw source paths.

**The root is recorded, not re-derived.** `RouteIntelligence.root` says which directory the routes came from. Every consumer that rebuilt it from a source path was rebuilding the repository-root assumption with it, and there is now nothing to rebuild.

The field is optional, and its absence is the honest answer for a pre-v6 snapshot rather than a gap: that analyzer only ever looked at the repository root, so deriving the old way from its data is the correct reading of what it produced. `resolveAppRoot` keeps that derivation for exactly those rows, and a test says why.

**A match now implies an executor.** The registry requires a resolvable app root as well as the framework. Checked there *and* in `execution/service.ts` immediately before writing, and both are load-bearing: one decides what a plan may claim, the other asks live state (rule 55).

## What the tests found

**A fixture describing a repository that cannot exist.** `fakeRepositorySnapshotFor` returned `routes: { mode: "app_router", routes: [], truncated: false }` — an App Router with nowhere to write, a shape no analyzer emits. It went unnoticed for as long as the registry asked only about frameworks; six suites went red the moment it asked where the application is. It carries a root now, with an override for the repository that has none.

**`resolveAppRoot` had no test at all** while deciding which directory a customer's `robots.ts` lands in — the requirement its own docblock states is *"do not write to the wrong package"*. It has one now, including the pre-v6 fallback and the case that fallback cannot answer.

## Two flakes, fixed rather than re-reported

`business-audit.spec.ts` failed three times in one session, always the same two layout tests, always passing alone. Both read `boundingBox()` immediately after `goto` on a map that animates in — a single sample measures a frame, not the design. Retried until the layout settles; the assertions are unchanged, and a footprint that genuinely differs still fails at the timeout.

Making that honest exposed a second one in `one-loop.spec.ts`: the swipe test aimed a drag at a mid-animation position, and its overflow check sampled the carousel while it was still sliding — 7px wide in transit, settled afterwards. The box is now read once it stops moving, and `expectNoHorizontalOverflow` polls, because *"the page does not scroll sideways"* is a claim about where a layout settles, not about every frame of a transition.

Neither is in this change's subject matter. Both were left in place through three full runs before that stopped being tolerable.

## What this does not prove

**No v6 snapshot exists yet.** Every claim above about `planner-agent` is about what the code will now do with a repository whose shape was read from the database — not about a snapshot the new analyzer has produced. The founder's re-scan is what will show it, and until then `planner-agent`'s stored routes are still the empty table.

**Every project is stale once more.** `ANALYZER_VERSION` → `repo-intelligence-v6`, because what a route *is* changed. Rule 60 keeps the re-scan the founder's to start; the Agent screen says so and links to it, which is the only reason a second staleness round is acceptable rather than merely tolerated.

**The free half is still Next.js-only.** A Vite repository gains routes it never had, and still has zero deterministic capabilities — ADR 0078's consequence, unchanged and still named.

Domain 7,701 across 446 files · SQL 312 · browser 488 · lint 0/0 · build green.
