# Shell

The product's navigation: one rail for the whole signed-in product, the phone's
tab bar and account sheet, the project switcher, the breadcrumb trail, and the
marketing site's own frame.

Moved out of `src/components/layout/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 7
([Sprint 0229](../../../docs/sprints/0229-the-shell-is-a-surface.md)).

```
app-frame.tsx               one rail for the product, and the foot both states share
project-shell.tsx           PROJECT_SECTIONS, WorkspaceSection, and the project rail
project-nav.tsx             the rows, with the active one derived from the URL
project-switcher.tsx        which product this is, and the others
project-breadcrumb-trail.tsx  where a nested route sits
mobile-tab-bar.tsx          four tabs and a More sheet, below lg
account-shell.tsx  account-nav.tsx  account-card.tsx  mobile-account.tsx
app-shell.tsx               the signed-in frame
marketing-shell.tsx  marketing-header.tsx
record-visit.tsx            the last-visited cookie
palette-switch.tsx          the local palette tool, behind its own gate
```

## Why this is a feature and not a component

A component **renders a shape** (rule 86). Every file here does the opposite:
`project-shell.tsx` is the address table for the whole workspace,
`app-frame.tsx` composes the account card and the balance, `mobile-tab-bar.tsx`
knows which sections exist. Naming a route is the definition of the line, and
these files are made of route names.

`src/components/layout/` keeps what is genuinely shape: `atmosphere.tsx`,
`auth-shell.tsx`, `settings-column.tsx`.

**`app-frame.tsx` was classified as a primitive and was not**, which the
boundary test said the moment the files it composes moved. It imports
`AccountCard` and `MobileAccount` — a frame that composes the account surface is
the signed-in product's shell, whatever its filename suggests. The restructure
audit's §C.2 is corrected in the open rather than argued with.

## What has not moved, and what it is waiting for

**The navigation itself.** ADR 0109 §1 says the app level becomes
**Products · New chat · Threads · Settings**, and the phone's tabs become
**Nova · Workspace · Threads · Account**. Neither shipped, and the reason is a
decision rather than effort: a thread is **project-scoped** (the audit's §C.9
and §E.4), so _Threads_ and _New chat_ at the **account** level name something
that does not exist — a new chat about which product? The audit leaves account
level threads open as §E.4, and the phone's fourth tab open as §E.5, where
[ADR 0108](../../../docs/decisions/0108-a-phone-is-not-a-narrow-desktop.md)'s
four-tab ceiling forces one of Threads and Account out.

Building either without those answers would be inventing a product requirement,
which is the one thing this restructure is under instruction not to do (rule 14).

**And the workspace pane with it.** ADR 0109 §4's pane waits on the rail
shrinking, which waits on the navigation. The measurement is in the audit's
2026-09-17 correction: at 1280 the project rail takes 256px and Nova's work
column 300 more, leaving the thread about 640.

## What must stay true when it does move

- **Nova is not a rail item; she is the project** ([ADR 0085](../../../docs/decisions/0085-nova-is-the-project-home.md)).
  The project index is her, and a row called _Nova_ beside a row called
  _Conversation_ would be two Novas.
- **The rail is a layout, not a component the page re-renders**
  ([ADR 0106](../../../docs/decisions/0106-the-rail-is-a-layout-per-area.md)). Moving
  between sections must not remount the `<aside>`; `e2e/rail-fold.spec.ts` is
  the guard.
- **Every address survives** (ADR 0109 §7). A rail row may disappear; an address
  may not. `PROJECT_SECTIONS` stays the address table whatever the navigation
  becomes.
