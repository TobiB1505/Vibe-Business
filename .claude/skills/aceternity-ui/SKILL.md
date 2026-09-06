---
name: Aceternity UI
description: Source high-impact visual components — spotlight, aurora and beam backgrounds, 3D cards, parallax scroll and dramatic hero treatments — from the @aceternity registry. Use only for a signature surface with an explicit design argument, never for ordinary application UI. No authentication required.
---

# Aceternity UI

Read [ui-design-system](../ui-design-system/SKILL.md) and
[motion-design](../motion-design/SKILL.md) first.

Registry `@aceternity` → `https://ui.aceternity.com/registry/{name}.json` —
278 items, verified. Its health in the official shadcn registry index was
**degraded** at verification; expect occasional failures and retry.

## The narrowest remit of any source here

Aceternity is spectacle: 3D card effects, spotlight and aurora backgrounds,
tracing beams, parallax scroll, infinite moving cards, dramatic hero layouts.

`DESIGN.md` refuses no technique by category — 3D, glass, gradients and glow are
all available, and the earlier list banning them is retired. But it asks five
questions of the specific treatment on the specific surface, and an Aceternity
component must pass all five **before** it is used:

1. Does it strengthen **hierarchy** — is something easier to find or rank?
2. Does it reinforce **Vibe's** identity, rather than some other product's?
3. Is the wow moment **about what this screen is for**?
4. Is it **readable and performant** at every width, in reduced motion, on a
   hidden tab?
5. Does it fit **this product state**?

Grounds for refusal are: generic, decorative, visually noisy, disconnected from
Vibe. "It is a gradient" is not a ground. Neither is "it looks like marketing".

## Where it may be considered

The landing page, and the signature surfaces with an argument already made —
Business Brain, Product Scan, Agent, Nova.

Elsewhere in `/app`, judge rather than refuse. This section used to carry a list
— *never on dashboards, billing, profile, settings, tables, index pages, forms*
— which is a category refusal of the kind `DESIGN.md` retired for itself: "no
visual technique is refused by category… that list is retired as a list, and its
judgement is kept as a test." The list also named the wrong thing. What makes an
aurora wrong behind a settings form is not that the route is `/settings`; it is
that the treatment is decorative there, borrows a signature surface's language,
and spends continuous GPU work on a page somebody opens daily. Those are the
grounds, and they are the five questions above.

Expect the answer to stay no most of the time, for the two reasons `DESIGN.md`
keeps while retiring the list: contrast — a technique stamped across every card
leaves the product nothing to emphasise with — and the cost measured below. An
ordinary surface that wants presence should reach for composition, hierarchy and
depth first. This registry is the last thing to try, never the first.

## Porting

These are the heaviest components in any configured registry. Before taking one:

- **Measure the cost.** Several run continuous canvas or WebGL work. A
  `<Spotlight>` that repaints on every mouse move on a page a founder returns to
  daily is a battery cost with no information in it.
- **The three obligations arrive missing**, and here they are load-bearing:
  reduced motion must remove the effect entirely while leaving the content, and a
  hidden tab must stop the loop.
- Decorative layers get `aria-hidden` and must not intercept pointer events.
- Palettes are vivid multi-hue by default. Vibe has **one** accent. A gradient
  through purple and blue is not Vibe with different colours — it is a different
  product's identity, which is question 2.

Then [adaptation.md](../component-sourcing/adaptation.md).

## Do not

- Use one because it looked good in the preview. Answer the five questions.
- Use more than one per surface.
- Introduce a second accent hue.
- Ship one without checking reduced motion and a hidden tab.
