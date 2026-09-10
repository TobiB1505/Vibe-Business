# Sprint 0181 — The banner that had to be true

**Date:** 2026-09-08
**Decision:** none. A consent system, and the General page that holds it.

## What was asked

General settings rebuilt, and then the important one: cookies, settable in Settings, with a banner. Research first.

## What the inventory found, before any UI

A consent banner is a promise, and a promise about categories nobody inventoried is a lie with a checkbox on it. So the first thing was to grep for every cookie and every third-party tag this product actually loads. The answer was worse than expected:

**Three third-party tags were mounted in the root layout unconditionally**, on first paint, with nothing asked:

- Vercel Web Analytics
- Vercel Speed Insights
- **The Meta Pixel** — an advertising tag that sets `_fbp` and reports the address of every public page a visitor opens to Meta.

Under TTDSG §25 and the GDPR the last of those needs **prior** opt-in in Germany, where this is operated from. And `/privacy` already listed the gap in its own "not yet complete" panel: *"Consent for advertising cookies where the law requires asking first, and a way to decline."* It was right, and it had been right for a while.

So this was not a decorative banner. It closed a real gap the repository had already documented as open.

## What the research said

21st.dev returned four cookie banners; ReUI's are behind a Pro licence. They agree on a shape and on a defect: **a filled *Accept all* beside a quiet *Customize***, which puts refusal two clicks and a reading behind acceptance. That is the pattern German and French regulators have repeatedly fined, and it is the one thing about a consent banner that is not a matter of taste.

So the reference showed what not to do. What was taken is the composition — a card at the foot, categories with switches, the detail on demand.

## What was built

**`src/modules/consent/categories.ts` is the inventory**, as a table in its own docblock, and every category names the specific thing it gates. There is no category here that toggles nothing, and nothing loads that is not listed here. `necessary` has no switch, because a switch that cannot be moved still says *this could be off, and somebody decided for you*.

**The record is a cookie, not `localStorage`**, and it is crude on purpose: `v1.101.1757246400` — version, one digit per optional category in a fixed order, and the second the choice was made. No identifier of any kind. It carries a version because **consent is given to a list**: when the list changes, an old record no longer describes what is being asked, and treating it as an answer is answering on somebody's behalf.

**Absence is refusal.** A missing, malformed, forged or stale value resolves to nothing optional, and every failure path in the decoder ends at `null`. This is the one rule the whole feature rests on and it has its own unit suite, including every combination of the three flags rather than a sample — the flags are positional, and a transposition is invisible in any single case where two agree.

**A refused tag is absent, not silenced.** `ConsentGate` mounts the tags; there is no script element to disable and no `fbq` stub queuing calls for a library that will not arrive. Whether the deployment may run the pixel at all stays a server fact — consent cannot switch on a tag a Preview deployment must never run, and both have to be true.

**Preferences gates something real**: `vibe-last-project`, the one thing in that category. Refuse it and `RecordVisit` writes nothing; `/app` falls back to the attention ranking, which is a correct screen and always was.

**Settings → General is regrouped.** It was five panels of identical weight — who you are, what GitHub allows, signing out, deleting the account — and drawing four different kinds of thing the same way makes a reader read all of them to find the one they came for. Labelled groups now: Account, Privacy, Access, This device, then the delete section last and alone. Cookies live under Privacy, in the same component the banner opens, because withdrawal has to be as easy as consent and "as easy" means a page you can find.

**`/privacy` stopped being wrong.** The pending item is gone because it is done, a "Cookies, and what you decide" section names every category and recipient, the advertising section says the tag does not load without consent, and "Your choices" points at the panel instead of at a contact address that does not exist yet.

## Three defects this found in itself

**A full-width invisible barrier across every page.** Mounting the banner globally failed **29 browser tests** on screens with nothing to do with cookies: the wrapper spans the viewport, so a click anywhere near the bottom landed on the banner's empty margin. `pointer-events-none` on the strip, restored on the card, took it to 15. The remaining 15 were the card genuinely covering controls, which is what a banner does — every other spec now starts from a refusing consent cookie set in `playwright.config.ts`, and `e2e/consent.spec.ts` is the only place that clears it.

**A transparent panel.** The card was written with `vibe-surface vibe-surface-card` by hand, and rendered see-through over the landing page — the hero type straight through the panel a visitor is meant to read before deciding. `.vibe-surface-card` carries only the backdrop blur; the fill comes from the level. `Surface level="card"` is the fix and was the rule all along.

**Unit tests guarding nothing.** Mutating `allowedCategories` to resolve an unknown value to *accept all* failed three unit tests and **not one browser test** — because the hook reimplemented both it and `needsDecision` inline and nothing in the product called either. They are called now. The same mutation fails six browser tests today.

## What the guards say

Twelve browser claims and nine unit ones. The load-bearing ones are not about appearance:

- With no decision, **no tracker is in the document** — not disabled, absent.
- Refusing records the refusal, still loads nothing, and survives a reload.
- Accepting loads the analytics that were refused a moment ago, which is the proof the switch is wired to something.
- Refusing is drawn exactly like accepting: same row within 8px, and identical background, weight and height.
- The banner puts no invisible barrier across the page.
- Nothing is pre-ticked, and `necessary` renders no switch at all.
- A record from a different list, or one this code did not write, asks again and loads nothing.
- In Settings the switches match the stored cookie, and withdrawing is the same single click as giving.

Three mutations, all caught: an unknown value resolving to acceptance, the barrier returning, and *Accept all* becoming the loud one.

## One thing left open, deliberately

`the product index fits at 768px` failed by 4px under load — the same mechanism as the repository index earlier today, in a different spec: horizontal overflow measured without waiting for the web fonts, and a fallback face is wider. Fixed here; **sixteen other spec files measure overflow the same way** and are latently flaky for the same reason. That is a mechanical sweep across test files with no product risk, and it is queued as its own task rather than widened into this one.

## Validation

Unit 8,862 · browser 631 · lint 0/0 · typecheck clean · no migration.
