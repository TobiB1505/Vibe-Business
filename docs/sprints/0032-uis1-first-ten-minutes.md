# UI-S1 — First 10 Minutes: Honest Front Door & Onboarding Integrity

**Status:** implemented on `claude/ui-first-ten-minutes-hktge8`. No migration. No provider call. Not merged.

**Branch base:** `f8d0be5` (`origin/main`), clean tree at branch point.

## Problem

The first ten minutes contradicted the product behind them, in two different directions.

The landing page **told visitors the product was not built**. Its own words: "It's in early
development: the core loop described in `PRODUCT.md` is not built yet." That sentence was true when
it was written and had not been true for many sprints — by this point Vibe understands a product,
audits nine areas of the business, prioritises, prepares changes, validates them in an isolated
sandbox, and merges only what a human approved. The primary call to action also pointed at
`/login`, which asks a stranger with no account to sign in.

Onboarding contradicted the founder instead. Someone could answer **"I don't have a live site
yet"**, have their product understood from code alone, and then reach an audit step demanding a
public `https://` address with no other control on screen. Their own answer had become unavailable
one screen after they gave it, and there was no way forward, back, or out. Worse, the completion
guard allowed exactly one terminal path — "the founder saw their first Move" — and a first Move
comes from an audit that cannot run without a live product. So the trap was not a missing button.
It was a rule that made "no live site yet" and "you may finish setting up" mutually exclusive.

Three smaller failures sat alongside it, all of the same shape — the domain knew something and the
screen did not say it:

- A **failed operation** stops being an *active* operation the instant it fails, and onboarding
  only ever asked for the active one. A failure therefore rendered as the *absence* of a failure:
  the waiting screen vanished and the start button came back, unchanged. The founder had to infer
  from a reappearing button that something had gone wrong.
- The **stage line froze**. The watcher polled every 2.5 seconds and compared the result against
  one thing only — had it stopped — so every intermediate stage was observed and discarded. A
  founder watched "Reading what you built" for ninety seconds while the server knew it had moved
  on twice.
- A **broken customer logo** rendered the browser's broken-image glyph directly above "I
  understand what you built." The single worst place in the product for an image to break.

## Audit findings addressed

| Finding | What it was | Resolution |
|---|---|---|
| **F-4** | Landing page told visitors the product was unbuilt | Rewritten; the stale copy is banned by test on rendered text and on source |
| **F-5** | Primary CTA pointed at `/login` | Hero primary → `/signup`, sign-in secondary; pinned in both suites |
| **F-10** | No live-site founders trapped at the audit prerequisite | `auditSurface` parks the audit; the parked state's primary control is the workspace |
| **F-13** | Failed onboarding operation silently reset to the start control | `getLastFailedOperation`; the start control is rendered *inside* the failure |
| **F-21** | Operation stage copy frozen while the run progressed | Watcher refreshes on stage and stall transitions, not only on terminal |
| **F-22** (residual) | Google missing from sign-up; developer copy on the form | Google added via the existing action; "For development" removed; legal links added |
| — | Broken remote logo above the reveal | `ProductLogo` with an error path that also catches pre-hydration failures |
| — | No privacy or terms surface while asking for repository access | `/privacy` and `/terms`, honest about what is still missing |
| — | Veteran founders trapped in the connect flow | `canLeave` wired on both GitHub connect screens |

## Decisions

**No live product is a valid onboarding state, not a failure and not a refusal.** The audit
compares what is built with what customers can reach, and one half of that genuinely does not
exist yet. It is set aside. It is never recorded as having run, never scored, and never counted
against the founder.

**Unavailable evidence ≠ failed evidence.** Parking writes exactly one canonical fact —
`live_site_status = 'no_live_site_yet'` — and touches nothing about the audit. A test asserts the
park path contains no audit start, no audit row, and no completion.

**The state machine was preserved.** No new persisted state, no new table, no parallel flag, no
browser storage. "Parked" is *derived* from two records that already exist — what the founder said,
and whether a live reading succeeded — by a pure function with its own tests. The single change
inside the domain is that completion now has two terminal paths instead of one, which is the rule
that was wrong.

**One predicate, two consumers.** `canCompleteOnboarding` is read by the screen that draws the
button and by the action that honours it, and the action re-derives the facts from the database
rather than trusting the request. A button is a request; whether it is allowed is decided on the
server.

**The landing page describes only what exists.** No revenue, traffic, ranking or deployment
claims. No fabricated screenshots, testimonials, customer numbers or scores. The product proof
renders the **nine real business areas**, read from `BUSINESS_LENSES` and `LENS_LABELS`, with every
verdict left as an em dash and a caption saying why — because there is no product connected, so
there is nothing to have judged.

**A minimal legal surface, honest about being a draft.** Every factual claim traces to an enforced
rule (26, 28, 37, 43, 47). What does not exist — the operating entity, a contact address, retention
periods, governing law, a reviewed subprocessor list — is listed on the page itself under "Not yet
complete" rather than invented or quietly omitted.

**The auth architecture is untouched.** Google on sign-up reuses `signInWithGoogle` unchanged; the
two-form structure and coupled `disabled` handling mirror `login-form.tsx` exactly, for the same
documented reasons. No new action, no new error path, no change to the shell.

## What the browser suite caught that no unit test could

The logo fallback was **wrong when first written**, and passed review by inspection. The `onError`
handler was correct and simply never ran: the `<img>` is server-rendered, so the browser starts
fetching long before React hydrates, and a logo that fails *fast* — a dead host, a blocked request,
an immediate 404, which is most of them — fires its `error` event with no handler attached. The
broken glyph then stays forever.

