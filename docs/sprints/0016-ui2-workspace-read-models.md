# Sprint UI-2 (Part 1) — Workspace Read Models

**Status: Phases A–C complete. Phase D (route split) not started — see Scope Delivered.**

## Goal

UI-2's brief states its own ordering: *better boundaries before more routes*, and *"the route
split happens only after the required shared read models / services exist"*. This sprint built
the three boundaries. The routes are the next, separately verifiable step.

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

## Data Loading — what is now possible

Not yet realised as routes, but this is the point of the boundaries:

| Consumer | Needs | Previously also paid for |
|---|---|---|
| Business score | audit, currency, evidence notice | review-image signing, preview origins, merge preflight, impact reads |
| Activity | one bounded audit-log read | the entire prepared assembly |
| Deep Scan | access, snapshot, session, surfaces | the entire prepared assembly |
| Impact | merge state, outcome, measurement | preview, review, validation detail, signed URLs |
| Prepared | all of it — legitimately | — |

## Validation

- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 137 files, 2647 tests (26 new: 11 for the read path's scoping/ordering/paging,
  15 for the view model's allowlist and tones).
- `pnpm build` — succeeds.
- `pnpm test:e2e` — 58 chromium tests, unchanged.
- Browser, real signed-in session: Activity renders real recorded events (preview, review,
  validation, operations) with real timestamps; Impact reads through its own model and shows
  commit `78cbdac`, merged 14 Aug 2026 14:40 UTC, "Production outcome verified".

### Two source assertions migrated, not weakened

`outcome-ui.test.ts` and `business-impact-ui.test.ts` asserted that `page.tsx` performs a read
and never starts a verification or a measurement. The reads moved to the read model; the rule
did not. They now assert across **both** files — whichever performs the read, neither may start
anything. Strictly broader than the versions they replace.

## Not Delivered — Phase D (route split)

The seven routes, the shared layout and the URL-based active state were **not** started.

**Why:** a route split is only safe when it is finished. Half of it leaves two navigation models
disagreeing, some sections reachable by URL and others only by anchor, and the approval/merge
path — the most consequential screen in the product — served from a layout whose data
dependencies have not been re-verified end to end. The current anchored workspace works, is
tested and is dogfooded; replacing it partially would be a regression.

What UI-2 Part 2 inherits is the part that made the split dangerous: the boundaries now exist,
so each route can load only what it needs rather than copying the page's assembly.

**Remaining before routes:** `PROJECT_SECTIONS` still carries anchor hrefs; `BUSINESS_AUDIT_ANCHOR`
is a tested domain constant that must be migrated deliberately (a blocked opportunity set links
at it, and that link is the only way out of that state); and the navigation needs `usePathname`
with `aria-current="page"`.

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

**UI-2 Part 2 — the route split**, in the order UI-1's readiness table implies: shared layout
first, then the low-risk routes (`/score`, `/deep-scan`, `/activity`), then `/moves` and the
Overview summary, then `/prepared`, and `/impact` last. Navigation switches to real links with
`usePathname` in the same change as the first route, so there is never a moment with two
navigation models. Motion remains its own sprint.
