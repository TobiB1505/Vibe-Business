# UI-S2 — One Loop, One Story: Audit → Opportunity → Action → Prepared Change

**Status:** implemented on `claude/ui-first-ten-minutes-hktge8`. No migration. No provider call. Not merged.

**Branch base:** `0c08c89` (`origin/main`), which contains UI-S1 (PR #44). The sprint asked for
`feat/ui-one-loop-one-story`; this execution environment permits pushing to one assigned branch
only, so the assigned branch was restarted from the merged `main` and used instead. It carried no
unmerged commits at that point.

## Audit finding addressed

**F-1 — the diagnosis → action seam.** Vibe already understood what was wrong, already ranked what
to do about it, and already *stored which audit conclusion each Move answers*. What it did not do
was say so. The audit and the Moves read as two independent products with two ranking vocabularies,
and the founder was left to work out how one led to the other.

Related, and fixed here: the Opportunity card's five equal-weight chips, the run-audit lifecycle
handoff, and the prepared-completion handoff.

## Problem

The relationship existed in the database and nowhere on screen.

`sourceConclusionKey` has been the authoritative link since `business-opportunity.v2` — the engine
reads the audit's conclusions, decides what to do about each, and records which one it answered.
The Action Planner has consumed it for a sprint. The **UI ignored it entirely.**

So the audit's top priority linked to `/moves`, which opened the whole ranked list with nothing
saying which of them answered the finding the founder had just read. And a Move card said `#2`,
`Medium effort`, `High confidence`, `Monetization` and `Ready for Vibe` in one row of five chips —
the one that decides what a founder can *do* sitting beside four that do not, and a business
dimension competing with the audit lineage to answer the same question: *why is this here?*

Three smaller failures around the same loop:

- **Running an audit left a stale verdict on screen.** The button knew a run had started and said
  so. The page did not, so the entire completed audit below it — headline, map, priorities —
  stayed rendered as current until something else re-rendered the route.
- **Preparing a change led nowhere.** It said "Change prepared" and offered an inline diff. The
  actual prepared change, with its validation, preview, review and approval, sat on a screen the
  founder had to find in the navigation.
- **An audit with no Moves was a dead end** — one sentence stating the absence, with nothing to do
  about it.

## Core decision

**Audit and Moves are not independent product surfaces.** Moves are the actionable continuation of
audit conclusions, and the UI now says which conclusion each one continues.

## Identity rule

Lineage resolves through `(source audit, conclusion key)` and nothing else. Titles, headlines,
dimension labels, rank and array position are all deliberately unused. `resolveMoveLineage` is a
pure function whose test suite includes a Move whose title is *identical* to a conclusion it does
not cite — a resolver that fell back to text similarity would attach it to the wrong finding and
look entirely convincing doing so.

A key that names nothing in the audit produces **no lineage**, never a substitute. That is the same
rule as a fabricated evidence id (Rule 45).

## Historical identity

The audit a set is resolved against is **the set's own** (`businessAuditId`), never the newest one.
Both audits have a `blocker-1`; they are different findings. Resolving a historical set against the
current audit would silently rebind every Move to whatever conclusion now sits at that position —
not a display bug, but the product asserting a causal link nobody made.

The audit screen enforces the same rule from the other side: contextual links are computed only when
`opportunities.set.businessAuditId === latestAudit.id`. When they differ, the primary priority still
links to the Moves list; what it stops claiming is that those Moves answer *this* finding.

## Ranking rule

**Persisted rank stays authoritative. Context elevates; it never reranks.** `partitionByContext`
returns both groups in the engine's own order and no code path renumbers anything — the card shows
`opportunity.rank`, so a Move shown first because it answers the finding still reads `#2`. The
browser suite asserts the rank sequence `1, 2, 3, 4` across a contextual entry precisely so a
"context rank" cannot be introduced quietly.

## Readiness rule

**Priority ≠ executability.** Whether a card offers a write is decided by whether an executor
exists, on the server, exactly as before — a `Ready for Vibe` badge alone still produces no button.
The browser suite pins all four situations: one preparable Move offers exactly one primary action,
`needs_user_input` offers none, `not_supported_yet` offers none, and a dependency is stated on the
card rather than discovered after clicking.

## What changed

| Area | Change |
|---|---|
| `opportunities/lineage.ts` | New pure module: resolve, count, validate a requested key, partition by context |
| `business-audit/store.ts` | `getProjectAuditById` — an explicitly project-scoped read for the new lookup boundary |
| `opportunities/service.ts` | `getMoveLineage` — one query for the whole list |
| `current-priorities.tsx` | Priority #1 links with its conclusion key; secondaries get quieter links; the no-moves dead end becomes "Find my next moves" |
| `moves/page.tsx` | Reads and validates `?from=`, resolves lineage |
| `opportunities-panel.tsx` | Context header, elevation, chip diet, visible dependencies, effort/confidence demoted |
| `prepare-change-panel.tsx` | "Review prepared change" → the exact change, by id |
| `prepared-changes-section.tsx` | Each card addressable by `#prepared-change-<id>` |
| `run-audit-button.tsx` | `router.refresh()` on acceptance, so the page enters the lifecycle |

## Validation

- **Unit:** 3,808 green (39 new) — 18 pinning the identity and ranking rules in
  `lineage-resolution.test.ts`, 21 pinning the wiring the browser cannot see in
  `one-loop.test.ts`.
- **Browser:** 235 green (30 new), Chromium, production build, fixtures only — no AI call, no
  GitHub write, no sandbox spend, no database.
- `pnpm lint` — 0 errors (5 pre-existing warnings). `pnpm typecheck` — green. `pnpm build` — green.
- **Screenshots reviewed by eye** at 1440 and 390: audit priorities, ranked Moves, contextual Moves,
  "Why now?" expanded, empty, stale, prepared. Zero horizontal overflow at every width.

### What looking at it found that the tests did not

In a contextual entry, every elevated card repeated the context header's finding directly under its
title — the same sentence three times on one screen. The per-card lineage label now renders only
where it earns its place: on the default list, where each card answers a different finding. Every
assertion passed before and after.

### Regressions these tests would catch

All ten the sprint named, each in a test that names it: `sourceConclusionKey` ceasing to be the
relationship; a prose fallback; the audit's action going inert; context opening everything; the chip
soup returning; an unsupported Move gaining an execution CTA; the prepared link disappearing; the
prepared link resolving by recency rather than identity; run-audit not entering the lifecycle; and a
historical Move rebound to the newest audit.

## A file this sprint nearly destroyed

The new resolver's tests were first written to `lineage.test.ts` — a name that already belonged to
115 lines covering where lineage is **created**: that the model is shown the conclusion keys, and
that a key it returns is verified against the audit rather than trusted. Overwriting it removed six
real tests while the total count went *up*, which is exactly why the number is a bad detector.

The original is restored untouched and the new tests live in `lineage-resolution.test.ts`, with each
file's header naming the other. Created and read are genuinely different questions about the same
relationship, and both are worth holding.

## Two existing browser assertions were changed

Neither weakened. Both pinned behaviour this sprint deliberately changed.

`business-audit.spec.ts` asserted the handoff link ends in `/moves`; it now asserts it ends in
`/moves?from=blocker-1`, which is the same claim plus the context. And it asserted that no CTA
appears when no Moves exist — the dead end §19 exists to remove — so it now asserts the honest
sentence *and* a way forward.

## Deferred

Explicitly untouched, as scoped: the Prepared card redesign, validation/preview/review/approval/merge
UI, the execution pipeline, stale disclaimers, the success state, global Button and StatusPill
migration, a Dialog primitive, app-wide loading architecture, Deep Scan, and the workspace
performance refactor. The Business Map, the audit's reading order, the Opportunity prompt, ranking
model and schema are all unchanged.

## Risks and follow-ups

**The prepared handoff is a fragment, not a focus state.** `#prepared-change-<id>` scrolls the card
into view and CSS `:target` outlines it. It does not move keyboard focus, and there is no "just
prepared" label. That is the smallest mechanism that satisfies "I prepared this → take me to this",
and a fuller orientation affordance belongs with the Prepared redesign rather than ahead of it.

**A Move addressing several conclusions is not representable.** `sourceConclusionKey` is singular,
and §25 says respect that. If the schema ever becomes plural, `resolveMoveLineage` is the one
function that has to learn about it.

**Not dogfooded against a real project.** Every layer is covered — the rule by unit tests, the
wiring by contract tests, the screens by the browser — but no founder has walked Audit → Move →
Prepare → Prepared on real data. Rule 69's fourth question is unanswered, and it is the same gap
UI-S1 carries.

**Cards with a prepared change now stack three controls** — "Review prepared change", "Preview the
diff here" and the validation panel's "Validate change". The primary is unambiguous, but the card is
denser than the sprint's one-primary-action ideal. Collapsing it is Prepared-card work, which this
sprint is forbidden to do.
