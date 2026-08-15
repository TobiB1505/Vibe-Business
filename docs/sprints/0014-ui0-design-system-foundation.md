# Sprint UI-0 — Design System Foundation

## Goal

Give the existing Vibe Business engine the new Vibe Business surface, starting with the
foundation only: design tokens, the two typefaces, the brand assets, a small set of UI
primitives, and the four application shells — plus exactly one migrated screen to prove
the foundation works against real server-rendered data.

Explicitly **not** a frontend rewrite. Every server action, query, domain module, gate and
security boundary is left exactly as it was.

## Context

The application's UI up to this point was deliberately minimal: `bg-zinc-950`, one button,
one 2xl-wide page shell. That was correct while the engine was being proved out, and it is
now the thing standing between a working product and a usable one.

The new mockups are a complete visual system — one accent, two backgrounds, an eight-step
foreground ramp, four surface levels, two typefaces — and they encode product rules, not
just aesthetics. An unscorable dimension keeps an empty track and says `n/a`. A paid action
shows its price next to its button. A blocked state names the reason before it offers a way
forward. Those are the same rules CLAUDE.md and ADR 0011 already enforce in the domain, and
UI-0 is where they get a shape.

## Scope

**Tokens** — `src/app/globals.css`. Ground and app backgrounds, mint/amber/coral with their
tint and border pairs, the eight-step foreground ramp, four surface levels plus the black
well, five radii, three elevations, the type scale, and one easing curve. Plus a base layer:
a single `:focus-visible` ring, `text-wrap: pretty` on prose, and a `prefers-reduced-motion`
block that is already in place for the motion sprint.

**Fonts** — Space Grotesk and JetBrains Mono via `next/font/google`, self-hosted at build
time and bound to `--font-sans` / `--font-mono`. There is no `font-family` declaration
anywhere else in the codebase.

**Brand** — the eight canonical SVGs in `public/brand/`, the favicon wired through
`src/app/icon.svg`, and `src/components/brand/vibe-mark.tsx` so callers choose a variant
rather than a file path.

**Primitives** — `Button` (4 variants), `Surface`/`VibePanel`/`VibeCard`/`Well`,
`StatusPill`/`CategoryChip`/`StatusDot`, `MonoLabel`/`MonoValue`/`SectionHeader`, `Metric`,
`ScoreMeter`, `EmptyState`/`Notice`, `Field`/`Input`.

**Shells** — `AppShell`, `AuthShell`, `MarketingShell`, and `ProjectShell` +
`ProjectSidebar` + `ProjectHeader`.

**Reference migration** — `/app`, the project list. Chosen because it is the smallest screen
that reads real data through a real query behind real RLS, so a green render proves the
system works against the server and not only against fixtures.

## Non-Goals

- The project workspace route split. `ProjectShell` is built and deliberately unwired; see
  Risks.
- Motion beyond hover/focus transitions. The ambient glow is present as a static shape and
  the meter animation is not implemented at all.
- Any credits UI. There is no customer-facing Vibe Credit ledger (ARCHITECTURE.md §3.11), so
  there is no balance to read and none is displayed.
- Any per-project score, opportunity count or last-audit date in the list. No query returns
  them; see Risks.
- Migrating the project screen, the connect flow, or the prepared-change panels.

## Acceptance Criteria

- Every colour, radius, shadow and font in new code comes from a token.
- The foreground ramp, surface hierarchy and status semantics match the mockups' style sheet.
- No fabricated product data anywhere: no invented balance, score, usage figure or activity.
- The reference migration renders real projects from the real query, and the existing
  auth/GitHub/domain paths are untouched.
- Full keyboard reachability with a visible mint focus ring, and no state signalled by
  colour alone.
- No horizontal page scroll at 375px.

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 133 files, 2600 tests, all passing (7 new, covering the score/`n/a` contract).
- `pnpm build` — production build succeeds; fonts self-host, `/icon.svg` emitted.
- `pnpm test:e2e` — 58 chromium tests passing, unchanged.
- Browser, against a real signed-in session: landing, sign-in, sign-up and the project list
  render on the new system; the sign-in server action round-trips and renders its rejection
  in the new field; the project list shows the two real connected repositories.
- Browser at 375px: no horizontal overflow, sidebar/metric/email columns collapse.
- Focus ring verified computed as `rgb(0, 229, 160)` solid 2px, offset 2px, on a keyboard
  focus, with the pill radius preserved.

## Risks / Notes

- **`ProjectShell` is unused.** Unused UI can drift from what it will eventually wrap. The
  alternative — splitting a 569-line route that assembles ~20 services in the same change as
  the design system — was judged worse, because a regression would then be impossible to
  attribute to styling or to routing. `PROJECT_SECTIONS` records the section-to-component
  mapping so UI-1 starts from a decision rather than a re-derivation. A section with no
  `href` renders as text, so the component cannot produce a dead link.
- **The unmigrated screens are visually mixed.** The project screen and the connect flow
  still use the `zinc` palette inside a token-coloured `PageShell`. That is the expected
  intermediate state of a phased migration, not a defect.
- **The project list is missing three columns from the mockup** (score, next moves, last
  audit). Adding them is a data change — a per-project audit aggregate query — not a styling
  one. Rendering them as placeholders would have implied Vibe looked and found nothing.
- **The project detail page could not be exercised locally**: `.env.local` carries only the
  Supabase pair, so `getGithubEnv()` throws before any component renders. Pre-existing and
  unrelated to this change, but it means UI-1 needs those secrets locally before it can
  touch that screen.
- **Merge is not publish.** The mockups say *Publish* in places. The system performs a
  fast-forward merge to the default branch and calls no deployment provider (ADR 0019,
  CLAUDE.md rule 74), so that vocabulary was not adopted anywhere. Nothing in UI-0 renames
  an existing control.
