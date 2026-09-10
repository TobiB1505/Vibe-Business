# Sprint 0218 — The suite runs what ships

**Date:** 2026-09-10
**Decision:** no new ADR. This carries out what [sprint 0217](0217-the-palette-the-suite-never-sees.md) found and deliberately did not fix.

## The change is two lines and the reason is the whole record

`playwright.config.ts` now starts its server with `VIBE_PALETTE=v2`, and builds the suite's consent cookie with the product's own `encodeConsent` instead of typing the string out.

Both were the same kind of defect: **a fixture that was true when it was written and has no way of noticing that it stopped being true.**

## What running v2 broke, and what it did not

Six failures, and **not one of them was a product screen.** All six were in the two specs that talk *about* the palette:

- `ground.spec.ts` measured "v1 paints nothing" by loading a page and assuming what it arrived in.
- `palette-switch.spec.ts` asserted `data-vibe="v1"` outright, with a comment explaining that the suite's server sets no `VIBE_PALETTE`.

Neither was rewritten to say `v2`. That would have been the same mistake with a different letter. `ground.spec.ts` gained a `palette(page, "v1" | "v2")` helper and every test now names the palette it is measuring; `palette-switch.spec.ts` reads the deployed palette off the page and flips *away from whatever that is* and back, because what it is about is the switch and not the deployment.

Both files now pass against a v1 server and a v2 server. That was checked by starting one of each, not by reasoning about it.

## The cookie that was only an answer by coincidence

The suite ships a refusing consent record in `storageState` so that eight hundred unrelated tests do not have to reason about a banner. It was the literal `"v1.000.1757246400"` — and that string is an answer only while `CONSENT_VERSION` is 1 and there are exactly three optional categories.

`record.ts` instructs, in its own docblock, to raise the version whenever the category list gains something loaded. The first person to follow that instruction would have handed the entire suite a banner back. On a phone that banner is `fixed bottom-0 z-50`, it lands on the tab bar, and it intercepts every tap on the navigation — which UI-35 found the hard way.

Mutated to check: version raised to 2, config reverted to the literal, imports removed so it compiles. **Six failures**, including the new guard, exactly as predicted.

The value is derived now, so it cannot drift. `consent.spec.ts` states the intent anyway — the banner is absent on an ordinary screen, and the record parses as current and complete — because a constant that is correct by construction is still worth asserting when the failure mode is silent and suite-wide.

## And one it surfaced that was never about the palette

A seventh failure appeared on the full run and not in the six: the segmented
control's keyboard focus ring, in `account-repositories.spec.ts`. It looked
like the clearest v2 defect of the lot — a missing focus ring is an
accessibility failure, and `ui-design-system` names the mint ring as the one
global rule.

Run on its own against a v2 server it passed. Against a v1 server it passed.
The variable was never the palette: the pill carries `transition-interactive`,
which animates `box-shadow` over 150ms, and the test read `getComputedStyle`
immediately after the keypress — so it could catch the ring at its transparent
start. It sat on the right side of that race for as long as the suite ran v1
and landed on the wrong side under v2's heavier first paint.

The assertion is polled now, because the claim is about where the ring ends up
rather than what it looks like one frame in. Worth recording as its own kind of
finding: **moving the suite did not only expose v2 defects, it re-rolled every
timing assumption in eight hundred tests.** This one was luck expiring, not a
regression, and the difference is only visible if you run the thing in
isolation before believing the headline.

## What this does not settle

`reuseExistingServer: !process.env.CI` bit twice during this work: a manually started server on the same port is reused, so a rebuilt `.next` is not what the tests run. Both times it produced a mutation that appeared to pass. It is a real convenience locally and it is genuinely dangerous next to a mutation-driven workflow; nothing here changes it, and it is written down because the next person will lose the same hour.

Unit 9,508 · browser 848 with 1 new · tsc clean · eslint 0 · build clean
