# The wait with nothing in it

**Recorded 2026-09-07, after the work.** *"Bei Klick auf Start passiert direkt
etwas… nicht nur die ganze Zeit einen Spinner zusehen."*

## What was there

Nothing. `handleStart` awaited the server action and opened the dialog on the
**answer**, so the whole provisioning — image resolve, sandbox create, Chromium,
guard, readiness, landing — happened behind an unchanged button. Twenty seconds
when Vibe's image is warm; a couple of minutes when it has to be built.

An unchanged button for either is indistinguishable from nothing having
happened, which is what it was reported as.

## What it is not

A progress bar. The founder's word was *"fakemäßig"* — something built up
visually — and this repository has already settled that question twice, in the
two files nearest this one:

> `OperationProgress`: *a tick is a fact, not an animation that advances on a
> timer.*

> `useElapsedSeconds`: *Deep Scan runs inside the request that starts it, and
> the analyzer reports nothing until it has finished — so there is no stage to
> name and no fraction to fill.*

A bar at 40% when nobody knows it is 40% is the invented metric `DESIGN.md`
forbids on the landing page, moved indoors. So the answer had to be something
that is both moving and true.

## What it is

**Three rows, each of which is something this component watches happen:**

| Row | Becomes a fact when |
|---|---|
| Starting a temporary browser | the server action answers |
| Connecting to it | the view socket opens |
| Showing your product | the first frame arrives |

The last two were already known to `LiveBrowserCanvas` and thrown away — it set
`data-connected` and `data-painted` for its own use and told nobody. It reports
them now, and the dialog turns them into ticks.

Rendered by `ProgressSteps`, which Vibe already owns: the spinner, the tick, the
`motion-safe:` guard and the `sr-only` state description are all its, so nothing
about motion or accessibility was decided again here.

Under it, the elapsed clock — the honest signal the helper's own docblock
names — and the sentence that removes the mystery from the slow case: *usually
about twenty seconds, occasionally a couple of minutes when Vibe has to build
its browser first, which happens roughly once a week.* Somebody told that waits
differently from somebody who is not.

## Two things that had to be got right

**The canvas mounts under the waiting panel, not after it.** The socket cannot
open until the canvas exists, so a panel that waited for the canvas before
mounting it would have been waiting for itself — a deadlock that looks exactly
like a slow browser.

**A refusal closes the dialog.** The panel below is where a refusal belongs,
next to the control that caused it, which is where every other Deep Scan error
already appears.

## Verification

8,769 unit tests green, 15 Deep Scan browser tests green, lint 0/0, typecheck
and build clean.

The stage model is pure and tested as such: the same three rows at every stage,
exactly one current until done, each tick only after the thing it names has
happened, and — the one that matters most — no row ever going backwards. A row
that un-ticks is worse than one that never ticked.

## What this does not do

It does not make the wait shorter. The image build is still a couple of minutes
the first time each week, and nothing here touches it. What changed is that the
wait now says what it is.
