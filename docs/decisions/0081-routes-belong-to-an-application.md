# 0081 - Routes are read relative to the application, and the router root is recorded

Status: Accepted
Date: 2026-09-03

Extends [0078](0078-the-validation-profile-is-a-build-contract.md) from validation to the intelligence layer that feeds everything else. Changes no write policy, no capability scope and no approval rule.

## Context

ADR 0078 taught the *validator* where an application lives: a build target is a directory with a manifest, a `build` script and a lockfile Vibe can install from. Nothing else learned it.

`detectors/routes.ts` looked for a router in exactly two places:

```ts
const candidates = [`src/${directory}/`, `${directory}/`];
```

Both anchored at the repository root. Read out of production, `planner-agent` — a real Next.js App Router application whose code lives in `frontend/` — reported `routes.mode: "limited"` with **zero routes**. Not "could not read this", which would have been actionable: an empty route table, indistinguishable from a project that has no router at all.

Everything downstream inherited it:

- `resolveAppRoot` re-derived the root with `^((?:src/)?app)/` over the route source paths, so it returned null and the **free** SEO capability refused with `unsupported_repository_layout`;
- the review classifier had no route table to reason about;
- `businessSurfaces` derives partly from routes, so surface detection was weaker for the same repositories.

The result was backwards: ADR 0078 had just made `planner-agent` servable by the **paid** agent (150–350 Credits), while the free generator still refused the same repository. The free half was narrower than the paid half.

And the capability registry made a promise it could not keep. `matches()` asked `detectsFramework(repository, "nextjs")` — the repository-wide union, which says yes for an application three directories down — and never asked whether there was an app root to write into. So a plan step was labelled as free work Vibe does, and the start then refused it. A plan that promises what the button breaks is worse than a plan that says nothing.

## Decision

**The router is looked for inside the applications, and the directory it was found in is recorded on the snapshot.**

`detectRoutes(context, frameworks, build)` searches `<target>/src/app/` and `<target>/app/` for each build target — preferring `src/app/` within one application, which is Next.js's own resolution order rather than a preference of ours. With no build targets it falls back to `.`, so a repository the build detector cannot describe gets exactly the search it always had.

**Two applications with routers is refused, not resolved.** Picking the first would put a guess where a fact belongs. That is the rule `resolveAppRoot` already applied to *writing*, moved one layer earlier to where the evidence actually is — the detector can see all of them; the writer only ever saw source paths.

**`RouteIntelligence.root` is recorded rather than re-derived.** Every consumer that reconstructed it from a route source path was reconstructing the repository-root assumption along with it. `resolveAppRoot` now reads the value; there is nothing left to reconstruct.

The field is optional, and its absence is the honest answer for a snapshot written before `repo-intelligence-v6`: that analyzer only ever looked at the repository root, so deriving the old way from its data is the correct reading of what it produced — not a compromise. `resolveAppRoot` keeps that derivation for exactly those rows.

**A registry match now requires a resolvable app root.** The framework check stays — cheap and categorical — and the app-root requirement is the one that makes a match mean *an executor exists for this*. It is checked here **and** in `execution/service.ts` immediately before writing, and both are load-bearing: this one decides what a plan may claim, the other asks the same question of live state, because a repository can be restructured between them (rule 55).

## Consequences

**A real project moves from "unsupported layout" to free, deterministic work.** `planner-agent` gets a route table, an app root, and the SEO capability its repository always qualified for.

**Every stored snapshot is stale once more.** `ANALYZER_VERSION` → `repo-intelligence-v6`, because what a route *is* changed. Rule 60 forbids Vibe from re-analysing on the founder's behalf, so each project needs one click — and since [ADR 0080](0080-the-probe-that-could-not-fail.md)'s sprint the Agent screen says so and links to the scan, which is what makes a second staleness round acceptable rather than merely tolerated.

**A fixture that described a repository which cannot exist was found by asking.** `fakeRepositorySnapshotFor` claimed `app_router` with no root and no routes — a shape no analyzer emits. Nothing noticed while the registry asked only about frameworks; six suites failed the moment it asked where the application is. The fixture now carries a root, with an override for the repository that has none.

**What this does not do.** It does not make the SEO generator serve a second framework — deterministic capabilities remain Next.js-only, and a Vite repository still has zero of them (ADR 0078's consequence, unchanged). It does not resolve a repository with two routers; that stays refused. And no snapshot has yet been produced by the v6 analyzer against a real repository — the founder's re-scan is what will show it.
