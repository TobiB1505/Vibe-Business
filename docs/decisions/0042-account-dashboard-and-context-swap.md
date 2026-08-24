# 0042 - The account level is a dashboard of its own, and the sidebar swaps context

Status: Accepted

Date: 2026-08-23

**Visual amendment:** [UI-8](../sprints/0060-account-dashboard-reference-fidelity.md) later
refined the composition toward the supplied SaaS reference — full-width signal, horizontal next
move, richer product cards and a visible connect surface. The decisions in this record remain:
mutually exclusive account/project rails, one named product rather than an account average, the
same score-comparability rule, no fake date filter and no additional dashboard read.

**Products-index amendment:** [UI-9](../sprints/0061-my-products-reference-fidelity.md) makes
`/app/products` a detailed comparison surface rather than a second rendering of Home's compact
cards. Home still parses no Product Profile document. The dedicated index may read only the exact
profile ids attached to its latest audits, plus corrections and founder intent in batched
account-wide queries; the dashboard cost contract guards that boundary. Repository metadata may
appear there because the route is explicitly an inventory, while Home remains editorial and calm.
The prohibition on an account-wide average and inferred “Active” state is unchanged.

## Context

[ADR 0041](0041-command-center-information-architecture.md) rebuilt the *project*
workspace as a Command Center with a persistent rail. It shipped, and it exposed
the level above it.

`/app` — the screen a founder lands on — had no chrome of its own.
`src/app/app/layout.tsx` is an authorization gate that renders nothing, and every
account page supplied its own `AppShell` top bar. So the only persistent
navigation in the product lived *inside* a project, and the account level had
none. That is the "dashboard inside a dashboard": not two dashboards by design,
but one dashboard nested in a page that had never become one.

What `/app` did render was three stacked lists — an attention list, a project
list and an activity feed. Counted as labels, sentences, timestamps and controls
at three products, that is about 68 discrete elements on the screen a founder
sees most often and acts on least.

Three questions had to be answered before anything could be drawn:

- **Where does the sidebar live?** One rail that persists everywhere would put
  account navigation inside a product, which *is* the nesting, drawn more
  neatly.
- **What number goes in the hero?** The reference this work was drawn from shows
  one Business Signal for the whole account. There is no such number.
- **How is a trend drawn honestly?** Vibe Business went 39, 43, 45 across three
  audits in two days and the product did not improve by six points — the rubric
  changed twice. `auditScoresComparable` was written to name that trap before
  any chart existed.

## Decision

**1. The account gets its own shell, and the two rails are mutually exclusive by
construction.** A `(account)` route group holds a layout with the account rail;
`projects/[projectId]` sits outside it and keeps `ProjectShell`. A route group
contributes no URL segment, so no address, link, redirect or test assertion
changed to arrange that. Entering a product *replaces* the rail rather than
nesting inside it. `onboarding/` and `connect/github/` stay outside both — a
focused setup flow with a navigation rail beside it is an invitation to abandon
the flow.

`AppShell`'s top bar is absorbed: credits, identity and sign-out move into the
rail's footer, which removes a row of chrome from every account screen.

**2. The account level is held to a density budget, and the budget is a test.**
The target was at least half the elements removed. The attention list and the
activity feed are gone — not restyled — taking the screen from about 68 elements
to 33 at three products. `e2e/account-dashboard.spec.ts` counts labels,
headings, sentences and controls in a real browser against a ceiling of 36, so a
fourth section cannot arrive quietly.

Nothing is lost. The attention list's one unique contribution was *cross-product
ordering*, so `orderProjectsByAttention` arranges the grid instead; everything
else it said is in each card's single action. The activity feed becomes a link —
the per-product Activity page already exists.

**3. The hero names one product; there is no account score.** An average across
audits would be a figure no audit produced, taken over readings the
comparability rule says are frequently not comparable at all. The hero is the
product that most needs attention — the same one that leads the grid — so the
panel and the cards can never disagree, and the Next Move beside it has an
unambiguous owner.

**4. Comparability is decided by the seven reproducibility columns, not by
`auditScoresComparable`.** That helper compares one `contractVersion`, which
lives inside the audit's JSONB document — a document the dashboard read model
deliberately never opens. `business_readiness_audits` already carries the finer
answer as seven `not null` columns under its own SQL comment: *"An audit is only
comparable to another if every one of these matches."* That rule is stricter and
breaks the line in the same places, because a new audit row only exists when
`input_hash` — computed from those very versions — changes.

So the trend needed **no migration**, and `auditScoresComparable` stays uncalled:
holding two comparability rules at once would mean two answers to one question.

## Consequences

**Easier.** The account level has somewhere to put things: My Products and
Repositories are real routes with a rail row each, and `owner/repo` came off
every product card into the page that is about repositories. Onboarding now ends
on `/app`, which a founder had never seen after finishing setup. The density
budget makes "is this calm enough" a number rather than an argument.

**Harder.** Two shells to keep visually consistent, and a composition
(`account-home.tsx`) that exists partly so the browser harness can render the
real screen rather than a copy of it. Both are guarded by
`dashboard-contract.test.ts`, which now covers the layout, the page, the
composition and the products index — every file that renders across all of a
user's projects.

**Foreclosed.** A single number for the whole account. Adding one later means
either averaging incomparable readings or defining a new metric with its own
rubric, and the second is a product decision with a sprint behind it, not a
component.

**Not decided here.** The product's real logo on Home's compact cards. It lives
in `product_profiles.result`, Home may not parse documents, and reading it there
properly means a denormalised column written at insert time plus a backfill. The
detailed Products index now reads exact audit-linked profiles for text context,
but still uses an initials tile rather than treating that bounded read as licence
to widen Home's cost boundary; `ProductLogo` is already built and waiting.

**Deliberately unresolved.** The hero repeats the attention-first product in the
grid below it. At one product that is visible redundancy. The alternative —
hiding the grid at n=1 — removes the only route from `/app` into a product's
workspace, and paying a small redundancy is better than a screen with no way out
of it.
