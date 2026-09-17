# Shell

The product's navigation: one rail for the whole signed-in product, the phone's
tab bar and account sheet, the project switcher, the breadcrumb trail, and the
marketing site's own frame.

Moved out of `src/components/layout/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 7
([Sprint 0229](../../../docs/sprints/0229-the-shell-is-a-surface.md)).

```
app-frame.tsx               one rail for the product, and the foot both states share
project-shell.tsx           PROJECT_SECTIONS and its groups, WorkspaceSection, the project rail
project-nav.tsx             the rows, with the active one derived from the URL
project-switcher.tsx        which product this is, and the others
project-breadcrumb-trail.tsx  where a nested route sits
mobile-tab-bar.tsx          Nova, Threads, and a Workspace sheet, below lg
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

## The navigation

```
[ product switcher ]        ← which product this is, and Project Settings
────────────────────────
Nova                        ← the project index: the ranking, as a conversation
Threads                     ← every conversation this product has had
+ New chat                  ← a button: opening one is a write
────────────────────────
WORKSPACE
Business Health
My Product
Action Plan
Agent
Experiments
────────────────────────
GENERAL
Settings →                  ← unfolds the rail into the account's own
```

**What changed is not where anything is.** Every address is the one it was;
`PROJECT_SECTIONS` is still the address table. What changed is that the five
capabilities stopped being peers of the conversation: a founder used to arrive
at seven equal rows, which asks them to choose before the product has told them
anything. They are the **workspace** now — what Nova talks about — named as a
set, below her, and one step quieter.

Which list a section is in is a `group` on the table (`nova`, `workspace`,
`product`), so it is a fact about the section rather than a filter inside a
component. `src/app/app/@rail/project-rail.tsx` builds the two arrays and
`ProjectRail` renders them; the phone's bar is a second rendering of the same
two, which is what stops them drifting.

**`threads` is a row and never a section.** A conversation is a list of rows
each with their own address, not one screen at one segment — a
`PROJECT_SECTIONS` entry for it would give it a `projectSectionHref` resolving
to the list rather than to any thread. `threadsPath` owns that address (Slice 3:
one URL owner), and this is the one rail row built from a path helper.

**Project Settings is in neither group**, and is drawn in neither list. On the
desktop rail the product switcher offers it — the control that says which
product you are in. On a phone the switcher is itself inside the sheet, so it
joins the sheet's own list: two disclosures deep is unreachable. The asymmetry
predates this slice, which filtered `settings` out of the desktop list by id.

**§E.4 was answered by the owner**, and the answer is the one the ownership
model already implied: the conversation group is **inside the active product**,
because a thread is project-scoped. _Threads_ at the account level would name
something that does not exist, and _New chat_ there would ask which product.

### The phone

Three destinations — **Nova**, **Threads**, and a **Workspace** tab that opens
the sheet — plus the account behind the avatar in the corner. It was four
sections and a _More_, which is the phone's own convention and was right for a
product with seven equal destinations. This one has a conversation and the
things it is about, and _More_ is a place things are put when they did not fit:
a founder had to know the Agent was hiding there.

## What must stay true

- **Nova is the project, not a section of it** ([ADR 0085](../../../docs/decisions/0085-nova-is-the-project-home.md)).
  The row labelled _Nova_ is the project **index** — `segment: ""`, the
  product's own address — which is why the switcher above it and that row lead
  to the same place. What the ADR forecloses is a second Nova: a row called
  _Conversation_ beside her, or a workspace section that answers the question
  she answers.
- **The rail is a layout, not a component the page re-renders**
  ([ADR 0106](../../../docs/decisions/0106-the-rail-is-a-layout-per-area.md)). Moving
  between sections must not remount the `<aside>`; `e2e/rail-fold.spec.ts` is
  the guard.
- **Every address survives** (ADR 0109 §7). A rail row may disappear; an address
  may not. `PROJECT_SECTIONS` stays the address table whatever the navigation
  becomes.
- **The rail fits a laptop.** Nine rows at 780px, with the list not scrolling —
  `e2e/rail-fold.spec.ts` measures it, and it is the constraint that decides
  spacing here rather than taste. A tenth row is a row something else gives up.
