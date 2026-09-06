# Token vocabulary

Defined in `src/app/globals.css` under Tailwind v4 `@theme`. That file is the
source of truth and carries the reasoning; this is the index. Contrast is
asserted by `src/app/design-tokens.test.ts`.

Use the Tailwind utility (`bg-surface-3`), not the raw variable.

## Ground and surfaces

| Token | Utility | Use |
|---|---|---|
| `--color-ground` | `bg-ground` | The board behind the app frame |
| `--color-app` | `bg-app` | The frame itself |
| `--color-surface-1` | `bg-surface-1` | Chrome: sidebar, rails |
| `--color-surface-2` | `bg-surface-2` | Section, note, footnote |
| `--color-surface-3` | `bg-surface-3` | Panel — the workhorse |
| `--color-surface-4` | `bg-surface-4` | Primary card, modal |
| `--color-surface-hover` | `bg-surface-hover` | Hover on a surface |
| `--color-well` | `bg-well` | A deeper well *inside* a surface (black, not a fifth white layer) |
| `--color-field` | `bg-field` | Input interiors |

Surfaces are white at low alpha over the frame — a hierarchy, not a palette to
pick from. Never stack a card inside a card inside a card; drop to `well`.

## Lines

`line-1` … `line-4` pair with the surface one level up. Also `line-strong`,
`line-track`, and the tinted `mint-line` / `amber-line` / `coral-line`.

## Foreground ramp

`fg` → `fg-body` → `fg-prose` → `fg-secondary` → `fg-muted` → `fg-meta` →
`fg-disabled` → `fg-faint`.

The first six carry text and are held to 4.5:1 **against `--color-surface-4`**.
`fg-disabled` is unavailable-control text; `fg-faint` is never text.

## Accent and status — these mean things

| Token | Meaning |
|---|---|
| `mint` | Vibe: primary action, active state, brand. **Not** generic "good news" |
| `mint-ink` | Text on a mint fill. Never plain black |
| `amber` | Waiting, partial, needs attention |
| `coral` | Failure, gap, destructive risk |

Also `mint-deep`, `mint-dim`, `mint-hover`, `amber-deep`, and the `*-tint`,
`*-tint-soft`, `*-line` variants.

A colour appearing means the domain produced that state. Never decorative.

## Typography

Sizes: `text-hero`, `text-display`, `text-headline`, `text-title`, `text-lead`,
`text-ui`, `text-label`, `text-caption`, `text-meta` — each carrying its own
line-height and letter-spacing. Families: `font-sans`, `font-mono`.

Prefer `src/components/ui/typography.tsx` (`MonoLabel` and friends) over raw
classes where one fits.

## Shape, depth, motion

Radius: `rounded-nav` (10px), `rounded-well` / `rounded-panel` (14px),
`rounded-card` (16px), `rounded-field`. Status pills are `rounded-full`.

Shadow: `shadow-card`, `shadow-panel`, `shadow-mint`, `shadow-dot-mint`,
`shadow-dot-amber`.

Easing: `--ease-vibe`. Also the `transition-interactive` utility.

## Spacing

Deliberately **not** tokenised — Tailwind's own scale is canonical, and the
front-matter of `DESIGN.md` records that omission and why.
