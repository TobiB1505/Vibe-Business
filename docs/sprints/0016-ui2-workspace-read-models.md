# Sprint UI-2 — Workspace Read Models and Route Split

**Status: complete. Phases A–C (read models) and Phase D (route split) both delivered.**

## Goal

UI-2's brief states its own ordering: *better boundaries before more routes*, and *"the route
split happens only after the required shared read models / services exist"*. This sprint built
the three boundaries first, then the seven routes on top of them.

## Context

UI-1 left three findings that this sprint answers directly:

1. Activity was write-only — `audit-log` exported `recordAuditEvent` and nothing else.
2. Prepared was the biggest split risk: ten services stitched together inline in `page.tsx`,
   paid for by every section of the workspace.
3. Impact had no read model of its own; it was a by-product of rendering a prepared change.

## Scope Delivered

### Phase A — Activity read path

`listAuditEventsForProject` + an Activity view model, and the honest "not available yet" state
replaced by real events.

**The finding that shaped it:** `audit_events` is **user-scoped with no `project_id` column** —
`user_id`, `event_type`, `metadata`, `created_at`. That was correct for Sprint 1, where the log
recorded account-level GitHub authorization. Callers belonging to a project put `projectId` in
`metadata`, so a project's activity is the caller's own events whose metadata names it.

**Security — three independent layers, none allowed to be the only one:**

- RLS (`select own audit_events` → `auth.uid()`).
- An explicit `user_id` filter, so the guarantee survives a policy changing underneath the code.
- Project ownership established by the caller before the query is reached; the function takes
  `userId` rather than reading a session itself.

It uses the caller's RLS-bound client. The service-role client bypasses RLS and is restricted to
durable execution (CLAUDE.md rule 53); a feed is not a reason to reach for it.

**Ordering** is `created_at desc, id desc`. The tiebreaker is load-bearing — several events are
written inside one statement and share a timestamp, and without it a paged read can skip or
repeat one. Paging reads one row beyond the page so `hasMore` costs no second query.

**The view model** reads a deliberate allowlist of metadata keys rather than spreading the blob,
so a future writer recording something it should not cannot leak it here by default. Tone is
derived from the event suffix — a new `*.failed` cannot render as success — with explicit
exceptions where the suffix would mislead: a blocked merge is a guard working, and
`not_observed` is about the customer's product rather than about Vibe.

### Phase B — Prepared workspace read model

`getPreparedChangeWorkspace` (full card) and `listPreparedChangeSummaries` (the cheap list read,
deliberately *not* derived from the full card, because deriving it would mean paying for the
full card first).

A move, not a rewrite: read order, arguments, failure resolvers, the conditions guarding the
expensive calls and every safety comment were preserved exactly.

**The honest measure of how coupled the page was:** removing the loop made **14 service imports
unused**, and `page.tsx` went from 768 to 628 lines.

### Phase C — Project impact read model

`getProjectImpact` skips unmerged changes before reading outcome or measurement — an unmerged
change would spend six database reads to be told "unavailable".

It aggregates nothing: no project total, no average, no overall impact number. Nothing in the
data model supports one, and a summed delta across unrelated metrics would be a fabrication.
There is still no connected metric source, so business impact still answers `source_required`.

## Validation

- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 138 files, 2660 tests (39 new: 11 for the read path's scoping/ordering/paging,
  15 for the view model's allowlist and tones, 13 asserting the routes as a set).
- `pnpm build` — succeeds.
- `pnpm test:e2e` — 58 chromium tests, unchanged.
- Browser, real signed-in session and real data: all seven routes render with 200; Activity
  shows real recorded events; Impact shows commit `78cbdac`, merged 14 Aug 2026 14:40 UTC,
  "Production outcome verified"; Overview shows 39/100, 3 opportunities, 2 prepared changes.
- Security, verified in the browser: every route answers **404** for a project id that is not
  the caller's and leaks no project data; every route **307**s to login without a session.
- Navigation: exactly one entry carries `aria-current="page"`, correct after browser Back and
  after a hard refresh.
- Responsive: `scrollWidth === clientWidth` at 1440, 768 and 375.

### Two source assertions migrated, not weakened

`outcome-ui.test.ts` and `business-impact-ui.test.ts` asserted that `page.tsx` performs a read
and never starts a verification or a measurement. The reads moved to the read model; the rule
did not. They now assert across **both** files — whichever performs the read, neither may start
anything. Strictly broader than the versions they replace.

## Phase D — The route split

Seven routes under `/app/projects/[projectId]`: the index (Overview), `/score`, `/moves`,
`/prepared`, `/deep-scan`, `/impact`, `/activity`.

### Shared layout

Loads the project's identity and repository connection, and nothing else. A layout runs on every
route beneath it, so anything loaded there is paid for by all seven sections — the cost Part 1
existed to escape.

**The navigation lost its count badges.** UI-1 showed "3" beside Next moves and "2" beside
Prepared; those came free because the page had already loaded both. In the layout they would
cost an opportunity read and a prepared read on every route. They were removed rather than
quietly re-introducing the coupling, and can return when a cheap counts query exists.

### Security

`requireProjectAccess` runs **per route**, not in the layout. An App Router layout does not gate
the routes beneath it — layout and page render independently, and a page is reachable by direct
URL whether or not its layout would have refused. Verified in the browser: every route answers
404 for a project id that is not the caller's, and leaks nothing; every route 307s to login
without a session.

### Navigation

`ProjectNav` derives the active section from `usePathname`. Verified: exactly one entry carries
`aria-current="page"`, it follows browser Back, and it survives a hard refresh. Desktop keeps
the rail; below `lg` it is a horizontal scrollable strip.

### Data Loading Matrix

| Route | Loads | No longer pays for |
|---|---|---|
| Overview | audit score, opportunity count, **prepared summaries**, evidence rows, 5 activity entries | prepared workspace, per-opportunity execution assembly |
| `/score` | audit, currency, evidence flags, Deep Scan model | prepared workspace, impact |
| `/moves` | opportunities, readiness, execution summaries + per-opportunity validation | preview, review images, approval, merge preflight, outcome, impact |
| `/prepared` | the full workspace read model — legitimately | — |
| `/deep-scan` | access, snapshot, session, surfaces | everything else; also the only route carrying `maxDuration = 120` |
| `/impact` | merge state, outcome, measurement | preview, review images, validation detail |
| `/activity` | one bounded audit-log read | everything else |

`BUSINESS_AUDIT_ANCHOR` was **not** changed. It is a tested domain constant that a blocked
opportunity set links at, and that link is the only way out of that state. The section keeps the
id `business-audit` on the `/score` route, so the anchor still resolves; the route supplies the
URL prefix as a prop, because which URL the audit lives at is a routing fact rather than a
domain one.

## Remaining Risks

- **No index behind the Activity filter.** `metadata->>projectId` is not indexed;
  `audit_events_user_id_created_at_idx` covers the user scan but not the project predicate. Fine
  at current volumes, and the reason the read is capped at 50 with a hard ceiling of 200. The
  real fix is a `project_id` column plus an index, which is a migration and a backfill.
- **Prepared assembly is still sequential.** One change at a time, each performing six-plus
  reads. The extraction did not parallelise it, deliberately — that is a behaviour change and
  belongs in its own commit with its own verification.
- **`getProjectImpact` re-reads merge state** that the prepared workspace also reads. On the
  single page both run. Once they are separate routes each pays only for itself; until then this
  is a duplicated read, and it was accepted rather than hidden behind a shared cache that would
  have to be invalidated correctly.
- **Signed review-image URLs are minted per render** of a prepared change. Unchanged by this
  sprint, but it is now isolated in one function where a future sprint can bound it.

## Next Recommended Phase

**UI-3 — motion**, which has been deferred since UI-0 and now has a stable structure to animate.

Two smaller pieces worth doing first or alongside:

1. **A `project_id` column on `audit_events`**, with an index and a backfill. It removes the
   Activity read's only real weakness and is a contained migration.
2. **A cheap counts query**, which is what the navigation badges need to come back.

A `/prepared/[executionId]` detail route was considered and **not** built. With two prepared
changes the list is not expensive enough to justify it, and splitting approval and merge across
a list and a detail view would put the most consequential controls behind an extra navigation
step for no current benefit. It becomes worthwhile when a project routinely carries enough
prepared changes that loading them all is the cost — that is the signal to revisit.
