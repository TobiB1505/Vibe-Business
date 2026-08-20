# UI-7 — Evidence, Voice & Reward

**Status:** implemented, with four items from the audit's scope deliberately not done and one
declined on the evidence — see *What was not done* below. Lint (0 errors) / typecheck / **5697 unit
tests across 306 files** / build / **312 browser E2E** green.

Derived from the product UI/UX audit of 17.08.2026 (`docs/audits/2026-08-17-product-ux-audit/`,
findings **F-14**, **F-18**, **F-19**, **F-23**, **F-25**). **F-13** — the broken-logo hero — was
already fixed by UI-S1 and is checked rather than re-done.

## Problem

The headlines earned trust and the layer underneath them spent it. Open a disclosure on the
flagship audit screen and the citations read "Signal pricing surface", "Journey checkout not
found", "Payments none" — evidence ids with their dots taken out, sitting under a sentence written
in a founder's own words. The evidence layer is where a person goes when they want to check whether
to believe the verdict, and it answered in the schema.

Around it: the label on the one moment the product stops and asks a person for something read
"Vibe needs u"; the map drew two symbols with no key; a permanent row announcing that nothing had
happened sat above the verdict; three animations ran forever; and on a phone half the workspace
navigation was undiscoverable.

## Changes

- **The evidence layer answers in the founder's words.** Ten families curated, and almost none of
  the words are new — `BUSINESS_SURFACE_LABELS`, the human-view `PRODUCT_SURFACE_LABELS`,
  `JOURNEY_STAGE_LABELS`, `CAPABILITY_LABELS` and `AUTHENTICATED_SURFACE_LABELS` already existed,
  written for exactly this reader and unreachable from the place that needed them. Publishing three
  of them was most of the fix, and it removed a duplication on the way.
- **The fallback is monitored rather than removed.** A stored audit can cite an id no producer
  emits any more, so `humanize()` stays — but every description now reports whether it was
  `curated` or `derived`, and a test walks every id the builders can emit and requires all of them
  to be curated.
- **"Vibe needs u" → "Vibe needs you"**, plus two other sentences written in Vibe's vocabulary
  rather than a founder's: "out of the engine's own priority order", and a customer being told that
  a browser provider needs configuring on a server they do not have.
- **The map explains its two symbols.** The numbered badge — which can read "1" on three nodes at
  once, because it names which priority an area belongs to — is now in the legend *and* in the
  node's accessible name, where it was previously absent entirely. The centre says what 43 is out
  of.
- **The permanent "Ready" row is gone.** Its fact moved into the audit's own provenance line, beside
  the lens and signal counts.
- **The map settles** after about eighteen seconds instead of animating for as long as the tab is
  open.
- **A phone can find the other five sections**, and can see which one it is on.

## Five things found by rendering the screen, not by reading the finding

1. **Two whole evidence prefixes did not exist as far as the resolver knew.** `profile.*` and
   `intent.*` produced all three strings the audit quoted. `map-view.ts` knew about them — it
   carries a second prefix table for the caption — so a row could read "from what Vibe understood"
   above a raw id, with the caption right and the citation wrong.
2. **Absence has two spellings.** `_not_observed` and `_not_found`. Recognising one meant every
   journey id kept its suffix and fell through, which is why "Journey checkout not found" read
   almost like prose and survived unnoticed.
3. **The caption table did not know `business.*`.** On any audit produced by the older evidence
   builder, every citation of the founder's own answers rendered with no source line at all.
4. **"Payments none" was never a product string.** `repo.payments.none` is emitted by nothing; it
   existed only in the browser fixture, and the audit quoted it from a screenshot of that fixture.
5. **The map badge was invisible to assistive technology.** The node's accessible name gave health
   and priority and stopped — so the one thing connecting a node to the priority list beside it was
   not announced at all.

## Declined on the evidence

**Timestamp localisation.** The audit asks for local time. `format-datetime.ts` renders UTC
deliberately, and the comment explains what it cost to learn: `toLocaleString()` produces a
different string on the server than in the browser, which is a hydration mismatch, and it threw an
uncaught error on the Review panel — inside the merge path. Doing this properly means rendering UTC
on the server and upgrading to local time after hydration, at every timestamp site. That is a real
piece of work, not a copy change, and breaking determinism to get it cheaply would undo a fix that
was paid for once already.

This is the fourth audit recommendation these UI sprints have had to decline after reading the
code, and the pattern is worth naming: the audit was written from screenshots and source at one
moment, and several of its directions collide with decisions the code made — and wrote down —
later.

## What was not done

- **The one-line mobile header.** The strip got its affordance and its orientation; the ~135 px
  sticky header above it did not shrink. It is a layout change to the shell with real regression
  surface, and the fixture harness cannot render the shell at all.
- **The label-soup diet** on lens detail and the understanding panel (nine mono eyebrows around
  four sentences), and **the understanding CTA conflict**.
- **The deep-scan phone strategy** ("continue on desktop"), which belongs with F-15's durable-
  operation question rather than with a copy pass.
- **`ScoreMeter` for legacy audits** is moot: UI-6 deleted it, because the barren state it was
  meant for was removed deliberately by UI-1.2.

## What has not been proved

**The phone navigation is unverified in a browser.** The affordance and the scroll-into-view are
asserted in source and reasoned about; the project shell is not renderable by the fixture harness,
so neither was seen running. That is the same gap UI-6 recorded for the shells and it has not
closed.

**No screen-reader run.** The map's new accessible name and the score's hidden sentence are correct
by construction and unheard.