The fix asks the element what already happened rather than waiting to be told: a ref callback
checks `complete && naturalWidth === 0` on mount, which is precisely the signature of a load that
settled unsuccessfully before hydration. This is the class of defect this repository keeps paying
for (rule 69) and the reason the browser layer is not optional.

## Validation

- **Unit:** 3,761 green (46 new). New pure tests for the parked-audit rule and the completion rule;
  contract tests for the landing page's claims and destinations, and for the first-journey wiring.
- **Browser:** 205 green (28 new), Chromium, production build, fixtures only — no GitHub call, no
  AI call, no provider spend, no database.
- `pnpm lint` — 0 errors (5 pre-existing warnings, all `_`-prefixed unused parameters).
- `pnpm typecheck` — green. `pnpm build` — green.
- **Screenshots reviewed by eye** at 1440 and 390 across fourteen renders: landing, sign-up,
  privacy, terms, parked, awaiting, running (two stages), stalled, failed, unclear-failure, logo
  fallback. Zero horizontal overflow at every width. Two defects found by *looking* rather than by
  asserting, and fixed: the footer's phone-only tagline used `ml-auto` and shoved itself between
  the brand and the links, and small `text-fg-meta` prose sits at ~3.6:1 against the app
  background, below AA.

### Regressions the tests would catch

Each is named in the test that pins it, so a failure reads as the defect rather than as a broken
assertion:

1. A no-live-product founder trapped again — `audit-surface.test.ts`, both the surface and the
   completion rule.
2. A failed operation silently resetting — `first-journey.test.ts` plus a browser assertion that
   the retry control sits *inside* the failure notice.
3. The primary CTA pointing at `/login` — asserted on source ordering and by clicking it.
4. The "not built yet" copy returning — banned on rendered text and on comment-stripped source
   across all six public surfaces.
5. A parked audit represented as successful — the park path is asserted to contain no audit write.
6. `canLeave` removed from the veteran connect flow — both connect screens.
7. A raw remote `<img>` reintroduced — the absence of the element, not the presence of the wrapper,
   so a *second* image added later fails too.
8. A completed onboarding redirecting back into onboarding.

## Two existing tests were changed, and why

Neither weakened.

`onboarding/contract.test.ts` asserted the literal text of the old inline completion guard. The
guard moved into a tested pure predicate; the assertion now pins the mechanism that replaced it —
reconciled server state, the shared predicate, and the re-derived parked path.

`product-understanding.spec.ts` asserted that an unreachable logo *still sat in the DOM with the
right `src`* — which is exactly the broken-image glyph the audit found. It was split: one test holds
the request open to check the attributes while the asset is in flight, and a new one asserts the
fallback. The alt-naming rule it was really about is unit-tested in the view model.

## Deferred

Explicitly out of scope and unstarted:

- **F-1** diagnosis → action; **F-2 / F-3** the execution card; **F-6** app-wide loading
  architecture; **F-7** a Dialog system; **F-8** button consolidation; **F-11** outcome recovery;
  full design-system adoption.
- **F-9 global contrast.** Prose on the changed surfaces was lifted to `text-fg-muted` (~5.5:1).
  The `MonoLabel` eyebrow — `text-fg-meta` at 10.5px, used across the entire product — remains
  below AA. Changing it is a token-palette decision affecting every screen, which this sprint is
  forbidden to make.
- The Product Understanding page's remaining polish (repeated "Likely…" qualifiers, card hierarchy,
  CTA confirmation conflict). Only the broken-logo trust failure was touched.

## Risks and follow-ups

**The "Read-only access to start" assurance on `/login` and `/signup` may no longer be true, and
this sprint could not determine it.** `docs/setup/github-app.md` specifies `Metadata: Read-only` and
`Contents: Read-only` and says explicitly *"Do not set Contents: Read and write."* But
`src/modules/execution/github/adapter.ts` calls `git.createRef`, and `src/modules/merge/github/`
PATCHes `git/refs/heads/{branch}` — both of which require `Contents: Read and write`. Either the
setup document is stale relative to Sprint 11, or execution and merge cannot work against a
correctly configured App. The claim was **left unchanged** rather than corrected, because
correcting it would require asserting something about the production App's real configuration that
no file in this repository establishes. Resolving it needs someone to read the App's actual
permissions, then update the setup document, the assurance, or both. New copy added by this sprint
deliberately avoids the word: it describes behaviour (isolated branch, approval before the default
branch moves) rather than characterising the grant.

**A stalled run's "Try again" may return the same run.** `startProductUnderstandingOperation`
refuses to start a second run for a live input identity even under `force` — correctly, since that
is what stops a double click buying two inferences. A stalled operation whose row is still
`running` therefore blocks its own retry. The action now reports `alreadyRunning` and the screen
says so plainly instead of silently redrawing, but the underlying inability to abandon a lost
durable run is untouched and pre-existing. Fixing it means deciding when an operation row may be
failed by the reader, which is an execution-semantics decision, not a UI one.

**The parked path has not been dogfooded end to end**, because it needs a real project with a
connected repository and no production URL. Every layer is covered — the rule by unit tests, the
wiring by contract tests, the screens by the browser — but rule 69's fourth question is unanswered.

**`/e2e/onboarding_*` fixtures render components, not the page.** They cannot prove `page.tsx`
selects the right state; `first-journey.test.ts` covers that wiring by source. The same documented
gap every suite in this repository carries.

## Not built

- No migration. `project_onboarding` is unchanged, deliberately: adding an `audit_parked` state
  value would have meant a CHECK-constraint migration and a deployment dependency, to persist
  something already derivable from two canonical records.
- No change to the audit, opportunity, execution, validation, approval or merge domains.
- No onboarding redesign. The four phases, the shell, the reveal, the audit lifecycle components
  and the Business Map are untouched.
