# Sprint UI-3 — Global Dashboard

`/app` stops answering "which projects do I have" and starts answering "what needs my
attention".

## Changed

| File | What |
|---|---|
| `src/modules/projects/dashboard.ts` | New. The dashboard read model — a constant seven queries regardless of project count. |
| `src/modules/projects/attention.ts` | New. A **pure** function turning dashboard state into a ranked attention list. |
| `src/app/app/page.tsx` | Rewritten. Attention → projects → activity. |
| `src/app/app/attention-list.tsx` | New. The primary section. |
| `src/app/app/dashboard-activity.tsx` | New. The quietest section. |
| `src/app/app/project-list.tsx` | Rewritten as a business object rather than a repository row. |
| `src/modules/projects/queries.ts` | `listProjectsForUser` / `mapProjectListItem` removed — this sprint replaced their only caller. |

## Dashboard Hierarchy

1. **Headline** — a fact: "3 things need your attention", or "Nothing needs your attention".
2. **Next up** — level-2 surface, the strongest thing on the page.
3. **Your projects** — level-1 rows.
4. **Recent activity** — level-1, no controls at all.

The order is the argument: a project list is what you fall back to when nothing is pending, not
the first thing the product says.

## Attention Model

**Presentation-layer ordering of states the domain already produced.** No model, no scoring, no
new domain logic. `attention.ts` is a pure function of `DashboardProject[]`, with no imports
beyond its own types — asserted by a test, because that is what makes "it cannot invent an item"
a fact rather than a claim.

Four tiers, ordered by how blocked the user actually is:

| Tier | Source state | Action |
|---|---|---|
| `blocked` | a prepared change's latest validation failed | Review change → `/prepared` |
| `decision` | a prepared change exists and is not failed | Review change → `/prepared` |
| `ready` | the latest opportunity set has opportunities | Review moves → `/moves` |
| `setup` | no repository, or never audited | Finish setup / Run audit |

Ties break by project name, so the list is stable across renders.

A project can raise more than one item — a failed validation *and* waiting moves are genuinely
two things. What it cannot do is raise both "failed" and "waiting for review" for the same
change: the waiting count subtracts the failed ones, so the dashboard never contradicts itself
about one object.

**Deliberately absent: merge-readiness.** "This change could merge now" would be a strong item,
and deciding it needs a live GitHub preflight per change. A dashboard that made an external call
per project is the cost this whole read model is shaped to prevent. `/prepared` answers it
freshly, where it matters.

Shown: at most 4. Beyond that the page states how many more exist rather than listing them —
`buildAttentionItems` returns everything so that sentence can be honest.

## Project Summary

Per project: name, repository, score + score state, next-move count, prepared count, failed
validation count. Nothing else.

**Three score states, not two.** `scored`, `not_audited`, and `insufficient_coverage` — a
completed audit that had too little evidence stores a null score deliberately (Sprint 4). "We
looked and could not say" is a different sentence from "we never looked", and neither is a zero.

The primary action follows the state: a prepared change offers review, moves offer review, a
never-analysed project offers the audit, a project with no repository offers setup. Presentation
choosing a destination — not a decision engine.

## Activity

Reuses UI-2.5's `audit_events.project_id`. One bounded query, `.in(projectIds)` under the
caller's own RLS-scoped client, showing eight events across all projects.

## Performance

Seven queries, constant in the number of projects. Explicitly never called:
`getPreparedChangeWorkspace`, `getProjectImpact`, `getProjectWorkspaceCounts`, the Deep Scan
model, preview/review/approval/merge/outcome/impact card reads, `getLatestSuccessfulAudit`,
`getLatestOpportunities`. No sandbox provider, no GitHub port, no service-role client. The score
comes from the `overall_score` **column**, never from parsing the stored audit JSONB.

`dashboard-contract.test.ts` asserts all of it against both `page.tsx` and the read model —
moving the loop one file down would otherwise satisfy the test while changing nothing about the
cost. It also asserts structurally that no `await` appears inside a loop over projects.

## The defect the browser found

The first implementation had a `lastActivityAt` per project, read by taking the newest 120
events across all projects and picking the first per project.

On the real account that was **silently wrong**: one project had 16 genuine events, the other
had 132 newer ones, so the quieter project fell entirely outside the window and rendered as "no
activity" despite having a history. It gets worse the more the active project is used, and it
looks perfectly fine with one project — which is how it would have shipped.

Doing it correctly needs one indexed query per project (the N+1 this module exists to avoid) or
a `distinct on` PostgREST does not expose. **The field was removed.** A per-project "last
activity" is worth a view or an aggregate column; it is not worth a timestamp that is wrong for
whichever project you use least.

## Empty States

- **No projects** — a level-3 card saying what Vibe does, linking the existing connect flow.
  Not "No projects found."
- **No attention items** — the section is omitted entirely and the headline says "Nothing needs
  your attention." A quiet dashboard for a quiet account.
- **No activity** — the section returns null rather than rendering an empty box.
- **Per project** — "Not analysed" / "Not enough evidence" / "Nothing pending", never a zero.

## Deviations from Mockups

- **No greeting and no time of day.** The session carries an email, not a name, and the server's
  clock is not the user's. "Good afternoon, Jonas" would be fake personalisation twice over.
- **No portfolio-health KPI row.** Optional in the brief, and it would have competed with the
  attention section for the same glance. Attention is the point.
- **No last-activity column** — see above.
- **No credits, pricing or billing**, as instructed.

## Validation

- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 140 files, 2704 tests (30 new: 18 attention, 12 dashboard contract).
- `pnpm build` · `pnpm test:e2e` (58 chromium) — green.
- Browser, real data: 3 attention items in correct tier order; scores 39/100 verified against
  the database; move counts verified (both projects genuinely have 3); prepared count 2;
  8 real activity events. All 13 project links well-formed, none dead.
- Heading outline: one `h1`, three `h2`, `h3` per item and project.
- Exactly **one** mint primary button on the page.
- 1440 / 1024 / 768 / 375 — `scrollWidth === clientWidth` at every width, zero elements past
  the edge on mobile.

**Not verifiable without fake data:** the empty dashboard. The dogfood account has two projects,
and seeding a fake empty one to photograph it is precisely what this sprint forbids. The state
is covered by the code path and by the attention tests for zero items.

## Next Recommended Phase

**UI-4 — the landing page**, in full, as its own sprint. Then UI-5 for the complete
onboarding / first-value flow.

Two small follow-ups this sprint surfaced, neither urgent:

1. A per-project last-activity timestamp needs a view or an aggregate column before it can be
   shown honestly.
2. Two `repository.selected` events still carry no project id, because none existed when they
   were written (carried over from UI-2.5).
