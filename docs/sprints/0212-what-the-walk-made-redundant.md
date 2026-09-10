# Sprint 0212 — What the walk made redundant

**Date:** 2026-09-10
**Decision:** the three blocks the numbered walk had already absorbed come off the page, and the navigation is repointed at sections that exist.

## The instruction

*"Alles aufräumen."*

Ten blocks were built one at a time over the blocks that came before them. Nothing was ever removed, so the page below step ten still carried the shape it had before the walk existed: a logo strip, a two-tab flow, a four-tile trust bento. Each of them said something the walk now says at greater length and with a picture — which makes them not merely redundant but *contradictory in emphasis*, because a reader who has scrolled ten numbered blocks arrives at a tab bar asking them to choose between two of the things they have already seen.

## What came off, and where each thing went

**"Works with your stack"** — GitHub, Next.js, Stripe, Vercel, Supabase, `+ more`. Deleted outright. It was the weaker half of the question 0210 answered in the hero: a visitor asks *is this for what I built?*, and the named builders under the button answer it in the first screen. A second strip four blocks down, listing infrastructure rather than builders, answers nothing that is still being asked.

**`LandingFlow`** — two tabs, *Diagnose* and *Plan*. Diagnose was a finding card, which step 03 is. Plan was three ownership rows, which nothing else on the page had, so those three rows moved into `landing-move.tsx` under *And what it becomes*. **The tab bar is the thing being deleted, not the content**: a tab asks a reader to stop and choose inside a page whose whole form is a scroll, and the choice it offered was between two views of one Move. A guard now asserts `getByRole("tab")` has count 0 on the landing page — the seventh tab does not get to reappear.

**`LandingTrust`** — a four-tile bento under *An opinion you can check*: source coverage, one exact commit, an evidence drawer, a boundary line. Every tile is now a numbered block with room to show its subject rather than assert it — 01 the scan, 02 the map, 04 the gates, 07 the boundary. A tile that says "One exact commit waits for you" beside a block that draws the commit and its gate is the weaker of the two, and keeping both teaches a reader that this page repeats itself.

`page.tsx` is 137 lines and composes ten components; 291 lines of component and 31 lines of composition are gone.

## A link into a deleted id scrolls nowhere and reports nothing

The navigation carried five destinations. Two of them — `/#product` and `/#how` — were the ids of the trust bento and the tab bar. Deleting a section does not break a build, does not fail a test and does not throw in a browser: the click simply does nothing, which is the failure mode most likely to survive to production because nothing anywhere says it happened.

`Product` now points at `/#scan` and `How it works` at `/#agent`, and **a guard walks every anchor in the navigation and fails on the first one that lands on no section** — so the next deleted block cannot leave a dead link behind it.

## Mutations, and the two that proved nothing

Three guards, three mutations. The nav mutation (`/#scan` back to `/#product`) was caught on the first attempt.

The plan-steps mutation was attempted twice before it proved anything. Rewriting `actor: "Needs your input"` / `tone: "waiting"` to the active pair broke the `as const` union, so `step.tone === "waiting"` became a type error and the **build** failed rather than the test — which demonstrates that the file does not compile, not that the guard works. Rewritten to change only the rendered label (`Needs your input` → `Vibe handles it`), it compiles, builds clean and the guard fails exactly where it should.

This is the third time in this branch that a mutation failed to build instead of failing its test. Worth stating plainly: **a mutation that does not compile tests the compiler.** A useful mutation is a change a careless human could actually merge.

Unit 9,486 · browser 810 with 3 new · tsc clean · eslint 0 · build clean
