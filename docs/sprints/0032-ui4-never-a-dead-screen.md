# UI-4 — Never a Dead Screen

**Status:** implemented. Lint / typecheck / 4509 unit tests / build / 294 browser E2E green. Two
things are deliberately **not** claimed as verified — see *What has not been proved* below.

Derived from the product UI/UX audit of 17.08.2026 (`docs/audits/2026-08-17-product-ux-audit/`,
findings **F-6**, **F-15**, **F-16** and systemic items 4 and 5), which shipped on its own branch.

## Problem

The application measured fast and felt slow, and those two facts had one cause between them: three
whole classes of waiting had no UI model at all.

**Navigation had none.** There was not a single `loading.tsx` in the repository. A click on a
workspace section changed nothing on screen until the destination had finished every read it
needed. The nav's active state comes from the URL, so even the menu item did not move.

**The render path had a network call in it.** `getProjectWorkspaceContext` asked GitHub whether the
installation was still usable — an installation-token mint plus a repository listing, two round
trips. An App Router layout does not gate the routes beneath it, so the layout and the route each
resolved that context independently: **four GitHub round trips per navigation, before a pixel**.
Exactly one component used the answer. The other eight route files paid for it and discarded it.

**Assemblies read in a queue.** A prepared change was nine sequential reads, and the cards were
built one after another, so three prepared changes cost twenty-seven queued round trips. The Moves
page did three reads per Move sequentially — directly below a block that had already parallelised
its own seven. The execution summaries underneath it did the same thing again.

Two failures also had nowhere to land: the only error boundary was `global-error`, which rendered
Next.js' unbranded light-themed page, and every `notFound()` fell through to the framework default.

And eleven panels had each written their own poller. Four intervals for identical work, none
pausing on a hidden tab, and the differences between them were not decisions — they were the order
the panels happened to be written in. Two of the audit's findings lived in the gaps between those
copies: the review panel polled by calling `router.refresh()` **every tick**, re-rendering the
whole prepared-change route including its merge preflight and signed image URLs, and two panels
never refreshed at all when their operation finished.

## Changes

- **Every route paints a first frame.** Ten `loading.tsx` files. Each repeats its own section
  heading verbatim — static per route — and skeletonises only what depends on a read, so the page
  keeps its identity from the first frame and nothing moves when content lands. `SkeletonSection`
  is one shape for every section on purpose: a skeleton that imitates a specific layout has to be
  maintained in step with it, and when it drifts it announces a structure the page contradicts.
- **The GitHub probe left the render path.** `accessible` is gone from the workspace context, so
  the shared read is a database query again. The pill that displays it now owns it and the layout
  streams it behind a boundary, saying "Checking GitHub access…" rather than optimistically
  claiming a state it does not have. The sidebar dot says whether a repository is *connected* —
  the same fact was previously told twice, and the second telling was colour with no words.
- **Four branded boundaries**, placed where the failure happens: a section error renders inside the
  workspace layout so the sidebar and menu stay put; anything else under `/app` renders in
  `AppShell`, which the boundary supplies because that layout deliberately has no chrome; the
  `/app` 404 catches a missing project, because the *layout* raises it and a `notFound()` from a
  layout bubbles past its own segment; the root 404 uses the marketing shell. `global-error` is
  styled by hand from the token values, because it replaces the root layout and every primitive is
  gone by the time it renders.
- **The three assemblies read at once.** Cards in parallel, and each card in three waves instead of
  nine steps. The two orderings that are real — a preview card is told which validation it is
  previewing, an origin is only fetched for a preview known to be running — survive, and a test
  says so, so a later reader does not mistake them for an oversight.
- **One poller.** `useOperationPoll` owns the timer; `operationPollPhase`, `freshestOperation` and
  `shouldRefreshForState` own the decisions and are unit-tested. The review panel got the cheap
  status action it never had.

## The distinction that was actually missing

`shouldPoll` answers one question — ask again? — and three different situations answer it "no": the
run finished, the run is paused on a question only the founder can answer, and the run has been
going so long it is presumed lost.

Every panel that read "stopped polling" as "finished" was therefore wrong in two cases out of
three, and several were. `operationPollPhase` names the five states so that `settled` is the only
one meaning the work is over — which is what let a stalled preparation stop claiming "you can leave
this page, Vibe will continue" for a run that nobody is coming back to.

## Two things the hook deliberately cannot do

**It cannot poll immediately.** There is no `leading` option, not even one defaulting to false.
Every call site already has a server-rendered first reading — and in the fixture harness, where
these panels render without a session, an immediate poll would fire a Server Action whose
`requireSession()` *redirects*, navigating the browser to sign-in mid-test and failing every
assertion in the block. `/e2e/outcome_observing` schedules a 15s interval against a 15s test
timeout, so that bomb was already armed and is now defused by construction rather than by timing.

**It cannot refresh the router.** Only the call site knows what its own server render says. A hook
that refreshed on the caller's behalf could only do it on every reading — the exact defect being
removed.

## Architecture intentionally unchanged

- Deep Scan stays synchronous. Making it durable is the honest fix and a larger one: a new ADR, a
  new operation type, a migration, and a decision about retrying a billed browser session. It got
  an honest waiting UI instead — elapsed time and a real expectation, with no invented stages,
  because the analyzer reports nothing until it returns.
- No caching primitive was introduced. There is none in this repository, and once the probe left
  the page path and started streaming in the layout, none was needed.
- Every stage label, failure message and status vocabulary is untouched. This sprint changed *when*
  a screen is told it is out of date, never what it says.
- `outcome-panel` keeps its `live ?? card` merge, which its source test pins. The hook returns a
  reading rather than a merged value precisely so that line survives.

## What has not been proved

**The probe's real effect is unmeasured.** Removing three of four GitHub round trips per navigation
is arithmetic from the call sites, not a measurement: the sandbox has no GitHub App credentials, so
the probe cannot run here at all. What the numbers describe is the call graph.

**The hook's timer has never been watched against a real operation.** The repository's test
environment is Node with no DOM, and adding one for a single file would change how every other test
runs. The decisions are unit-tested; the timing is not. The specific risk is callback identity — an
unmemoised `poll` would re-arm the interval on every parent render and, at a two-second interval
with a parent that renders often, never fire at all, silently. It is held in a ref for exactly that
reason, and that is an argument, not evidence.

Both belong to the first real dogfood run, alongside the founder-visible question this sprint
exists for: does the workspace still feel slow?
