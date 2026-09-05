---
name: UI Audit
description: Audit an existing route or page across information architecture, hierarchy, layout, typography, consistency, interaction, responsive behaviour, accessibility, motion, and empty/loading/error states — classifying each finding by the kind of solution it needs. Read-only: produces findings, never edits code unless separately instructed. Use when asked to review, audit, critique or assess a screen before changing it.
---

# UI Audit

Read [ui-design-system](../ui-design-system/SKILL.md) first.

**This skill does not modify code.** It produces findings. Implementation is a
separate, explicitly instructed step — auditing and fixing in one pass is how a
finding gets quietly softened into whatever was easy to change.

## Procedure

1. **Read the route.** `src/app/…` — page, layout, `loading.tsx`, `error.tsx`,
   and the components it composes.
2. **Read the domain.** What state can this screen actually be in? Which are
   unreachable? Which are unhandled?
3. **Look at it.** Open it in the Browser pane at 1440px and 390px. A read of
   the source is not an audit of the screen — `DESIGN.md` names "three greens and
   an untested screen" as the failure mode this project keeps paying for.
4. **Check the states.** Loading, empty, error, partial, and the long-content
   case. Most defects live here.
5. **Check with a keyboard.** Tab through it. Focus visible? Order sensible?
6. **Check reduced motion and a hidden tab.**
7. **Write findings.**

## Dimensions

- **Information architecture** — is the most important thing first? Is anything
  here that belongs elsewhere?
- **Hierarchy** — can a reader rank what is on screen without reading it all?
- **Layout and spacing** — alignment, rhythm, density, grouping. Arbitrary values
  where a token fits.
- **Typography** — scale steps used as a scale; line length ≤ ~70ch for prose.
- **Component consistency** — is a shared surface, button, pill or icon
  duplicated in a screen-local system? (Explicitly banned.)
- **Interaction** — affordances, feedback, destructive-action confirmation, cost
  disclosure before a paid action.
- **Responsive** — overflow at 390px; identity surviving breakpoints.
- **Accessibility** — roles, names, focus, contrast against `--color-surface-4`,
  and whether a disabled control says why.
- **Motion** — the three obligations; and any motion asserting unobserved state.
- **Empty / loading / error / partial** — designed, or absent?
- **Missing UI** — a state the domain produces that the screen cannot show.
- **Excessive UI** — tiles that dilute rather than inform. Removing is a finding.
- **Reuse opportunities** — this is the fourth hand-rolled version of a thing.
- **Truthfulness** — any number, label or animation the product cannot stand
  behind. This outranks every other finding.

## Classify every finding

State the solution *kind*, because it decides who does the work:

| Class | Meaning |
|---|---|
| `existing-vibe-component` | Something in `src/components/` already does this |
| `new-vibe-semantic-component` | Product meaning with no home yet |
| `shadcn-primitive` | Interaction/accessibility scaffolding |
| `third-party-sourced` | A registry pattern, to be ported (name the source) |
| `layout-css-only` | No new component |
| `motion-enhancement` | Motion would carry meaning here |
| `content-copy` | The words are the defect |
| `remove` | This should not exist |

## Report format

Per finding: **what** is wrong, **where** (`file.tsx:line`), **why it matters to
the reader**, the **class**, and a **severity** (critical / major / minor).

Order by severity. Say what you checked and found healthy — an audit that only
lists problems cannot be told apart from one that stopped early.

Do not invent a finding to pad the list, and do not report a preference as a
defect. If a decision looks wrong but was deliberate, say that you found the
reasoning and disagree with it — that is a different claim from a bug.
