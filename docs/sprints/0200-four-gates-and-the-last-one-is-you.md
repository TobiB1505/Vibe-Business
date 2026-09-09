# Sprint 0200 — Four gates, and the last one is you

**Date:** 2026-09-09
**Decision:** module four of the landing page is the Agent, drawn as a passage with gates across it — three that part as they are reached, and one that does not.

## What was asked

*"Modul 3 einmal lass du dir etwas einfallen was passen würde."* — then, of the
proposal for the block after it: *"Ja mach."*

The proposal was: **04 — der Agent: isolierter Branch, eigene Validierung, deine
Freigabe. Dafür würde sich als vierte Form ein Ablauf mit Toren anbieten: die
Stufen nacheinander, und an jeder ein Tor, das entweder aufgeht oder die Sache
anhält.**

## The shape is the argument, for the fourth time

Step one is two tiles — a thing and an explanation. Step two is a staircase.
Step three is a narrowing. This one is a **passage**: a path down the page with
a barrier across it at four points.

That an agent writes code is not the interesting part and every competitor has
one. What a founder is actually deciding is whether to let a machine near the
branch they ship from, and the honest answer is three checks Vibe makes on its
own work plus one it cannot make. So the picture is four gates, and the last one
has no mechanism on the inside.

## The last gate is drawn shut because it is shut

Rule 58 gives Vibe exactly one path to a default branch and it is not
autonomous: an approval binds to one immutable commit (67), the write needs that
approval **and** live state read immediately before it (70), and the move is a
fast-forward to that exact commit or a refusal (71). A gate that opened on
scroll like the other three would be the page contradicting the architecture in
the one place a visitor is looking for reassurance.

Under it, both halves of rule 74 rather than the flattering half: merged means
the default branch points at the approved commit and Vibe read it back — not
deployed, Vibe calls no deployment provider at all, and moving a default branch
can still start the customer's own pipeline.

## Every gate carries its failure

A gate that only ever passes is decoration. Each of these is a rule this
repository already enforces, said in the words a founder cares about:

- a branch that moved **stops** the run rather than triggering merge reasoning (56);
- Vibe never reads the agent's account of its own work, and a workspace reading
  it cannot complete fails the run instead of becoming a partial change (77);
- a validation that passes means those commands exited zero — **never** that the
  change is safe, correct or ready (66), which is the sentence a marketing page
  is most tempted to round up.

## The old section said the same five things twice

`#agent` was a five-stage list beside a panel headed *What each stage proves* —
rendering the same `AGENT_STAGES` array twice on one screen, title and detail in
a column and then title-colon-detail in a card. It is deleted rather than left
above or below the new block: two blocks about the agent on one page is the
duplication this rebuild keeps removing.

`LandingFlow`'s *Execute* tab came here with it — the third step to leave the
tab bar after *Understand* and *Prioritize* — so `AgentRunFiles` is the
product's own file list, and the withheld `.env.local` row is the reason it is
in this block at all: a path the agent offered and policy refused is the one
fact about a run that no diff can carry.

## A gate a reduced-motion reader never sees open is not a gate

The parting is the scroll's; the **position** is not. Asked for no motion, the
leaves are already where they end up — otherwise the picture says four shut
gates beside a heading that says three of them are not. Covered three times over
for the three ways it fails: the component's own branch after hydration, a rule
in `globals.css` for the window before it (`useReducedMotion` answers `null` on
the server), and the `<noscript>` style for a reader who gets no JavaScript at
all.

## The retraction was measured, not chosen

At 62% of a leaf's own width what was left read as two dashes at the margins
rather than as doors standing open. 44% keeps half of each leaf against its
wall; measured at 1440 the three open gates leave a 296px gap centred on the
path, and the shut one's leaves meet to the pixel.

## A guard that was jumping over the thing it measured

`brings every block to full opacity once it has been scrolled to` walked the
page with `scrollIntoViewIfNeeded` per block. That is an instant jump, and once
the page grew by a module one jump cleared a whole block: the observer is
evaluated at the position it lands on, so a block below the viewport before the
jump and above it afterwards was never once inside one. It reported
`#move`'s closing line as never revealed, which is false for any reader — a
scroll produces a position every frame.

It walks in viewport-sized steps now, which is both the honest simulation and
the stronger test, and it was re-broken against a `Reveal` whose `whileInView`
stops at half opacity to prove it still catches the real defect.

## Five guards, five mutations

Four stages named with what stops the run at each · three gates open and the
fourth shut, measured from leaf geometry · the same open gates under reduced
motion **without scrolling to them** · the refused path named · no merge that
reads as a deployment, and no Deploy, Ship or Publish control anywhere in the
block.

Mutations: the rule-66 sentence turned into the claim it refuses, the last gate
made to open, the reduced-motion mechanism removed (both halves at once — each
alone is a backstop for the other, and only the CSS one covers the pre-hydration
window this test cannot observe), the withheld path deleted, and the
not-deployed sentence dropped. All caught; the second one failed two tests,
because two of them assert the last gate is shut.

Unit 9,475 · browser 782 with 5 new · tsc clean · eslint 0 · build clean
