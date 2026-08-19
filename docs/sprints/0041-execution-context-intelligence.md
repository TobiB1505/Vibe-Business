# EXECUTION CONTEXT INTELLIGENCE — Part A inventory

What already exists, read out of the codebase before anything was written. The
short version: **almost everything this sprint needs is already stored, versioned
and revision-bound. Nothing new needs to be scanned.** What is missing is the
step that selects from it.

## Inventory

| Data source | Durable representation | Revision-bound? | Reaches the agent today? | Useful for a brief? |
| --- | --- | --- | --- | --- |
| Repository scan | `repository_intelligence_snapshots.result` → `RepositoryIntelligenceSnapshot` | **Yes** — `source.commitSha`, `source.branch`, `analyzerVersion`, `treeComplete` | Only three fields: framework list, package manager, `baseSha` | **Yes — the core of it** |
| Routes | `routes: { mode, routes[], truncated }`, each with `path`, `kind`, `dynamic`, **`sourcePath`** | Yes (inside the snapshot) | No | **Yes — file candidates come from here** |
| Business surfaces | `businessSurfaces[]` — a closed 14-value vocabulary incl. `robots`, `seo_metadata`, `sitemap`, `authentication`, `dashboard_app`, each with `detected`, `confidence`, `evidence[]` | Yes | No | **Yes — task→surface is the selection key** |
| Frameworks / runtime / languages | `Detection[]` with `confidence` + `evidence[]` | Yes | Names only, no evidence | Yes |
| Package manager | `PackageManagerId` | Yes | Yes | Yes |
| Project structure | `topLevelDirectories`, `sourceFileCount`, monorepo apps/packages | Yes | No | Yes |
| Live product scan | `live_product_intelligence_snapshots.result` | **No** — bound to an *origin*, never to a SHA | No | Yes, but only as `unknown` relation |
| Authenticated scan | `authenticated_product_intelligence_snapshots.result` | No | No | Partly |
| Product profile | `product_profiles.result` → `ProductProfile`, joining `repository_snapshot_id` + `live_snapshot_id` + `authenticated_snapshot_id`, with `schema/builder/evidence/prompt` versions and an `input_hash` | **Transitively** — through its repository snapshot | No | Yes |
| Business audit | `business_readiness_audits` | No | No | Only the step's own findings |
| Opportunities | `opportunity_sets` / `business_opportunities` | No | Via `opportunityId` on the spec | Identity only |
| Action plan + steps | `action_plans` / `action_plan_steps` | No | **Yes** — goal, step title, purpose, doneWhen, expectedChangedState, preparation | Yes |
| Founder intent / decisions | `project_founder_intent`, `project_business_context`, and `spec.businessContext.approvedDecisions` | Hashed into the spec identity | **Yes** | Yes |
| Execution specs | `execution_specs.spec` → `ExecutionSpec` | **Yes** — `repository.baseSha` **and** `repository.repositorySnapshotId` | It *is* the input | Yes |
| Execution history | `agent_execution_runs`, `agent_execution_events`, `prepared_changes` | Yes (`base_sha`) | No | Later; out of scope here |

## The three findings that shape the design

**1. `product_profiles` already is the versioned Product Intelligence Snapshot
that PART B describes.** It has a project, a schema version, a builder version,
an evidence version, an input hash, and foreign keys to all three underlying
scans. Introducing a second object with the same job would be the duplicate
source of truth PART A forbids. So this sprint introduces **no new intelligence
table** — only a compiler over what is stored, and columns on the run row
recording which snapshot an execution used.

**2. The freshness pair already exists on the spec.** `ExecutionSpec.repository`
carries both `repositorySnapshotId` and `baseSha`. The check PART C asks for is
therefore a read, not a new mechanism: load the snapshot the spec names, compare
its `source.commitSha` to the spec's `baseSha`.

**3. Live product intelligence is bound to an origin, not to a commit.** There
is no column anywhere that ties a deployed URL to a Git SHA, and there is no
evidence available to establish one. Its relation to the repository is therefore
`unknown` — stated, not inferred. Claiming `verified` would require a deployment
record this product does not have.

## What was missing, and is what this sprint builds

Everything above is stored. What did not exist is the step between *stored* and
*sent*: something that takes one action-plan step and selects the handful of
facts that bear on it. Today the agent gets three repository fields and an
instruction to go and look at everything else.

## Decisions taken from this inventory

- **No new intelligence table.** `execution_context_briefs` records what was
  *compiled and sent*, which is execution history rather than intelligence, and
  nothing else stores it.
- **Facts are typed and evidence-backed** using the confidence vocabulary the
  repository analyzer already uses (`high` / `medium` / `low`), not a new score.
- **File candidates come from `routes[].sourcePath` and `businessSurfaces[].evidence[].path`.**
  Both are already repository-relative paths produced by Vibe's own analyzer at a
  known commit. Nothing is guessed and no path is hardcoded.
- **Task→surface mapping is derived from the step's own text against the closed
  `BusinessSurfaceId` vocabulary**, so it generalises without naming any task.

---

# What was built

`src/modules/execution-context/` — a module, not a page. The Dogfood surface
hosts one inspector group; everything else is reusable, which is what makes the
eventual production move an integration rather than a rewrite.

