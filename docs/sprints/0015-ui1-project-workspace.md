# Sprint UI-1 — Project Workspace Migration

## Goal

Turn the project screen from one long scroll into a navigable workspace on the design system
UI-0 established — without splitting the route, without touching a server action, and without
inventing a single value the system does not have.

## Context

UI-0 built the foundation and deliberately left `ProjectShell` unwired, because splitting a
569-line route that assembles ~20 services is a data-dependency exercise rather than a styling
one. UI-1 does the half that is genuinely presentational: the shell goes in, the sections get
anchors and headings, and the panels move onto the tokens. The route split stays out.

## Scope

**Shell** — `ProjectShell` + `ProjectSidebar` + `ProjectHeader` wired into
`/app/projects/[projectId]`. A new `WorkspaceSection` supplies each section's `id`, heading and
`scroll-margin`. The sidebar carries real counts (opportunities, prepared changes) and nothing
else; a project with no opportunity set yet shows no badge rather than a zero.

**Sections** — seven anchors on one route: `#overview`, `#business-audit`, `#next-moves`,
`#prepared`, `#deep-scan`, `#impact`, `#activity`.

**Business score** — `business-audit-summary` rebuilt on `ScoreMeter`, `StatusPill`, `Surface`
and `MonoLabel`. Strengths/gaps/unknowns become three columns; coverage becomes a pill that
says "3 of 5 dimensions" in words.

**Next moves** — `opportunities-panel` moved onto `Surface`, `CategoryChip` and `StatusPill`.
Ranking, ordering, polling, the block notice and every server action are untouched.

**Palette** — 531 legacy `zinc`/`emerald`/`amber`/`red` classes across 20 components mapped
onto tokens. Class names only: no label, no prose string, no `data-testid` was touched.

## Non-Goals

- The route split. No `/score`, `/moves`, `/prepared` — those would be dead links today.
- Any motion. No count-up, no scan choreography, no library.
- Any new product feature: no credits, no billing, no deployment, no new metrics.
- Restructuring the gate panels' internals (validation → preview → review → approval → merge →
  outcome). Their labels, prose and testids are load-bearing; see Validation.

## Acceptance Criteria

- The existing route still works, with every gate in the same order and the same semantics.
- Every sidebar entry resolves to a section that exists on the page.
- No fabricated score, count, metric, activity event or deploy state.
- `null` is never rendered as `0`.
- Full keyboard reachability, visible mint focus ring, one `h1`, no duplicate `h2` per section.
- No horizontal page scroll at 375px.

## Validation

- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 135 files, 2622 tests passing (4 new in `project-sections.test.ts`).
- `pnpm build` — succeeds.
- `pnpm test:e2e` — 58 chromium tests passing, unchanged.
- Browser, real signed-in session, against the real project: all seven sections present, zero
  dead anchors, real audit (39/100, 5 of 5 dimensions), real opportunities (3, ranked), real
  prepared changes (2, validation phases and timings), real Deep Scan (6 pages, entitlement
  used), real merged commit in Impact, honest empty state in Activity.
- Responsive at 1440 / 768 / 375: `scrollWidth === clientWidth` at every width. Anchor targets
  measured clear of the sticky header at 375px.
- Focus ring measured as `rgb(0, 229, 160)` solid 2px on real keyboard navigation.

### One test was rewritten, not weakened

`business-impact-ui.test.ts` asserted `improved: "text-emerald-400"` and
`degraded: "text-amber-300"` as literals. The rule it protects — a degraded result must not
wear the colour of an improved one (§25) — survived the palette migration intact; only the
class names changed. It now asserts the rule itself (the two tones differ) **plus** a new
assertion that neither may be a raw hex or a legacy palette class. Strictly more coverage than
before.

## Deviations from Mockups

- **Activity has no data.** `src/modules/audit-log` exports only `recordAuditEvent` — there is
  no read path. Building one is a data change with RLS implications, not a styling one, so the
  section states plainly that the record cannot be read back yet. No feed was assembled in the
  browser.
- **Impact points rather than duplicates.** Outcome verification and business measurement are
  rendered per prepared change, inside `prepared-changes-section`. The Impact section lists the
  merged commits it has and links to them; rendering those panels twice would mean two places
  claiming one result, and the E2E suite asserts the outcome panel's placement.
- **No Publish anywhere.** The mockups say *Publish*; the system fast-forward-merges and calls
  no deployment provider. The existing "Merging updates the repository's default branch;
  nothing here is deployed by Vibe" sentence was kept verbatim.
- **No credits.** Still no ledger (ARCHITECTURE.md §3.11).
- **No active section state in the sidebar.** Anchor navigation has no server-side notion of
  "current", and a scroll-spy is client state this sprint did not need. A wrong active state is
  worse than none.
- **Section id is `business-audit`, label is "Business score".** `BUSINESS_AUDIT_ANCHOR` is a
  tested domain constant that a blocked opportunity set links to — the only way out of that
  state. The UI took the domain's id rather than renaming the domain, and
  `project-sections.test.ts` now fails if the two ever drift apart.

## Regressions

None found. Three defects were fixed on the way:

- Duplicate `h2` inside `#prepared` and `#deep-scan` ("Prepared" + "Prepared changes", "Deep
  Scan" + "Deep Scan"), and two more in `#overview` from the intelligence summaries. All
  demoted to `h3`; the outline now has one heading per level per section.
- Anchor jumps landed 23px behind the sticky header at 375px. Measured and given headroom.
- Two form fields still used a bespoke `focus:border-zinc-600` instead of the system's mint
  focus treatment.

## Route-Split Readiness (for UI-2)

| Section | Data dependencies | Server actions | Client state | Split risk |
|---|---|---|---|---|
| Overview | project, repo access probe, both intelligence snapshots, business context | business context, production URL, inspect ×2, disconnect | forms only | **Low** — self-contained |
| Business score | latest audit, audit currency, evidence notice, active operation | run audit | operation polling | **Low** |
| Next moves | opportunity set, execution states, branch urls, validation summaries | start opportunities, prepare change | operation polling | **Medium** — shares execution state with Prepared |
| Prepared | prepared changes + validation, preview, review, approval, merge, outcome, impact per change | ~8 actions | polling, dialogs | **High** — the expensive loop; owns nested Impact |
| Deep Scan | deep scan access, snapshot, session, surface detection | deep scan actions | session polling | **Low** |
| Impact | derived from prepared changes | none of its own | none | **High** — has no data of its own today |
| Activity | none exist | none | none | **Low** once a read path exists |

The `for (const prepared of …)` loop is the real obstacle: it performs the review-image signing,
the preview-origin fetch and up to four impact reads per change, and Overview/Score/Moves do not
need any of it. Splitting Prepared onto its own route is where the page's cost actually moves.

## Next Recommended Phase

**UI-2**, in this order: (1) an audit-log read path with RLS, which turns Activity from an empty
state into the section it is meant to be and is the smallest genuinely useful data addition;
(2) extract the prepared-change assembly out of `page.tsx` into a service so the loop can be
loaded independently; (3) then split routes, Prepared last. Motion remains its own sprint.
