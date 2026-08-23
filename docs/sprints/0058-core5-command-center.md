# CORE-5 — The Command Center

**Status:** implemented, not merged. **No backend change** — no migration, no schema, no new
module, no new provider, no AI call, no money spent. Lint (0 errors) / typecheck / **6,076 unit
tests across 336 files** / build / **327 browser E2E** green.

## Problem

The project workspace had eight sections, and every one of them was named after Vibe's own
machinery: `Overview`, `Product`, `Business score`, `Next moves`, `Prepared`, `Deep Scan`,
`Impact`, `Activity`. Each name is an accurate description of what its route holds. Together they
describe a system rather than a business.

Three consequences, none of them cosmetic:

**The landing screen answered the wrong question.** Overview was a provenance screen — which
snapshots exist, when each ran, how many of each artifact there are. Worth knowing, and not what a
founder opening their own product wants first.

**Configuration had accumulated on the landing screen.** The production URL, the founder's own
words about the business, and disconnecting the repository were all inline on the index page —
because it was once the only page a project had, and nothing moved them when UI-2 split the
workspace into seven routes.

**Two sections were destinations that should have been sources.** Deep Scan is something Vibe
learns *from*. Activity is a log a person consults. Both sat in the rail at the same weight as the
audit and the execution surface.

Underneath all three: the product already has a durable model, written down in `PRODUCT.md` §11 —
Understand → Diagnose → Prioritize → Plan → Execute → Measure. The routes implemented it faithfully
and named none of it.

## What changed

Seven sections, named for that model, plus a Home and a Settings — see
[ADR 0041](../decisions/0041-command-center-information-architecture.md) for the decision and the
table. Two routes became **subsections**: real, anchored, reachable, deliberately outside the rail.

Nothing behind them moved. Same read models, same panels, same gates. The validation → preview →
review → approval → merge lifecycle went from `Prepared` to `Agent` and changed in no other way.

- **Home** is new content on the same route. `buildHomeView` turns the profile, the audit, the
  opportunity set and a prepared count into four answers: what your product is, how the business is
  doing, what is most in the way, what to do about it.
- **My Product** absorbed the evidence surfaces from Overview, so the conclusion and its sources
  are on one screen. It is also the only route to Deep Scan.
- **Business Health** gained the five scored dimensions as readings.
- **Agent** opens with what Vibe's engineer knows about the business, and folds each change's
  branch, SHA and paths into a disclosure.
- **Experiments** is the old Impact read, reframed.
- **Settings** is new, and took the three configuration controls off Home.

## Three decisions worth writing down

**The five dimensions came back, and UI-1.2's removal stands.** UI-1.2 deleted a collapsed
*technical breakdown* — per-dimension summaries, strengths, gaps and evidence ids — on the argument
that "a page that offers two answers has not made one". That argument was about a second verdict,
and it is still right: the breakdown is still gone. What CORE-5 adds is five numbers under a
heading, below the conclusion and below the map, with no prose and no findings. The e2e test that
asserted the dimensions were absent was split in two rather than deleted, so the distinction is now
enforced instead of argued.

**Three of the brief's own elements were not built, and the reasons are the interesting part.**

- `[Create Pull Request]` — Vibe does not open pull requests. An approved change reaches the
  default branch by fast-forward to one exact human-approved commit, or it refuses (rules 58,
  67–74; ADR 0019). `command-center-ui.test.ts` fails the build if any agent surface offers one.
- `[Let Agent Build]` on Home — preparing a change is a priced, confirmed action that lives on the
  Action Plan beside the Move it belongs to. A button promising a build where none happens is a
  promise this product does not make. Home offers "Review this move" and, only when there is
  something to see, "See what Vibe prepared".
- Business Health as `Product / Market / Growth / Revenue / Retention` — the five scored axes are
  Product, Monetization, Distribution, Conversion and Retention. Relabelling a scored axis would
  misreport what was measured, so they keep their names.

**"Experiments" is the founder's word, not the statistician's.** This product runs no controlled
experiments; `business-measurement/causality.ts` says so in code and exports a checker so that a
causal verb fails a build. The name raises that risk rather than lowering it, so the checker now
runs over the section's page and card. `causality.ts` is untouched.

## Three dead links found on the way, and closed

All three were bare same-page fragments left behind by the UI-2 route split, and each was the only
way out of a blocked state:

| Where | Fragment | Resolved to |
|---|---|---|
| `audit-evidence-notice.tsx` | `#deep-scan` | nothing — Deep Scan had its own route |
| `prepare-change-panel.tsx` | `#business-audit` | nothing — the audit is on another route |
| `prepare-change-panel.tsx` | `#github-access` | nothing — no element anywhere carries that id |

