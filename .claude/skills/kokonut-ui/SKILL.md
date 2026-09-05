---
name: Kokonut UI
description: Source modern SaaS and AI-interface components — AI prompt inputs, animated cards, drawers, command buttons and hero blocks — from the @kokonutui registry. Use for polished application-level composition, particularly AI-facing surfaces. No authentication required.
---

# Kokonut UI

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

Registry `@kokonutui` → `https://kokonutui.com/r/{name}.json` — 51 items,
verified. Small and curated, so read the whole list rather than searching blind:

```bash
pnpm dlx shadcn@latest search @kokonutui --limit 51
```

## Use it for

Modern SaaS composition with more character than a shadcn primitive and less
spectacle than Aceternity: AI prompt inputs, animated and flip cards, smooth
drawers, command buttons, shaped hero blocks, AI text-loading states.

Its **AI-interface** components are the reason it is in the hierarchy. Vibe has
Nova, and the surrounding conversation surfaces — input affordances, streaming
and thinking states, choice presentation — are exactly this catalogue's subject.

## The AI components need care

- **Loading and thinking states.** An `ai-text-loading` that cycles invented
  phrases ("Analysing your data…", "Almost there…") is a status line narrating
  work nobody measured. Bind it to a stage Vibe recorded, or use a state that
  claims nothing. See *ambience vs. false state* in
  [motion-design](../motion-design/SKILL.md).
- **Never render model reasoning** (rule 43). A trace may show what Vibe recorded
  itself doing — files read, files written, stages entered — never a model's
  account of its own thinking.
- **Prompt inputs.** Vibe already has `NovaChoice` and `FounderInputCard`. A
  Kokonut input may improve their presentation; it may not invent choices or
  bypass the founder-input contract.

## Porting

Mostly Motion + Tailwind, so ports are clean. [adaptation.md](../component-sourcing/adaptation.md).
Watch for hard-coded gradients and light-ground assumptions.

## Do not

- Replace `NovaChoice`, `NovaMessage` or `FounderInputCard` wholesale.
- Ship a thinking animation not bound to an observed state.
- Adopt a second accent from a component's gradient.
