---
name: shadcn/ui
description: Use the shadcn MCP and registry as interaction and accessibility reference for Dialog, Sheet, DropdownMenu, Select, Popover, Tabs, Tooltip, Command, Table, Forms and navigation — porting behaviour by hand rather than installing into Vibe's own primitives. Use when a screen needs a complex interaction primitive, keyboard/focus behaviour, or ARIA structure.
---

# shadcn/ui

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

## Vibe is not a shadcn project

Every primitive in `src/components/ui/` is hand-written on Tailwind v4. The
dependency set carries **no Radix package, no icon library, no `clsx`, no
`cva`, no `tailwind-merge`**. `cn` is a filtered join.

A `components.json` exists (ADR 0095) and its purpose is **discovery**: it lets
the shadcn MCP and CLI resolve namespaced registries. Its aliases point at
`src/components/vendor/`, which is gitignored and imported by nothing. An install
command therefore cannot reach `src/components/ui/` — which is what makes running
one safe, and what `DESIGN.md`'s "don't let a registry install command scaffold a
second `ui/` convention" was protecting.

**Never run `shadcn init`.** It would rewrite `components.json` and the aliases
that contain this.

## Use it for

Behaviour, not appearance: keyboard interaction, focus management and trapping,
roles and ARIA state, portal and dismissal semantics, form validation structure,
composition APIs.

Dialog · Sheet · DropdownMenu · Select · Popover · Tabs · Tooltip · Command ·
Table · Form · navigation primitives.

## How

```bash
pnpm dlx shadcn@latest view @shadcn/dialog     # read the implementation
pnpm dlx shadcn@latest docs dialog             # API and usage
```

Or the `shadcn` MCP (`search_items_in_registries`, `view_items_in_registries`,
`get_item_examples_from_registries`) — same registries, no install.

Then **port the behaviour by hand** into `src/components/ui/`, in Vibe tokens.
`src/components/ui/tabs.tsx` is the worked example: the WAI-ARIA tabs pattern
owned outright, with manual activation, roving tabindex, and a disabled tab that
says why — deliberately not a Radix wrapper.

## Introducing a Radix dependency

Not forbidden — but it is a decision, not a default. Before it: state the concrete
problem, why the hand-written version is weaker, exactly which packages it brings,
and how it will be visually integrated. Report before adding.

Focus/dismissal correctness in a portalled overlay is the strongest real argument.
"The recipe uses it" is not one.

## Do not

- Run `shadcn init`, or change `aliases` in `components.json`.
- Install into `src/components/ui/`.
- Replace a Vibe semantic component with a shadcn equivalent.
- Paste a recipe with its `cva` variants intact — it will not compile, and the
  `className`-override API it implies does not work under this `cn`.
- Let the product start looking like default shadcn. That is the actual risk.