| File | What it is |
| --- | --- |
| `brief.ts` | The typed domain: closed vocabularies for fact subjects, sources and confidence; `FileCandidate` with its three derivable reasons; `BriefFreshness`; `LiveProductContext`; `BRIEF_BUDGET`; deterministic ranking |
| `compiler.ts` | The freshness gate, the step→surface selector, repository/spec/profile facts, file candidates |
| `render.ts` | The brief as bounded prompt text, under the byte ceiling that actually binds |
| `service.ts` | Loads the snapshot the spec names, the product profile and the live origin — three optional reads, no new storage |
| `usage.ts` | What the run read, counted against what it was offered. Raw integers only |
| `test-support.ts` | Snapshot fixtures with routes and surfaces, layered on the execution contract's own |

Plus: `agent-prompt-v2` in `coding-agent/prompt.ts`, two event types
(`context_compiled`, `context_used`), nine nullable columns on
`agent_execution_runs`, and an inspector group behind the developer disclosure.

## The prompt, before and after

**v1 — the whole of what the agent was told about the repository:**

```
<untrusted source="repository-facts">
Repository: TobiB1505/Vibe-Business
Frameworks detected: Next.js
Package manager: pnpm
Working copy is checked out at commit be5fb53d…
</untrusted>

# Start
Read enough of the repository to know where this belongs, make the change, run
the checks, and fix what they find. Then stop.
```

**v2 — the same block, for a crawler-indexing step, under 2 KB:**

```
<untrusted source="vibe-repository-briefing">
Repository: TobiB1505/Vibe-Business

Vibe analysed this repository at commit be5fb53d1c2a, which is the commit your
working copy is checked out at. Paths below were real then.

What Vibe already established:
- framework: Next.js [repo scan, high] — seen in package.json
- routing: Next.js App Router; route files live under src/app/ [repo scan, high] — seen in …
- api: API routes live under src/app/api/ [repo scan, high] — seen in …
- surface: robots.txt: not found at this commit [repo scan, high]
- surface: SEO metadata: present [repo scan, high] — seen in src/app/layout.tsx
- public pages: Pages: /, /pricing, /app/dashboard [repo scan, high] — seen in …

Files Vibe's analysis points at for this step (a starting point, not the answer):
- src/app/layout.tsx (SEO metadata) — Vibe's analysis cites this for this surface [high]
- src/app/app/layout.tsx (layout for /app) — layout, where site-wide concerns live here [medium]

Probably not involved in this step: public, supabase, docs, scripts.
</untrusted>

# Start
Confirm the few things above that your change actually depends on, make the
change, run the checks, and fix what they find. Then stop. If the briefing does
not match what you find, believe the repository and keep going.
```

The two layouts named there are the two files run #3 actually changed — after
fourteen file reads and ten commands spent finding them.

## The four things that could have gone wrong, and what stops each

**Duplicating stored intelligence.** No new intelligence table. The brief is a
pure function of the spec and the snapshot the spec names, so it is recomputed
rather than persisted; only *what a run was given and what it read* is stored,
because nothing else stores that.

**Hardcoding the benchmark task.** No path and no task name appears in
`compiler.ts`. Candidates come from `routes[].sourcePath` and
`businessSurfaces[].evidence[].path`; where a *new* file goes is answered by a
`router` fact naming the directory this repository's own route files were
observed in, not by a surface→path table. A test compiles a pricing step through
the same code and gets pricing surfaces with no code change.

**A confidently wrong map.** The freshness gate is string equality on the commit
and nothing else. Not fresh means every repository-derived fact and every file
candidate is withheld, the prompt falls back to v1, and the instruction falls
back to *read before you write*.

**A new injection surface.** The brief is fenced, cannot reach the system
prompt, and is structurally hostile to prose: typed subjects, 200-byte
whitespace-collapsed values, dropped-not-truncated paths, and a refusal for any
path that escapes the repository.

## What is deliberately not measured

No context hit rate. No AI efficiency score. Nine raw integers a person can
compare between two runs of the same step, and the honest statement that reading
a briefed file proves the agent opened it — never that opening it is what made
the change correct. Independent validation remains the only verdict.

## Run #4 benchmark plan

Not run. The comparison, when it is approved, is against run #3's own recorded
numbers on the same class of task:

| | Run #3 (`f437f231`, v1) | Run #4 (v2) |
| --- | --- | --- |
| Provider calls | 21 | — |
| Duration | 8m 44s | — |
| Provider cost | $0.3465 | — |
| Files read | 14 | — |
| Commands | 10 | — |
| Context bytes sent | 0 | — |
| Offered files read | n/a | — |
| Files read beyond the brief | n/a | — |

Every row on the right is now a column on `agent_execution_runs`, so the
comparison is a query rather than a reconstruction.

## Gate

Typecheck clean, **4,933 unit tests**, **304 E2E**, eslint 0 errors, `next build`
green. The migration went out through the Supabase MCP — the CLI workflow is
unavailable in this container — with the remote history inspected first (rule 30)
and the ledger version reconciled to the filename afterwards (rule 34).

## Not touched, on purpose

Validation semantics, recipe executors, write scope, file-count and diff
budgets, sandbox network policy, gateway budgets, billing. None of them reads a
brief, and nothing in a brief widens any of them.
