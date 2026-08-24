# CORE-6 — The Account Dashboard

**Status:** implemented, not merged. **No backend change** — no migration, no schema, no new
provider, no AI call, no money spent. Lint (0 errors) / typecheck / **6,115 unit tests across 339
files** / build / **333 browser E2E** green.

## Problem

[CORE-5](0084-core5-command-center.md) rebuilt the *project* workspace as a Command Center with a
persistent rail. It shipped, and it exposed the level above it.

`/app` had no chrome of its own. `src/app/app/layout.tsx` is an authorization gate that renders
nothing, and every account page supplied its own `AppShell` top bar. So the only persistent
navigation in the product lived *inside* a project, and the account level had none — one dashboard
nested in a page that had never become one.

What `/app` did render was three stacked lists: an attention list, a project list and an activity
feed. Counted as labels, sentences, timestamps and controls at three products, that is about 68
discrete elements on the screen a founder sees most often and acts on least.

## What changed

See [ADR 0042](../decisions/0046-account-dashboard-and-context-swap.md) for the decisions. In
order of what a person sees:

- **The rail.** A `(account)` route group holds a layout with the account rail. `Home`,
  `My Products` and `Repositories` are rows; `Experiments` and `Team` are labels with a `Soon`
  badge and no `href` — a disabled control still occupies a tab stop and still invites a click. The
  footer carries the credit balance and an account block: avatar, GitHub login, and a `<details>`
  disclosure holding Profile, Billing and Sign out.
- **The hero.** One named product's Business Signal — a score ring, a sparkline, the change against
  the previous comparable reading — beside its Next Move.
- **The grid.** Every product as a card: an initials tile, the name, the score with the date it was
  analysed, one sentence about the next move, one action.
- **Two new pages.** My Products is the full index; Repositories is where `owner/repo` went when it
  came off the cards.
- **Onboarding ends on `/app`.** It used to hand a founder into `/app/projects/{id}`, so nobody had
  ever seen the account dashboard after finishing setup.

## Density was the constraint, and it is a test

The project workspace is dense **on purpose** — it is where someone authorises a write to their
default branch, and every gate, timestamp and SHA there is load-bearing. The account dashboard is
the opposite kind of screen. Inheriting the project level's density would make it an admin panel
wearing a nicer card.

The target was at least half the elements removed, and it was taken by removing two whole sections
rather than by shrinking type:

| | Before | After |
|---|---|---|
| Headline + subline | 2 | 2 |
| Attention list (4 items) | 24 | — |
| Project rows (3) | 18 | — |
| Recent activity (8 rows) | 24 | — |
| Business Signal hero | — | 5 |
| Next Move card | — | 5 |
| Product cards (3) | — | 18 |
| Connect a product | — | 3 |
| **Total** | **≈ 68** | **33** |

33 is measured, not estimated: `e2e/account-dashboard.spec.ts` counts
`[data-mono-label], h1, h2, h3, p, a, button` inside the real composition in a real browser, and
fails over 36. A fourth section is five elements or more, so it cannot arrive quietly. The budget
was watched failing against a planted activity feed and a planted second card label.

Two smaller cuts came out of the same rule. The card's "Business Signal" label went — the hero
above names the reading once, and repeating the words over every card's number is the label doing
no work three times. The reference's `Active` badge was never built: it would appear on every card
and therefore distinguish nothing.

## Four decisions worth writing down

**The hero names a product, because there is no account score.** Averaging three audits would be a
figure no audit produced, over readings the comparability rule says are frequently not comparable
at all. The hero is the product `orderProjectsByAttention` puts first — the same one that leads the
grid — so the two halves of the screen cannot disagree, and the Next Move beside it has an owner.

**The trend cost no migration, and this was a late discovery.** The plan approved a
`contract_version` column and a backfill. `business_readiness_audits` already carries the
reproducibility set as seven `not null` columns — `schema_version`, `audit_version`,
`evidence_pack_version`, `prompt_version`, `rubric_version`, `provider`, `model` — under its own
SQL comment: *"An audit is only comparable to another if every one of these matches."* That is the
stricter rule and it breaks the line in the same places, because a new audit row only exists when
`input_hash`, computed from those very versions, changes.

So `score-series.ts` uses the columns and `auditScoresComparable` stays uncalled. It answers a
coarser question than the schema's own rule, and holding two comparability rules at once would mean
two answers to one question. The audits query widened by seven small text columns on a read it was
already making.

**No conclusion sentence and no date-range picker.** The reference shows both. "Your business is on
track" is `synthesis.overall`, which lives inside the audit's JSONB document — and
`dashboard-contract.test.ts` bans the dashboard from opening that document, deliberately, to keep
it on columns. Weakening a load-bearing guard for one sentence is a bad trade; it is one click away
on Business Health. "Last 7 days" implies a time filter over data that does not exist: audits
happen when someone runs one, and a founder can have two readings in a year.

**The composition is a component so the budget can measure the real screen.** The browser harness
renders components, not pages — it has no database. A density test that re-assembled the hero, the
move and the grid itself would measure a screen that exists only in the test file, and would keep
passing after a fourth section landed on the real one. `account-home.tsx` is what both the page and
the fixture render.

## What the cost contract learned

`dashboard-contract.test.ts` is the guard that makes `/app` safe to extend, and it was extended
three times rather than relaxed:

1. **Before anything moved**, the surface stopped being a filename and became a derived list, so
   the credit balance moving from `page.tsx` into a layout could not take its assertion out of
   reach. (This landed as its own commit at the start of the sprint, the same discipline CORE-5's
   recursion commit used.)
2. `account-home.tsx` joined it when the composition moved out of the page.
3. `products/page.tsx` joined it because it reaches the same read model by a route nobody would
   think to check. Watched failing on a planted `getProjectImpact` call.

One assertion was **strengthened** on the way. The audits read is deliberately unbounded: it is
ordered newest-first across every project and reduced to latest-per-project, so a `.limit()` would
starve exactly the quiet product that `dashboard.ts`'s own `lastActivityAt` note describes. That is
now asserted as "this query has no limit", with the reason, instead of two assertions about limits
elsewhere that had stopped meaning anything when the event-log read was deleted.

## Two things dogfooding caught

Both were found by rendering the fixtures and looking at them, not by a test.

**The sparkline was letterboxed.** `xMidYMid meet` at a fixed height in a wide column shrank the
whole chart into the middle third with two margins of nothing. `preserveAspectRatio="none"` fixes
it, which is safe because every stroke is non-scaling — and the single-reading marker had to become
a round-capped zero-length line rather than a circle, which would have gone oval under the stretch.

**Two filled buttons competed.** A product with no moves put "Analyse product" and "Open Action
Plan" side by side, both primary. With nothing to review the hero is the one thing to do, so the
plan link goes secondary.

## Not proved

**Nothing was dogfooded against real data.** Every browser assertion runs against the fixture
route, so rule 69 has three of its four again. The N+1 that `dashboard.ts` exists to prevent is
invisible with one project, and so is a sparkline with one point — walking this signed in against
an account with more than one product is the check this sprint could not perform.

**The product's real logo and its own name are not on the cards.** Both live in
`product_profiles.result`; the dashboard may not parse documents, and reading them properly means
denormalised columns written at insert time plus a backfill. V1 ships an initials tile.
`ProductLogo` is already built and waiting for it.

**The hero repeats the attention-first product in the grid below it.** At one product that is
visible redundancy. Hiding the grid at n=1 removes the only route from `/app` into a product's
workspace, which is worse.
