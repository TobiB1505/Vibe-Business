# Sprint 0163 — The room she assembles

Setup becomes the same conversation Home is, and Nova builds the room it happens
in. No ADR: every decision here is inside the boundaries
[0097](../decisions/0097-the-second-design-system-arrives-scoped.md) and
[0098](../decisions/0098-design-rules-are-revisable-truth-rules-are-not.md)
already drew.

## What was wrong

Sprint 0162 made Home a thread and said outright what it had not touched:
onboarding, "which still runs the pre-thread Nova UI". So a founder met Nova as
a conversation on the screen they reach *after* setup, and met ten sections of
chrome on the way there — an eyebrow, a display heading, a paragraph of prose,
and then the component that actually does the work. Nova appeared beside two of
the ten, quoted in a box.

The order was also backwards. `deriveNovaFirstRun` gated the introduction behind
`connect_source`, on the argument that "introducing Nova over an empty project
would be Nova saying hello about nothing". That reads the introduction as being
about the project, and it is not — it is about her, and about the fact that
nothing reaches a default branch without the founder saying yes. Neither
sentence needs a repository, and the first thing the old order did was ask a
stranger to hand over their code before telling them who was asking.

## What changed, and why that shape

**Ten sentences, as a total record.** `NOVA_ONBOARDING_MESSAGE` over
`OnboardingState`, with `NOVA_ONBOARDING_DETAIL` for the second true thing where
there is one and `null` where the block says it better — eight of ten. An
eleventh state fails the build until somebody decides what Nova says about it,
which is the guarantee `BLOCK_FOR_MOMENT` gives the twenty-one moments.
`deriveOnboardingState` was not touched: it is the same shape as
`deriveNovaFocus` — pure, facts in, one state out — and what it never had was a
sentence per state.

**She builds the room before she speaks in it.** Eight beats: the mark
assembles at full size, travels into an empty corner, the rail's frame is
*drawn* around it, what has already happened arrives inside, the status row
fades in, the thread column rises, her line lights, and she speaks. Total to the
first word is 3,960ms — the beats were cut to fit the existing four-second
ceiling rather than the ceiling being moved.

**One room, four callers.** `NovaRoom` holds the status row, the work column and
the conversation. Home's grid track was `[300px_1fr]` and setup's was
`[300px_minmax(0,1fr)]`; the opening built its rail from a `div`, a padding and
a copy of *Earlier* at a different gap; and the loading frame painted a
fifty-two-rem column with a poster heading, so the first frame of setup was a
layout that then vanished. All four compose the room now, and
`nova-room.test.ts` sweeps the product for a second copy of the grid.

**Setup's own steps are in the rail.** Four rows — Connect, Understand, Audit,
First move — in the same three marks the Action Plan uses. That list was removed
once, from a nav above the thread, on the argument that it was "a to-do list
about Vibe's process rather than anything a founder decides". It is not a
decision and was never meant to be: her sentence says *where we are*, and
nothing else on the screen said *how much is left*. The position was the
mistake, not the list.

**The first run is a first turn.** She says hello by name where there is one,
asks the only question setup has — get straight to it, or be shown how she works
— and answers it with what a person actually does not know: nobody writes
prompts, she leads, one clear step at a time, the price before the press, the
review before the branch. Then she shows it: `NovaHowItWorks` is one invented
turn, labelled as an example, captioned as made up before it is read, with the
Move dimmed and inert so the picture agrees with the sentence saying it cannot
be pressed. Nothing in it is priced, because a plausible figure on an invented
task would be the only fabricated number in the product.

**The blocks compose rather than contain.** Every state's body drops the frame,
the eyebrow and the headline the render block already carries — the same move
0162 made for Home, applied to the eight setup states that have a block.

## What rendering found that green tests did not

Eleven defects this sprint, every one of them found by opening a page. The
count is the finding: the suite was green before each of them.

1. **`NovaPresence` broke hydration under `prefers-reduced-motion`**, on the
   landing page, the rail and the status row — Motion's `useReducedMotion`
   answers before React hydrates, so the server emitted the mark's keyframes and
   the client did not.
2. **`NovaDissolving` stated three rules and kept one**: its reduced-motion rule
   was contradicted by the stylesheet, and *never on a timer* was a 420ms timer
   from mount that left a permanent gap.
3. **A block label was suppressed on a wrong premise** — "Files touched" is a
   section inside "Building", not a second copy of it.
4. **The ask said one thing three times, inside two amber frames.**
5. **The opening animated a connection that was not happening.** The header's
   `connecting` prop pulsed the *project* from "Connecting…" to "Disconnected"
   while `connected` had been read on the server and arrived with the first
   frame. Her availability is absent until it is true now: the beat reveals a
   state instead of resolving one.
