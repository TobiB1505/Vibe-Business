# Sprint 0166 — The part she has not seen

Setup gains one step: after the founder confirms what Vibe understood, and
before the audit, Nova says what she has *not* read and offers to go and read
it. No ADR — the Deep Scan's own decisions
([0012](../decisions/0012-authenticated-browser-analysis.md),
[0076](../decisions/0076-the-browser-we-own.md)) already drew every boundary
this stays inside, and nothing here changes what a scan may do.

## What was wrong

Nothing was broken. Something was simply never offered.

`evidence-v3.ts` has written the same sentence into every audit that runs
without a signed-in read since the day it was written:

> Nothing behind the product's login has been inspected, so anything only
> visible to signed-in users is unobserved.

That line is the audit telling the model — and, through it, the founder — that
it is judging a business with the part that matters missing. The remedy existed
and had for months: the Deep Scan opens a browser Vibe owns, hands it to the
founder to sign in, reads what is behind the login and stores it, and
**the first one on every project is included** — `included_first_scan`, whose
own docblock says the reason plainly: *"The included scan is product
activation, not a discount."*

It was reachable from two places, both of them after setup: the Deep Scan page,
and My Product's spotlight. So a founder finished setup, got their first audit,
and the audit was the weaker one — by a gap Vibe had recorded, could have
closed, and had not asked about.

## What changed, and why that shape

**One state, and it derives like every other.** `add_signed_in_product` sits
between `product_reveal` and `audit_preparing`, and `deriveOnboardingState`
places it from three facts: there is a live address to open, no completed
authenticated read exists, and the founder has not declined. Two of the three
are canonical rows elsewhere and are read, never copied. Only the decline is
new, and it is one nullable timestamp on the row that already holds the other
setup milestones.

**Where it sits is the only place it is both true and useful.** Earlier is
impossible: the public crawl is what knows whether there is a login, and it
runs inside the scan. Later is too late: by `audit_preparing` the audit is the
next press, and the whole point is to be read before it. Between them, the code
and the public pages have been read, so Nova can say exactly what is missing.

**She says what she saw; she asks only what she cannot know.** The public crawl
already detects login surfaces — `detectAuthenticatedSurfaces` ranks a path
that *bounced to a login* highest, because that is the server itself saying
there is something here you may not see. So the state has two readings and no
question in the common one: with evidence, the block leads with the evidence
(*"Vibe found a sign-in surface on your website."*); without it, the same offer
stands, quieter. This was the founder's call over asking everyone the same
yes/no, and `login-detection.ts` had already written the argument for it: *"That
button is a question Vibe can usually answer itself, and asking it has a cost."*

**The block is the shipped panel, composed.** `DeepScanPanel` gains
`presentation="block"`, which drops its own border and its jump anchor — the
same move 0162 and 0163 made for eight other setup states. The entitlement, the
price, the two-minute sign-in deadline, the live picture and every failure state
are the ones a founder meets everywhere else, because they are the same
component.

**The reveal stops bundling the audit when this stands between them.**
`novaRevealControls` offers *confirm and audit* in one press whenever the audit
is free. With a step in between, that press would start the audit over an
answer the founder had not been asked for yet, so the bundle is withheld — read
from the same predicate that places the step, never a second copy of it on the
page.

**The route's ceiling moved to 240 seconds.** The analysis runs inside the
segment that hosts the panel; the Deep Scan page carries the same number and
says why: without it the founder signs in, a browser session is paid for, and
the function is killed before the result comes back. The objection recorded
there — that the ceiling used to make *every* section of the workspace long —
does not apply to a route that is one step at a time.

## What rendering found that green tests did not

Three, and the pattern from 0163 held exactly: the suite was green before each,
and each came from putting the thing on a screen.

1. **The panel said Nova's sentence back to her.** The `recommended` branch
   opens *"Vibe can see your code and public website, but some of your product
   is behind a login"* — which is Nova's bubble, three inches above, written as
   panel prose. Dropped in block presentation; the two lines that survive are
   the two she cannot say, the specific evidence and the price.
2. **`not_recommended` offered a free scan and never said so.** It hand-rolled
   a *"Run Deep Scan"* button with no terms at all, while the branch beside it
   — reached on the same offer — says *"Run free Deep Scan"* and that the first
   is included. Every other kind of offer ranks above `not_recommended` in
   `buildDeepScanViewModel`, so what was being offered with no price was always
   the included one. It reads `NextScan` now, like every other branch.
3. **A second "Not now", and the dead one first.** The panel carries a `Not
   now` that is a `span` — muted text beside a button, reading as the other
   option and doing nothing. Setup puts a real control under the block, so the
   inert one is dropped there.

The hierarchy defect that came with the fix was found the same way: with the
two prose lines gone, the evidence line was the *lead* of the block and was
still styled as a footnote under the sentence about pricing.

## What was found and deliberately not fixed here

**`BusinessMap` hydrates differently under `prefers-reduced-motion`.** The
audit reveal's node buttons render their animated `from` values on the server
and their settled values on the client — `top: "11.5942%"` against
`top: "11.594202898550725%"`, `transform: translateY(calc(-50% + 12px))
scale(0.72)` against `translateY(-50%)`. It is the same class as 0163's
`NovaPresence` failure and it is **on `main`**, verified by checking out the
merge commit and reloading the same page. It is a defect in a component this
sprint does not touch, so it is recorded here and not bundled into a change
about setup.

## What has not been proved

**Nothing here has been dogfooded**, the third sprint running. In particular
nobody has signed in to a real product through this step: the browser tests
cover the offer, its two readings, its price and its way out, and every one of
those is a fixture holding a `DeepScanViewModel`. What happens after *Run free
Deep Scan* is pressed from inside setup — the dialog, the countdown, the
handoff, the ninety seconds, the result landing in a state that then moves on
— has been read in code and never watched.

**The 240-second ceiling is asserted by nothing.** It is a route export, and a
test that proves the analysis survives on that route needs a browser session
this environment cannot open.

**Whether the audit is measurably better** with a signed-in read is not
something this sprint established. What is established is that the audit stops
recording the absence.

## Validation

Domain 9,311 · lint 0/0 · typecheck clean · build green · browser suite 676
passed, none failed, flaky or skipped. One migration, one nullable column and
one widened CHECK, no schema change beyond it, no new dependency, no widened
allowlist.
