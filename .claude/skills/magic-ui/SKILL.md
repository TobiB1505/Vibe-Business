---
name: Magic UI
description: Source animated effect components — marquees, shimmer and border beams, number tickers, particles, text animations and reveal effects — from the @magicui registry, for microinteractions and selective signature moments. Use for motion flourish on a surface that has earned one, never as the default interface language. No authentication required.
---

# Magic UI

Read [motion-design](../motion-design/SKILL.md) and
[ui-design-system](../ui-design-system/SKILL.md) first.

Registry `@magicui` → `https://magicui.design/r/{name}` — 250 items, verified.

```bash
pnpm dlx shadcn@latest search @magicui --limit 20
pnpm dlx shadcn@latest view @magicui/<item>
```

## Use it for

Microinteraction and effect: shimmer and border beams, marquees, text animations,
reveal effects, particle and grid backgrounds, animated badges and buttons,
hover-card treatments, orbiting elements.

Built on Motion and Tailwind, so the port is usually mechanical.

## Two components need a specific warning

- **Number ticker.** Animating a count is fine only when the number is one Vibe
  actually recorded. Never a ticker on an estimate, a projection or a
  "customers so far" figure. `DESIGN.md`: no counter that counts nothing.
- **Marquee of logos.** The canonical use is customer logos. Vibe may not show a
  logo that is not a customer. Use it for something true or not at all.

## Budget

Magic UI is where a product accumulates unrelated effects fastest, because every
component looks good in isolation. `DESIGN.md`: spending a signature technique on
every card leaves no emphasis to spend.

Practical bar: **one Magic UI effect per surface**, and only on a surface with a
signature argument. Ordinary panels, tables, forms and settings get none.

## Porting

[adaptation.md](../component-sourcing/adaptation.md), then the three obligations
from [motion-design](../motion-design/SKILL.md) — none of which ships with these
components. A background effect must also be `aria-hidden` and must not trap
pointer events.

Many are light-theme-first: `bg-white`, `from-gray-100`, `dark:` variants. On
Vibe's single dark ground those become surface tokens, and a solid grey reads as
a hole.

## Do not

- Stack effects. Two on one surface reads as a demo.
- Animate an unmeasured number.
- Show a logo, avatar or testimonial that is not real.
- Let an effect block reading, hover or focus.
