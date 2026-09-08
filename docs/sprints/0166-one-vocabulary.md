# Sprint 0166 — One vocabulary, and a stage for the one that sells

**Date:** 2026-09-08
**Decision:** treatment B from `study-cta`, with treatment D's landing button.

## What was asked

The button is settled and looks right. What was left: the inline text, the Credits control, and the buttons where money moves. Four treatments in `study-cta`; the founder chose **B** everywhere and **D's landing CTA** on top of it.

## What B means, and the argument it had to answer

Every link now wears the same resting container every other control wears. `StandaloneLink` is literally `buttonClasses({ variant: "ghost" })` — a link on its own line and a quiet button were already the same object doing the same job in the same place, and the only thing separating them was which file drew it.

The prose link is the one that needed an argument. This file used to carry it: for a link inside a sentence the underline is the only signal besides colour, and **WCAG 1.4.1 is explicit that colour alone may not carry that inside a block of text** — so removing it would be a defect, not a cleanup.

That argument is **met, not overruled.** A container is not a colour. The prose link is a tinted, rounded box with its own ground, which separates it from the words either side at any zoom, in monochrome, and for a reader who does not perceive the hue at all — every test the underline passed, and one more, because the box has a shape.

It is `inline` with `box-decoration-clone`, not `inline-flex`. A box in a sentence has to break across lines; `inline-flex` cannot, and a long link at 390px would push the paragraph sideways instead of wrapping.

## What the work found that nobody asked about

**Seven links were never on the system at all.** `/terms`, `/privacy`, `/login`, `/signup`, `/forgot-password` and `/reset-password` each wrote `text-mint hover:text-mint-hover` by hand, and the Business Brain wrote its own standalone link with an arrow. Found by accident: the new browser guard was pointed at `/terms` and reported `display: inline` on an element that turned out not to be a prose link at all. Six are `proseLinkClasses` now and one is `StandaloneLink`.

**The identity pill and the wallet were two hand-written copies of one pill.** Moving the wallet onto the system broke the guard that pinned them together — correctly, and for the third time these two have had to be re-synchronised. Both take `buttonClasses({ variant: "ghost" })` now, and the guard asserts the *source* rather than four literal class names, which is what ends that cycle.

**`primary` and `secondary` had no press at all.** A guard written this sprint — *gives every variant a press a finger can feel* — found that only `ghost` and `danger` carried an `active:` colour step. A finger on "Buy Credits" was answered by the 1px transform alone, and `prefers-reduced-motion` switches that off: on a phone with that setting, the button that spends money acknowledged nothing. Both press their sheen *under* now.

**The pack price was printed twice**, in the row and again two hundred pixels right in the button. B puts it in the button, so the row says "1,500 Credits / one time" and the button says "Buy · €33". A price printed twice is a price somebody reads once and presses the other one.

## The landing CTA is a component, not a size

`size="marketing"` is a class list; D's button is a structure — a mint halo behind it, a second line of type inside it. `MarketingCta` owns both.

The second line is **not a slogan**. It takes the objection a visitor has at the moment of pressing, and the hero already had one: *"No credit card to start"*, sitting in a list twenty pixels below the button. It is inside the button now and **gone from the list** — moved, not added. A promise printed twice reads as a sales page rather than as a fact.

The halo is `aria-hidden`, static, and blurred: nothing animates, so there is nothing for reduced motion to switch off. That is the version of "impressive" that survives an accessibility setting and a screenshot alike.

## A guard that measured nothing, and how that surfaced

The first version of the wrap guard checked whether any prose link on `/terms` overflowed its paragraph. It passed with `inline-flex` put back — because no link on that page is long enough to reach the edge, and because the one link it found was hand-written and not a prose link at all.

A guard that only fires when the copy happens to be long enough is a guard that depends on the copy. It asserts the mechanism now — computed `display` and `box-decoration-break` — with the overflow measurement kept underneath as the real-world half. Chromium implements only `-webkit-box-decoration-break` and reports the unprefixed property as `slice` however the element is styled, which is its own small trap and is written down beside the assertion.

## Validation

Unit 8,881 · browser 641 · lint 0/0 · typecheck clean · no migration. Landing, project settings, billing and `/terms` rendered and looked at. Five mutations run on the new guards, all caught.

**Not proved:** the halo and the two-line CTA have been seen at 1280 only. Nobody has looked at the landing hero on a phone, where the button is widest relative to the screen and the second line has the least room.