A fragment that resolves nowhere throws nothing, logs nothing and renders identically to one that
works, which is why all three survived. `blockedActionHref` now resolves the destination in the
domain from a table the route supplies, so a segment rename moves the link with it — and a test
asserts every actionable kind reaches somewhere.

## The test that moved first

`workspace-routes.test.ts` walked exactly one directory level. That was true when it was written
and had already stopped being true: `agent-dogfood/[stepKey]` has always been two levels down and
was covered by **none** of its assertions — not authorization, not the no-starter list, not the
service-role ban. A rule applied to a list that does not contain the file cannot fail.

Making it recursive landed first, on its own commit, before any route moved — otherwise every route
this sprint created would have inherited the same silence. It also gained a guard over the walk
itself, for the reason UI-6 gave when four action-allowlist tests turned out to be asserting over
empty lists.

## What was verified, and how

`pnpm lint` (0 errors) · `pnpm typecheck` · `pnpm test` (6,076 across 336 files) · `pnpm build` ·
`pnpm test:e2e` (327).

Four new source assertions were **watched failing** before being trusted — a PR control added to
the agent card, a raw `dimension.score` printed instead of `scoreDisplay`, a causal headline on an
experiment card, and a source row whose link was hidden behind `ready`. All four went red; the
mutations were then reverted.

Four claims are asserted in a browser rather than in source, because all four are about pixels:

- every unassessable dimension reads `n/a` with an empty track and never `0` — run against the
  fixture where all five are `insufficient_evidence`;
- the prepared change's branch, SHA and every changed path are hidden by default and **all** come
  back on one click. "One click away" is not a claim a `<details>` element existing can settle;
- Home shows no score, and no `0`, before an audit has run — and separates that from an audit that
  ran and could not be scored, and from an engine that ran and found no move;
- the agent card names its readiness in words and shows no internal state name on screen.

Every Command Center fixture is built by the real `buildHomeView` / `buildAgentContext` rather than
by hand, so the browser checks the same decision the unit tests check, one layer out. The no-zero
assertion was verified by making Home print one.

## What has not been proved

**Nothing was dogfooded in a browser against real data.** Every e2e assertion runs against the
fixture route, which renders real components with hand-built read models — it proves what a
component does with a given state, never that `page.tsx` produces that state. Rule 69 asks for four
things and this sprint has three: domain state tested, SQL/RLS untouched, browser-visible state
tested against fixtures, and **no walk through a real signed-in project**. The seven screens have
not been seen with a real audit behind them.

**The Agent page cannot show a running agent.** There is no project-scoped read of the latest agent
run — every lookup is keyed by `operationRunId` or `(projectId, runIdentity)`
(`coding-agent/store.ts`), and the live view is reached through an operation id the dogfood page
carries in `?run=`. So `AgentPanel` describes readiness and what has been produced, and says
nothing about work in flight. The brief asked for a current task with a plan and progress; that
needs a read model that does not exist, which is backend work and outside a UI sprint.

**No claim about whether these are the right seven.** This is an information architecture. It was
chosen to match the model `PRODUCT.md` §11 already states, not validated against users.

## Three flaky auth tests, fixed rather than tolerated

Adding the Command Center fixtures perturbed the build's timing enough to start failing
`e2e/auth.spec.ts` intermittently — first one test, then a second, roughly one run in three and one
in ten. Bisecting established the change was the trigger and not the cause: all three assert a
*pending* state on a progressively-enhanced `useActionState` form, which is only true once React
has hydrated. Before hydration the same click is a native form POST, the browser leaves the page,
and the assertion fails against a control that no longer exists.

Two of them needed a second fix as well. The pending window only stays open while the request is in
flight, and Supabase is unreachable in this suite, so the window is as long as a DNS failure takes —
which is not reliably long. The Google hand-off test had already discovered this and held the route
open; the other two now do the same.

Neither fix weakens an assertion: the disabled-state claims are unchanged, and what was removed is
the race in front of them. Ten consecutive clean runs of the spec, two of the full suite.

## Documentation

[ADR 0041](../decisions/0041-command-center-information-architecture.md), its index row, and its
number in `ARCHITECTURE.md` §8. No current-state document became false: a sweep of `README.md`,
`PRODUCT.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `docs/README.md`, `docs/ROADMAP.md`, `docs/setup/`,
`docs/deployment/` and every `src/modules/*/README.md` found no sentence describing the workspace
navigation or where a configuration control lives, so `RETIRED_CLAIMS` gains nothing.
