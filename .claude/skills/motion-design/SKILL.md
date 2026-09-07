---
name: Motion Design
description: Vibe's motion system — when animation is purposeful, the three obligations that travel with every animation (reduced motion, hidden-tab pause, reserved geometry), and the line between ambience and false state. Use whenever adding, reviewing or porting any animation, transition, hover effect, loading state or entrance choreography.
---

# Motion Design

Read [ui-design-system](../ui-design-system/SKILL.md) first. `DESIGN.md`
§ *Craft and Motion* is the authority.

Motion here is **encouraged** — it is not a thing to minimise. It is restricted
in exactly one direction: it may never say something the product has not observed.

## The three obligations

Non-negotiable, on every animation, in every source, at every level of polish.

### 1. `prefers-reduced-motion`

Removes transforms, continuous movement and pulsing — and leaves **every piece of
content, state and action present at first paint**. Reduced motion is not a
degraded experience; it is the same information without the movement.

```tsx
const reduced = useReducedMotion(); // motion/react
```

There is a global CSS backstop in `globals.css`, but a component that relies on
it alone will still animate layout in JS. Handle it in the component.

### 2. Continuous motion pauses on a hidden tab

A loop running in a background tab is a battery cost nobody consented to.
`useDocumentVisible` exists for this.

### 3. Geometry is reserved before the first event

Arriving content never moves text somebody is reading.

**A `min-h` the short states clear is a floor, not a reservation.** This has
already cost this repository a 337px page jump on a tab click. Measure the
**tallest** state, reserve to that, and assert it in a browser test that switches
states and compares the box.

## Purposeful only

Ask what the motion **tells** the reader:

- Continuity — this thing came from that thing
- Hierarchy — look here first
- State — something changed, and you can see what
- Responsiveness — the product heard you
- Identity — this is Vibe

If the answer is "it looks nice", cut it. If the answer is "it fills the wait",
cut it — see below.

## Hierarchy of motion

| Tier | Where | Budget |
|---|---|---|
| **Signature** | Landing page, Business Brain, Product Scan, Agent, Nova | Entrance choreography, settling ≈1.5s; after that at most two moving elements, only while genuinely working |
| **Functional** | Panels, tabs, drawers, disclosure, toasts | 120–240ms, `--ease-vibe`, transform + opacity |
| **Microinteraction** | Hover, focus, press | Under 120ms. `transition-interactive` |
| **Quiet** | Tables, forms, settings, index pages | No choreography. The Functional and Microinteraction budgets still apply. This is most of the product |

Ordinary surfaces stay quiet so signature surfaces have contrast to spend.
Never copy Business Brain's choreography onto an ordinary card.

**Quiet governs choreography, not craft.** This row read *"state changes are
immediate"* until it was found to be stricter than the document it implements.
`DESIGN.md` says the rule "governs choreography — orbits, auras, staged
entrances, ambient movement — and it says nothing about craft", and names *an
entrance* and *hover states with weight* among the things an ordinary dashboard,
profile or billing page may have. What a quiet surface may not do is borrow a
signature surface's language and spend contrast the product has been saving.

So a settings screen that snaps between states with no transition is not
satisfying this tier. It is the "merely inoffensive" screen `DESIGN.md` says has
failed the document rather than passed it.

## Ambience vs. false state — the line

Decorative "thinking" motion is admissible **around** a state Vibe genuinely
observed. It is never admissible as the thing that tells a founder work is
happening. Three properties, in the code and not in a comment:

- **Bound to an observed state.** Unreachable on pending, paused, failed or
  skipped. A shimmer over a paused run is the animated form of a lie.
- **Removable without loss.** Every word it decorates stays legible with the
  motion gone. If turning it off changes what the founder knows, it was carrying
  information.
- **Carrying no timing.** Fixed period, unrelated to elapsed or remaining time.
  A treatment that accelerates with apparent progress is an unmeasured percentage.

### Never animate

- A fabricated progress value or percentage
- A partially-filled connector on a completion rail — a percentage in disguise
- Success before success exists
- Deployment when only a merge is known
- Activity while a process is in fact waiting
- Model reasoning, streamed or otherwise (rule 43)

A failed run is **settled and still**. A core that kept breathing over a failure
would be a status line narrating work nobody is doing.

## Implementation

`motion` v13, imported as `motion/react`. It is a production dependency and owns
entrance, presence, layout, hover and selected-state transitions on signature
surfaces. CSS owns static atmosphere, surfaces and the global reduced-motion
backstop.

Prefer `transform` and `opacity` — they composite. Avoid animating `width`,
`height`, `top`, `left` or `box-shadow`; use `layout` or a reserved box instead.
No overshoot easing on anything that carries information.

## Sourcing motion

[motion-primitives](../motion-primitives/SKILL.md) for primitives,
[magic-ui](../magic-ui/SKILL.md) for effects,
[aceternity-ui](../aceternity-ui/SKILL.md) for signature moments only.

Every one arrives without the three obligations. **You add them.** Motion must
stay recognisably Vibe rather than becoming a collection of unrelated effects.

## Validate

Reduced motion on; hidden tab; 390px; and a browser test that measures reserved
geometry across a state change.