6. **The room emptied on the handover** — two rows of *Earlier* during the
   choreography, an empty rail the moment she stopped speaking, because that
   branch passed `[]` on the argument that a project which has not met Nova has
   nothing logged. It has met her by then.
7. **Asking to be shown how Vibe works showed the connect screen.** The press
   wrote `explained`, that revalidates the route, and the derived position
   became `handoff` before the walkthrough could render. The write happens at
   the bottom of it now, by the person it is about.
8. **The example Move was indistinguishable from the live one** three inches
   below it, so the one sentence saying it could not be pressed was arguing with
   the picture next to it.
9. **The Product Scan printed a page hero inside a render block** — thirty-six
   point "Understanding your product", and under it a sentence Nova's bubble had
   just said in her own words. Its two inner layouts collapse at `max-lg`, a
   *viewport* query, so a 704px block inside a 1440px window kept a two-column
   layout at half its measure and truncated every label in it. Home renders this
   block too.
10. **The audit's preparing and analyzing states** drew a bordered, washed panel
    inside the block, labelled it "BUSINESS AUDIT · ANALYZING" under a frame
    already saying "Business audit", and headlined "Vibe is reading the whole
    business" under a bubble where Nova had just said she was going through it.
11. **The reveal headlined the pipeline's generic line** — "I understand what
    you built." — third in a row after the block's label and Nova's sentence.

**The mechanism behind nine of the eleven is the same one 0162 named**: a lab
that draws a picture of a screen instead of the screen. `study-onboarding` said
each block "needs a live project — a scan with events, a profile to confirm, an
audit to reveal", and every one of those already had a fixture builder; the
Product Scan is mounted in one three hundred lines further down the same file,
just never inside Nova's block. `study-onboarding-blocks`, `study-first-run-shipped`
and `study-opening-shipped` mount production components, and that is where four,
five and six of the above came from.

## The register, and the rule that was wrong

A test asserted Nova never uses a contraction. The observation was right — no
sentence in the product used one — and the conclusion was wrong. Read aloud,
contraction-free English is a briefing rather than somebody sitting beside you,
and the copy it was protecting proved it: the walkthrough opened *"I am not a
chat box"*, an assistant describing what it is not.

`DESIGN.md` records what replaced it. **Nova speaks like a trusted operator
sitting beside the founder, not like an AI assistant explaining its
capabilities** — competent, opinionated, and allowed to say *this part is good,
I'd leave it alone*, because a Nova who has to find a problem every time she
looks is a Nova nobody can trust when she does. Controls are the founder's
voice, not hers: *Straight to it, then* shipped for one commit and was Nova
answering her own question on their behalf.

Two sweeps hold it. One refuses assistant-speak in every sentence she has; the
other keeps every control label out of the first person. And `feed.test.ts` now
sweeps her first run at all — the copy a founder meets before any moment and any
setup state was the one part of her voice under none of the five truth rules.

## What was not changed, and why

**The greeting says the GitHub login, not a first name.** Nothing in this
codebase stores a name: `fetchGithubIdentity` keeps the login and the user id,
and `identity-view.ts` is explicit that an address is never shortened into a
name. Splitting "ada-lovelace" into "Ada" is a guess about a person rendered as
a fact about them. Storing GitHub's own `name` field would be the honest route
and needs a migration and a re-authorisation.

**No rotating sub-steps under the scan or the audit.** The scan already names
real stages from rows it writes. The audit judges all nine areas together, and
`audit-lifecycle.spec.ts` exists to refuse exactly the per-lens progress such a
list would draw.

**No price in a control's label.** Prices are effective-dated and rendered from
state; a number written into a verb is a second price that goes stale silently.

**The paused audit's two buttons stay buttons.** It is a form with a field, and
a Move with a text input is a shape this product does not have. The same is true
of `FounderInputCard`'s recommendation button, which 0162 already listed as a
wider decision.

## What has not been proved

**Nothing here has been dogfooded.** No signed-in project, in a browser, on real
data. Every screen was verified through fixture routes that mount the production
components — which is where every one of the eleven defects came from — plus
typecheck, lint, the domain suite, the browser suite and a production build.
Rule 69's fourth question is open, and this is the second sprint in a row it is
open on.

**No browser test touches any of the new fixtures.** The 598 that pass cover the
rest of the product; `study-opening-shipped`, `study-first-run-shipped`,
`study-onboarding` and `study-onboarding-blocks` are review surfaces with no
assertions. Everything this sprint built rests on unit and source tests plus
screenshots taken by hand.

**Home's thread floor was never seen.** `NovaHome` has no fixture and needs a
session, so the surface reaches it by composition and by the sweep in
`nova-room.test.ts`.

No migration, no schema change, no new dependency, no widened allowlist.

## Validation

Domain 9,097 · lint 0/0 · typecheck clean · build green · browser suite 598
passed, none failed, flaky or skipped.
