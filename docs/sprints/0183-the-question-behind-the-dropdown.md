# Sprint 0183 — The question behind the dropdown

**Date:** 2026-09-08
**Decision:** none. A second choice primitive, and the section that needed it.

## What was asked

The delete button should sit on the same side as disconnect — they look unequal. Then rebuild "What you told Vibe", which looks old-fashioned.

## The first one was already fixed

Both controls are at x=329 with the same height in the current build. The screenshots sent with Sprint 0182 were taken *before* the `items-start` change and showed the old right-aligned disconnect. Measured rather than argued, because "already fixed" is a claim worth checking before making.

## What was wrong with "What you told Vibe"

Three native `<select>` elements, under labels that read like a schema: *Stage*, *Monetization you're planning*, *Primary goal*. A dropdown is the right control for a long list nobody needs to read — a country, a timezone — and the wrong one for a short set of authored alternatives that **is** the question. Four, eight and six options, every label a complete answer, all of them behind a click and drawn by the operating system rather than by Vibe.

And the read state was a `dl` with a 128px label column: a spec sheet, and a different shape from the thing that edits it, so saving swapped one layout for another.

## What was built

`ChoicePills` — a `radiogroup` of pills, every option on screen. The questions are questions now: *Where is the product right now?*, *How does it make money, or how will it?*, *What are you working toward next?*. The read state is the chosen pills, so a founder recognises their answers instead of reading them back in another form.

The point is not that a pill is prettier than a `<select>`. It is that seeing the eight monetization options is most of what makes that question answerable.

**The mark answers `ChoiceCard`'s own objection.** That component's docblock argues for keeping a dot when the border already says selected: a tinted border is a *comparative* signal, readable only against the unselected ones beside it. So a selected pill is not merely tinted — it is filled, inverting text and ground, and it carries a tick. Both are absolute.

**No "Not specified" pill.** It would sit among the real answers looking like one. The honest shape of "no answer" is no pill selected, with a `Clear` that appears only once something is. With no radio checked the field is absent from the submission, which `optionalEnum` already reads as null — no server change.

**`Clear` sits beside its question**, not at the far border of the card ~700px from the words it undoes. That is the third time this session the same separation has been caught: UI-21 measured it on this page, UI-24 fixed it in the danger zone, and this is the same mistake made fresh.

## Two guards fired, and both were right

**`no .tsx outside field.tsx writes its own <select>`** — matching `<select` in the *prose* explaining why the selects are gone. That is precisely the trap Sprint 0175 recorded from the other direction, where a docblock containing `role="alert"` let an assertion pass with the attribute deleted. Both guards strip comments now; a guard about code reads code. Mutation-tested by putting a real `<select>` into a form.

**`leaves no hand-written radio in the product`** — and this one caught something real. `ChoicePills` is a second radio convention, which is exactly what that test exists to prevent.

The answer is not a silent allowlist entry. Two primitives is a decision: `ChoiceCard` for two or three alternatives that each need a sentence, `ChoicePills` for a handful whose labels are the whole answer. Both live in `src/components/ui/`, both use real radios so grouping and arrow keys come from the browser, and feature code still writes none of its own. The argument is written in both files and named in the exception list — which the suite's own "keeps the named exception honest" test holds to account.

## What the guards say

Four new browser claims on the section, two mutation-tested:

- No `<select>` remains on the page, all three questions are asked as questions, and eighteen radios are on screen before anything is clicked.
- The chosen pill carries a mark of its own, not only a tint. Removing the tick fails it.
- Clearing puts the group back to nothing chosen, and the control is absent until there is something to undo.
- `Clear` is within 80px of the question it undoes. Restoring `justify-between` fails it.

## Validation

Unit 8,862 · browser 638 · lint 0/0 · typecheck clean · no migration.
