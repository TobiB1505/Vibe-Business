# Sprint 0161 — The zone that does not flatten

**Date:** 2026-09-08
**Decision:** none. A danger zone on two settings surfaces, a typed confirmation, and one test-wide sweep.

## What was asked

Explain the open point from Sprint 0160, do it, then implement the danger zone in settings — deleting and disconnecting — with the design skills and some research first.

## The sweep, and what it was about

Eighteen browser specs measured horizontal overflow immediately after a load. At that moment the browser may still be laying out in a **fallback** face, because the web font has not arrived — and the fallback is wider, so a layout that fits by a few pixels measures as overflowing. Only under load, because that is when fonts are slow. It is a real intermediate state that no visitor ever sees settled.

Twice in one session, in two different specs, at exactly 4px. `e2e/support/overflow.ts` waits for `document.fonts.ready` and then asserts; 44 copies of the same four lines and two identically-named local helpers are gone. Two screens kept a documented one-pixel tolerance for sub-pixel rounding and pass it explicitly rather than having it quietly tightened.

**`first-ten-minutes` went from 1px of slack to 0 and still passes**, so that tolerance had been defensive rather than needed.

## What the research said about danger zones

The registries and the reference implementations agree on the shape — a bordered, tinted region, an alert icon, what is destroyed, and a destructive submit — and on one thing worth taking: **type-to-confirm**, a phrase that has to be typed before the button is available.

They also agree on a defect. GitHub's danger zone puts "change visibility", "transfer" and "delete for ever" in one box with one border and one colour, which flattens three very different consequences into one warning. Vibe's own General page states the rule that breaks: *a row that looks the same beside an irreversible one is a trap.*

## What was built

**`DangerZone` marks the region; `DangerRow` refuses to flatten it.** Every row states its own consequence in its own words and carries **Reversible** or **Permanent** beside its title — `reversible` is a required prop, not an optional one, so a row cannot be added without somebody deciding which kind it is.

**Project settings has both sharp controls in it.** Disconnect was a row inside the Repository card; deleting had a plain section at the foot from Sprint 0158. That sprint's argument — everything above is a fact, a destination or a reversible action, so position says which is different — works exactly once, and it left a reader learning that a control is destructive by reaching the end of the page. Disconnect keeps everything the project learned and says so; deleting destroys it and says that.

**Settings → General's erasure moved into the same component**, so both surfaces mark destruction the same way.

**`ConfirmPanel` gained `confirmPhrase`.** Erasing an account asks for `delete my account`; deleting a product asks for **the product's name** — because the mistake that one prevents is not "I did not mean to delete anything", it is "I deleted the wrong one", and this page is reached from a switcher by somebody with several products.

It is deliberately **not** used for disconnecting. That keeps the project and everything it learned; asking for a name there would be ceremony dressed as safety, and ceremony everywhere is how a real warning stops being read.

## What this reverses, and why that is not a contradiction

Sprint 0159 wrote that the delete section is *"not a coloured card: nothing else in this product marks destruction that way"*. It does now — the founder asked for the zone by name, and one marked region on both settings surfaces is a vocabulary rather than a one-off.

What UI-21 fixed is not undone. The defect then was two identical controls with the same icon inside a card about a *repository*, with nothing saying either was destructive. The zone is the opposite: an explicitly marked region where every row states its own consequence. The grouping was never the problem; the flattening was.

## Two defects found on the way

**A sentence said twice.** The new account row summarised the billing disclosure the confirmation already carries, and an existing guard caught it as an ambiguous locator rather than as prose. The row names what goes; the confirmation carries the rest.

**A test that read a line ending.** `says the person will not be able to sign back in` failed because an unrelated edit shifted the paragraph two characters and Prettier broke the line between "sign" and "back in". The disclosure was intact. It flattens whitespace before matching now — the obligation is about the words. **The same brittleness exists in the other source-prose tests** under `src/app/app/projects/[projectId]/`; they pass today and are not swept here.

## What the guards say

Four new browser claims on project settings, two of them mutation-tested:

- Both controls are in the zone, neither is left in the Repository card, and the zone is the last section on the page.
- The rows say which one can be undone. Replacing both labels with one word fails it.
- Deleting is disabled until the product's name is typed exactly — `Acmes` does not do it. Removing the match fails it.
- Disconnecting asks for no name.

And one changed: the heading rule was "everything under the `h1` is an `h2`", which the zone's `h2` with `h3` rows correctly breaks. It is "no level is skipped" now, which is what the original defect — `h1` straight to `h3` — actually was.

## Validation

Unit 8,862 · browser 634 · lint 0/0 · typecheck clean · no migration.
