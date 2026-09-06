---
name: Vibe UI Design System
description: The governing rule for any UI work in this repository — what Vibe owns, what external registries may supply, and the token vocabulary to build in. Use before designing, building, porting or reviewing any interface, and before invoking any source-specific UI skill (shadcn-ui, 21st-ui, reui, magic-ui, aceternity-ui, kokonut-ui, cult-ui, motion-primitives, origin-ui, jolly-ui).
---

# Vibe UI Design System

This skill governs. Every source-specific skill in `.claude/skills/` is subordinate
to it, and where one appears to license something this forbids, this wins.

`DESIGN.md` at the repository root is the authority; this skill is the operating
procedure for working inside it. **Read `DESIGN.md` before significant UI work** —
it carries the surface-by-surface argument that cannot be compressed to a rule.

## Which rules you may rewrite

**Design rules are revisable in place** — composition, register, material, motion
character, restraint, which technique suits which surface. Better argument, better
rule; rewrite it and say why. No ADR.

**Truth rules are not.** No fabricated metric or progress, no motion asserting an
unobserved state, `null` is not zero, no label that misdescribes its control, no
affordance that looks available and is not. Those are invariants.

[ADR 0097](../../../docs/decisions/0097-design-rules-are-revisable-truth-rules-are-not.md)
records why the distinction is written down: three aesthetic rules in these skills
had gone stale because they read as invariants and nobody argued with them.

## The one sentence

Vibe owns its semantic product UI; external sources supply primitives, patterns
and motion that **adapt to Vibe** — never the other way around.

## What Vibe owns and no registry replaces

These carry product meaning. A generic equivalent does not exist, because the
meaning is the component:

| Component | Path | What it encodes |
|---|---|---|
| `StatusPill` | `src/components/ui/status-pill.tsx` | The status vocabulary, enforced by `status-vocabulary.ts` |
| `FindingCard` | `src/components/system/finding-card.tsx` | A finding, its severity, its confidence and its citations |
| `CostDisclosure` / `CostLine` | `src/components/system/` | What an action costs, resolved from the rate card in force |
| `ConfidenceIndicator` | `src/components/system/confidence.tsx` | Coverage vs. judgment confidence — two different claims |
| `EvidenceDrawer` | `src/components/system/evidence-drawer.tsx` | Evidence a reader can open and check |
| `ActionBlock` | `src/components/system/action-block.tsx` | A priced, gated, consequential action |
| `SourceCoverage*` | `src/components/system/source-coverage.tsx` | What Vibe read, and how far it got |
| `OperationProgress` | `src/components/system/operation-progress.tsx` | Observed stages — never a fraction |
| `NovaPresence` | `src/components/nova/nova-presence.tsx` | Nova's identity and her four states |

**Never swap one of these for a catalogue component.** You may redesign its
presentation (see *Reuse logic, not necessarily presentation* in `DESIGN.md`), but
the semantics, the props and the states stay.

## What external sources are for

- **Interaction and accessibility primitives** — Dialog, Sheet, DropdownMenu,
  Select, Popover, Tabs, Tooltip, Command, Table, Forms, navigation.
- **Patterns, layout and composition ideas.**
- **Motion** — see [motion-design](../motion-design/SKILL.md).
- **Signature moments**, sparingly.

Sourcing order and per-source guidance: [component-sourcing](../component-sourcing/SKILL.md).

## Build in tokens, not in numbers

Full vocabulary: [tokens.md](tokens.md). The rule is that an arbitrary Tailwind
value (`text-[#00e5a0]`, `rounded-[16px]`, `bg-white/5`) is a defect when a token
fits. Pasted catalogue code is full of them — converting them is the port.

Two repository-specific traps that fail **silently**:

1. **`cn` does no conflict resolution.** `src/lib/utils/cn.ts` is a filtered join,
   not `tailwind-merge`. A pasted component's `className` prop will *not* override
   its base classes. If a component's API depends on that, it must be restructured.
2. **There is no `clsx`, no `cva`, no `tailwind-merge`, no icon package.** Pasted
   code importing them does not compile. Icons are hand-authored — see
   `src/components/ui/dashboard-icons.tsx`.

## Non-negotiable, whatever the source

- **Accessibility.** Keyboard reachable, visible focus, correct roles and names,
  4.5:1 on text. `design-tokens.test.ts` measures contrast against
  `--color-surface-4`, not the page.
- **Responsive.** No horizontal overflow at 390px. Wide content scrolls in its
  own container.
- **Reduced motion, hidden-tab pause, reserved geometry.** All three, always.
  See [motion-design](../motion-design/SKILL.md).
- **Truthfulness.** No invented metric, percentage, count, logo or success state.
  Missing evidence is `null` and says so — never zero. This holds on the landing
  page exactly as inside `/app`.
- **Server/client.** Components are server by default. `"use client"` only where
  state, effects or event handlers require it, and push it to the leaf — a
  `"use client"` on a page pulls its whole tree client-side.
- **Every state is part of the component.** Loading, empty, error and partial are
  designed, not added later. `src/components/ui/states.tsx` and `skeleton.tsx`
  exist for this.

## Quiet is not plain

Ordinary surfaces stay quiet so signature surfaces have contrast to spend. That
governs *choreography*, never *craft* — `DESIGN.md` is explicit that a dashboard,
profile or billing page which is merely inoffensive has failed it. Do not read
"restraint" as permission to ship something plain.

## Validate

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Plus a browser check for anything visible — see [ui-audit](../ui-audit/SKILL.md)
for what to look at, and use the Browser pane rather than asking the user to check.
