# Sprint 0221 — A sheet you could not touch

**Date:** 2026-09-11
**Decision:** no new ADR. Two defects the founder found on their own phone, both mine, both invisible to the guards I wrote at the time.

## What was reported

> Der drawer malt kein x ist nicht anklickbar ebenfalls bei profil so.

Both halves were true, and the second is much worse than it sounds.

## The sheets were dead

`pointer-events` inherits. The phone's chrome layer is `pointer-events-none` — a transparent box over the whole viewport must not swallow taps meant for the page underneath ([ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md)) — and both mobile sheets are rendered *inside* that layer, because they live in the rail slot.

So they inherited it. `showModal()` put the dialog in the top layer, it painted correctly, and **every control in it was dead**: measured, `elementFromPoint` over the Close button returned `<html>`. The sections sheet and the account sheet have been unusable since the day they shipped.

`Sheet` sets `pointer-events: auto` on itself now, and that is the right home for it rather than the two callers: a thing opened with `showModal()` is the only interactive element on the screen, and inheriting its way out of that is never what anybody meant.

## And then there was no way out

The other half is a regression with a clean cause. `Sheet` closed on a backdrop click by testing `event.target === the dialog`, which is sound — a backdrop is not a node, so a click on it targets the dialog. It is sound **only while the dialog covers the point**.

It used to cover every point: the bottom variant filled the viewport, which is the bug [sprint 0220](0220-a-phone-is-not-a-narrow-desktop.md) fixed. Making it a real bottom sheet silently removed the only way out of it, and the guard written in that same sprint measured the geometry and stopped there.

A tap outside now dismisses through a document listener — `showModal()` makes the rest of the page inert, so a click out there could not reasonably mean anything else — and both sheets draw a visible Close, the same mark and label the evidence drawer has had all along. A phone has no Escape key and a scrim is not a control anybody has been told about.

## The guard already knew this and was not asked

`mobile-shell.spec.ts` carries this sentence, written for the consent banner in the same sprint:

> Clicking is the test. A visibility assertion passes on an element with another element on top of it.

Four lines below it, the sheet tests assert `toBeVisible` and nothing else — on the two sheets that were, at that moment, entirely untappable. The lesson was written down, in the right file, and applied to everything except the thing being built.

Both now click. The links go to `/login?next=…` under a fixture with no session, so the assertion reads `next` rather than the landing URL: that asserts the tap, where asserting the landing URL would assert the auth guard.

Four guards, one mutation — `pointer-events-auto` removed, compiles, builds — and all four fail.

## And a flake that was never a flake

The full run turned up `landing.spec.ts` failing "does not move the table under
somebody comparing two numbers" — the second time this session, having passed
three times in isolation the first time, which is what "flake" usually buys you.

It is not one. The landing page is twenty thousand pixels of `Reveal` blocks
that enter as they are scrolled past, so the document is still moving while the
test reads it twice and asks whether the geometry changed. Under load the reads
land further apart: once it reported a 510px scroll the click never caused, and
once — with a longer wait put in front of it, which made it worse — a 12.7px
drift in the table itself. Both were the page still arriving.

The test disables entrance motion now, through `emulateMedia` rather than
`test.use({ reducedMotion })`, which does not reach the page. Nothing about the
subject depends on the entrance: the question is whether switching the interval
moves the table, and a block that has finished appearing answers it better than
one that has not. Five runs, five passes.

Unit 9,543 · browser 870 with 4 new · tsc clean · eslint 0 · build clean
