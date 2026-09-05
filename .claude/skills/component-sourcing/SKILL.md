---
name: Component Sourcing
description: How to find, compare, choose and port a UI component in this repository — search existing Vibe components first, then shadcn primitives, then external registries; prefer reuse over duplication; adapt everything to Vibe tokens and semantics. Use whenever UI is needed and it is not obvious which component should provide it, before installing anything from a registry, and before writing a new component from scratch.
---

# Component Sourcing

Read [ui-design-system](../ui-design-system/SKILL.md) first — it governs.

**The rule: search → inspect → choose → adapt → install.** Never
"generate another component from scratch immediately", and never install a
catalogue component whole.

## The workflow

### 1. State the UI problem

In product terms, not component terms. "The founder must choose one of three
repositories and see why two are ineligible" — not "I need a Select".

### 2. Search the Vibe inventory first

This step is skipped most often and costs the most when it is.

```bash
ls src/components/ui src/components/system src/components/nova src/components/layout
rg -l "StatusPill|FindingCard|ActionBlock" src/
```

`src/components/ui/` is hand-written primitives; `src/components/system/` is the
semantic product layer. If something close exists, **extend or recompose it**.
Duplicating a shared surface, button, status pill or icon is explicitly banned by
`DESIGN.md`.

### 3. Search shadcn primitives

For interaction and accessibility scaffolding. See [shadcn-ui](../shadcn-ui/SKILL.md)
— including why a Radix dependency is a decision, not a default.

### 4. Search external registries

Per-source guidance and MCP availability: [registries.md](registries.md).

Search **broadly** — `DESIGN.md` is explicit that judging a catalogue from two
previews is not a search. Look at the actual implementations, not only names.

### 5. Compare candidates and classify each

Use `DESIGN.md`'s vocabulary explicitly:

**REUSE** · **ADAPT** · **HEAVILY ADAPT** · **INSPIRE** · **REJECT**

Say what you rejected and why, not only what you took. Do not default to keeping
Vibe's existing presentation when an external pattern is materially better — and
do not default to the catalogue either.

### 6. Adapt to Vibe

Non-negotiable, every time. The checklist: [adaptation.md](adaptation.md).

### 7. Install only what is chosen

Third-party source lands in `src/components/vendor/` — gitignored, never imported
by the application. It is a **reading room**: you read the implementation there
and port by hand into `src/components/`.

```bash
pnpm dlx shadcn@latest add @magicui/<item>   # → src/components/vendor/
```

`components.json` aliases point every CLI-writable path at `vendor/`, so an
install command **cannot** reach `src/components/ui/`. That is deliberate
(ADR 0095) — it is what makes running one safe.

A runtime dependency is a separate decision: state the problem, whether Vibe
already solves it, bundle and runtime cost, and long-term ownership. Report it
before adding it.

### 8. Validate

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Then verify in the browser: 390px width, keyboard path, focus visibility,
reduced motion, and every state (loading, empty, error, partial).

## Sourcing hierarchy

**Application structure and accessibility**
1. Existing Vibe components
2. shadcn/ui
3. ReUI
4. Origin UI → now **COSS** (`@coss`)
5. Jolly UI, where React Aria gives a real advantage — see its skill first, the
   registry is currently down

**Modern SaaS / application components**
21st.dev · ReUI · COSS · Kokonut UI · Cult UI

**Motion and microinteraction**
Motion Primitives · Magic UI

**Signature moments — selectively**
Aceternity UI · Magic UI · Cult UI · 21st.dev

Signature effects are exceptional moments, never the default interface language.
Spending one on every card leaves no emphasis to spend.
