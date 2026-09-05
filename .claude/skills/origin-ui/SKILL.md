---
name: Origin UI / COSS
description: Source input, form and application primitives from COSS — the Base UI-based successor to Origin UI, configured as the @coss registry with 577 items. Use for form fields, inputs, selects and dense application primitives when Vibe has no equivalent. No authentication required.
---

# Origin UI → COSS

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

## Origin UI is now COSS

`originui.com` redirects to `https://coss.com/ui`. The library was rebuilt on
**Base UI** rather than Radix, and describes itself as the design system of
Cal.com. Legacy Origin UI still exists but is unmaintained.

Consequences that matter here:

- The registry is `@coss` → `https://coss.com/ui/r/{name}.json` (577 items,
  verified). The old `@originui` URL serves HTML and is **not** configured.
- Components import `@base-ui/*`, not `@radix-ui/*`. Vibe has neither.
- Community lists and older blog posts still say `@originui`. They are stale.

## Use it for

Its historical strength, which survived the rebuild: a very large set of
**input, field and form primitives** — variants of inputs, selects, comboboxes,
date fields, number fields, tags, OTP. Also general application primitives.

Reach for it when Vibe has no equivalent and the problem is a **field**, not a
statement about the business.

```bash
pnpm dlx shadcn@latest search @coss --limit 20
pnpm dlx shadcn@latest view @coss/<item>
```

## Porting

Base UI means a real headless dependency behind the markup. Usually the right
move is to take the **structure and the accessibility behaviour** and rebuild on
`src/components/ui/field.tsx`, not to adopt Base UI.

Adopting Base UI as a dependency is a decision to state and report first — see
[shadcn-ui](../shadcn-ui/SKILL.md) for the argument a dependency has to make.

## Do not

- Configure or cite `@originui` — that URL no longer serves a registry.
- Assume a component is Radix-based.
- Replace `Field`, `Button` or `StatusPill` with a COSS equivalent.
