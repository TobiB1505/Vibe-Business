---
name: Jolly UI
description: React Aria-based accessible components in shadcn's shape. Its registry is currently offline (HTTP 402), so this skill records the live alternatives — shadcn's own React Aria support — and what to check before re-enabling it. Use when a component needs accessibility behaviour beyond what a hand-written primitive gives.
---

# Jolly UI

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

## Its registry is offline

Every `jollyui.dev` path returned **HTTP 402 `DEPLOYMENT_DISABLED`** at
verification (2026-09-05) — the site's own deployment, not a rate limit and not a
credential problem.

**No `@jolly` namespace is configured in `components.json`**, deliberately: a
registry entry pointing at a dead host produces a broken install command rather
than a missing feature, and a confusing failure is worse than an honest absence.

Re-check before assuming this is permanent:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://jollyui.dev/r/default/button.json
```

A `200` means it is back. Then add `"@jolly"` to `registries` in
`components.json` with the URL that actually responded, verify with
`pnpm dlx shadcn@latest search @jolly --limit 3`, and update this file and
[registries.md](../component-sourcing/registries.md).

## What it was for, and where to go instead

Jolly UI translated shadcn components to **react-aria-components** — Adobe's
accessibility primitives, which handle keyboard, focus, touch and screen-reader
behaviour more thoroughly than a hand-written implementation, especially for
comboboxes, date pickers, sliders, drag-and-drop and complex listboxes.

While it is down, in order:

1. **shadcn's own React Aria support.** shadcn added it in July 2026 — the same
   behaviour from a live, first-party registry. See
   [shadcn-ui](../shadcn-ui/SKILL.md).
2. **`@react-aria`** — Adobe publishes its own registry
   (`https://react-aria.adobe.com/registry/{name}.json`, healthy in the official
   index). Not configured here; add it if a real need appears, with the same
   verification.
3. **Read the WAI-ARIA pattern and own it**, which is what
   `src/components/ui/tabs.tsx` does.

## Before adopting React Aria at all

`react-aria-components` is a substantial runtime dependency, and Vibe currently
has none of this kind. It is a decision to state and report first: the concrete
problem, why the hand-written version is weaker, the bundle cost, and long-term
ownership. A date picker or combobox is a strong argument. A button is not.

## Do not

- Configure a `@jolly` registry while the host returns 402.
- Cite a Jolly component you have not been able to fetch.
- Add React Aria for a component Vibe already handles correctly.
