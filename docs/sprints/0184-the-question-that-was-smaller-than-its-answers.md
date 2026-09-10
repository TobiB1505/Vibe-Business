# Sprint 0184 — The question that was smaller than its answers

**Date:** 2026-09-08
**Decision:** none. A correction to Sprint 0183, including one of its own mistakes.

## What was asked

*"Die Fragen sind viel zu klein, ehrlich gesagt ist das jetzt noch unübersichtlicher wie davor, viel zu viel Text."*

## What was actually wrong

Right on both counts, and the second one was mine to have seen.

**The questions were the same size as the answers.** `text-body font-medium` for the question, `text-body` for each of the eighteen pill labels under it. A question that does not outrank its answers is not a heading, whatever it is called — so three questions and eighteen options read as one column of text rather than as three blocks with a structure.

**And the section said the same thing twice.** The card's intro was three clauses — *"Vibe works out what your product is on its own. This is the part only you know — it changes which problems Vibe puts first, and every field is optional"* — above three questions that now ask exactly that in their own words, plus a hint under the third repeating the middle clause a third time. Making the options visible was right; leaving the prose that existed to compensate for them being hidden was not.

## The mistake inside the fix

The first correction set the question to `text-ui font-semibold`, on the assumption that a token named for interface chrome sits above body text.

It does not. **`--text-ui` is 0.8125rem and `--text-body` is 0.875rem** — the questions got *smaller*. The right step is `--text-lead` at 0.9375rem, which also leaves `--text-title` to the section heading above it.

Read from `globals.css` rather than assumed, which is what should have happened the first time. There is now a browser guard that measures both computed sizes and fails if the question is not the larger, so the next person cannot make this by reasoning about a name.

## What changed

- The question is `text-lead font-semibold`; the answers stay `text-body`.
- A hairline between the groups, so three questions are three blocks rather than one wall.
- The intro is one line — *"Three things evidence cannot see. All optional, and they change which problems Vibe puts first."* — and the third question's hint is gone with the clause it repeated.
- Air between that line and the first question, which had none.

**The option labels are untouched**, and deliberately. Shortening them was the obvious way to cut text, and `GOAL_LABELS` is imported by `src/modules/nova/voice/move-slot.ts` — it is model-facing vocabulary, not display copy. Cutting words there would have changed what Nova says to save four pixels here.

## Two guards that were asserting the wrong thing

**`says each thing once`** pinned the literal sentence *"Vibe works out what your product is on its own"* and required exactly one occurrence. UI-25 cut that sentence, so the guard failed on a page with no duplication at all. It asserts the property now: no two paragraphs in the section are identical. A guard pinned to a string that no longer exists says nothing about the next duplicate.

**`swipes between Moves while keeping details below`** failed by 7px under a full parallel run and passed three times in isolation. Not the font mechanism from Sprint 0182 — the opposite direction: this measures right after a swipe, and a sliding carousel track is momentarily wider than its viewport. The file already had `settledBox` for waiting out exactly that movement; the assertion uses it now rather than being lucky.

## Validation

Unit 8,862 · browser 639 · lint 0/0 · typecheck clean · no migration. The size guard was mutation-tested by putting `text-ui` back.
