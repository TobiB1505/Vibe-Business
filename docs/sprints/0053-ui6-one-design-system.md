# UI-6 — One Design System, Applied

**Status:** implemented, with one of the audit's eight workstreams deliberately left open — see
*What was not done, and why* below. Lint (0 errors) / typecheck / **5484 unit tests across 303
files** / build / **312 browser E2E** green.

Derived from the product UI/UX audit of 17.08.2026 (`docs/audits/2026-08-17-product-ux-audit/`,
systemic debt items **1, 2, 3, 6, 7, 8, 9**). Items 4 and 5 were closed by UI-4.

## Problem

The primitives in `src/components/ui/` are well-reasoned and documented. The debt was never their
design — it was **adoption**, and between the audit and this sprint it grew: raw `<button>` went
from 42 to **49**, and the copy-pasted string `rounded-md border border-line-4 px-3 py-1.5…` from
~15 to **23**, across the same seven panel files.

The visible cost was concentrated in one place. **Mint — the colour that means Vibe — appeared
nowhere in the execution flow.** "Merge approved change", the click that writes to a customer's
default branch, was a grey rectangle indistinguishable from Cancel.

## The test that had to move first

Four test files each carried an identical extractor pulling `<button>` and `<a>` out of panel
source. Between them they hold the **exact action allowlists** for the most consequential screens
in the product: the merge panel may offer two labels, the outcome panel one, and no panel outside
the merge panel may offer a merge, deploy or ship control at all.

Every one of them would have found **nothing** the moment those controls became `<Button>`. An
allowlist over an empty list passes. Four of the load-bearing safety tests here would have gone
green while asserting nothing, on merge and approval specifically, and no test would have failed to
say so.

So the extractor landed first, on its own commit: one implementation, aware of the primitives as
well as the DOM elements, that **throws rather than returning an empty list**. Its own tests pin
that guard, with a canary over all eight panels it covers.

## Changes

- **One button system.** All seven execution panels use the primitive, with one mint control per
  section *and per state*: Merge (opener and confirm — the dialog replaces the opener, so the
  screen never carries two), Approve, Start temporary preview, Validate, Generate comparison, Check
  production outcome, Start measuring. Raw `<button>` in the app: **49 → 13**, of which two are the
  primitives themselves, six carry `buttonClasses()` inside forms, and five are interactive cards
  and map segments that are deliberately not buttons.
- **The third button system got a name.** Nine underlined text actions — "Sign out" in two headers,
  "Change" beside a value, "More context" under a paragraph — were each written from scratch.
  Making them pills would have been the wrong fix: a header with two competing pills is worse than
  a header with a link. `TextAction` names the category next to the one it is not, so the pill rule
  in `button.tsx` stays literally true.
- **One status vocabulary.** `statusToneText` resolves a tone, `STATUS_GLYPHS` resolves a mark, and
  the three surviving local tables name a tone instead of a colour class.
- **One confirmation.** Four hand-written blocks became `ConfirmPanel`, with the keyboard behaviour
  a dialog owes its user. `window.confirm` is gone. The deep-scan dialog — a real modal — gained
  the focus trap and focus restore it never had.
- **`aria-busy` on twenty-seven controls** that swap their label for "Merging…", "Saving…" while a
  transition runs, plus one live region on the prepared-change headline.
- **The focus ring stopped fading in**, in twenty controls rather than one.
- **Four dead components deleted**, two duplications removed.
- **Two type sizes added to the scale**, and forty-seven call sites stopped writing the number.

## Three places the audit's recommendation was declined on the evidence

**`failed = coral or amber` is not drift.** The outcome panel's `failed` means a check did not hold
on a customer's public product — which §22 spends four sentences insisting does not mean anything
is broken, because the new build may not be serving yet. Colouring that coral tells a founder their
product failed on the evidence that Vibe looked early. The validation panel's `failed` means a
command exited non-zero inside an isolated VM: attributable, actionable, coral. Two states sharing
an English word. The fix was to name the tone at each site so the choice is legible, not to
reconcile the colours.

**`ScoreMeter` has no home to be revived into.** The audit asked for it to be kept for "the barren
legacy-audit state". Sprint UI-1.2 removed that state deliberately and wrote down why — three
things were saying the same thing on one screen, and "a page that offers two answers has not made
one." It is deleted, and the reason is the decision rather than the use count.

**"~90 arbitrary type sizes" is mostly a missing scale.** Measured, most of it is two numbers used
forty-seven times that the scale has never had. The call sites were not ignoring the system; there
was nothing for them to name.

## Two bugs found by writing the test rather than the code

**The confirmation could not return focus.** The first version of `ConfirmPanel` remembered the
active element and restored it on unmount. That cannot work here: every one of these sections
renders *either* its opener *or* the confirmation, so by unmount time the button is a detached node
and `focus()` on one silently does nothing. A browser test asked where focus had gone and got
"inactive". `useReturnFocus` owns that half from the section, where the opener still exists.

**One of the two colours that failed was not on the list.** `text-danger` names no token and never
has, so a `role="alert"` rendered in whatever colour it inherited: the message telling a founder
their answer did not save was styled as ordinary text. The scan written for the contrast fix found
it.

## What was not done, and why

**The surface, radius and container pass (systemic debt #8) is open.** Sixty ad-hoc
`rounded`+`border` rectangles against thirty-nine `Surface` uses, `rounded-md` twenty-one times
against five designed radius tokens, and thirty-three distinct `max-w-*` values.

It is left open deliberately rather than rushed. Unlike every other item here, it has **no test
that can tell whether it went right**: it is a purely visual change across sixty containers, and
the suites that carried the rest of this sprint — allowlists, copy assertions, contrast arithmetic
— say nothing about whether a card still looks like a card. Doing it properly means a screenshot
pass per surface, and doing it quickly means changing sixty rectangles on the strength of a grep.

## What has not been proved

**The visual result is checked at two widths, on fixtures.** Before and after screenshots at 1440
and 390 px across the execution flow, the audit synthesis and product understanding. What that
does not cover is the signed-in shells, onboarding and the GitHub connect flow, none of which the
fixture harness can render — those changed too, and were read in source only.

**No screen-reader run.** `aria-busy`, the live region, the focus restore and the modal trap are
asserted in Chromium and in source. Whether the result is *pleasant* to hear is a different
question, and belongs to the first real accessibility pass.
