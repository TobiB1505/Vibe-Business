# Features

The product surface: what a founder does, as screens and use cases, one
directory per feature. Decided by [ADR 0109](../../docs/decisions/0109-nova-first-application-shell.md);
the layering is CLAUDE.md rule 86 and is held by
`src/lib/consistency/feature-boundaries.test.ts`.

```
src/app         routing and composition — an access gate plus a composition, never product logic
src/features    this directory — screens, commands.ts ("use server"), queries.ts (composed reads), artifact views
src/modules     the domain — stores, services, view builders, operations, providers
src/components  presentation primitives with no product knowledge
src/lib         cross-cutting
```

Imports flow `app → features → modules`. A feature reads and writes the domain
only through `src/modules`; it never imports a route file. **Nothing below the
feature layer may import a feature**, and that one can never be registered at
all — it is not a debt to retire, it is the layering inverted.

Which makes the question _what a component is_, and the answer is the line this
directory exists to hold: a component **renders a shape**. It may take a
module's types and label tables; it may never compose a product surface, bind a
Server Action or know a route. A file that does is a feature wearing a
component's address, and it moves here rather than earning an exception. Vibe's
semantic components — `StatusPill`, `FindingCard`, `CostDisclosure`,
`ConfidenceIndicator`, `EvidenceDrawer`, `ActionBlock`, `SourceCoverage`,
`NovaPresence` — stay where they are: each renders one module's view type and
composes no screen.

There are no crossings left. `TRANSITIONAL_CROSSINGS` in
`src/lib/consistency/feature-boundaries.test.ts` ships as `[]`: nothing under
`src/features`, `src/modules`, `src/components` or `src/lib` imports from a layer
above it, anywhere. The register stays because an entry is how a _future_ debt
gets written down with the slice that retires it — that list shrinks and never
grows.

A feature is cut by **what a founder does**, a module by **what is true**. One
feature reads several modules; one module serves several features. That is why
`nova/` reads eleven modules and owns none of them, and why `features → features`
is ordinary rather than suspect — the thread's blocks mount the Agent's and the
Plan's views.

## What is here

```
nova/              the project index's thread, its blocks, its bindings, and her voice on two pages
workspace/         where an artifact is read in full — a registry and a frame, and no views of its own
agent/             the five stages, the gate panels, the diff, and eleven commands
plan/              the Action Plan, the Moves, and the handoff
health/            the diagnosis: nine lenses, the score, the evidence
product/           the product profile, the Deep Scan and the scan experience
experiments/       what a merged change made measurable
founder-input/     a question Vibe is waiting on, shared by the Agent and the plan
project-settings/  the production URL, the founder's intent, the repository
onboarding/        the setup flow's commands
shell/             the product's navigation: the rail, the tabs, the switcher, the frames
connect/  account/       the commands those surfaces own
marketing/         the landing page and the legal pages
```

Every one of them carries a `README.md` saying what it holds and what it must
not. `commands/` inside a feature is its `"use server"` modules; `src/app` holds
none, and `feature-boundaries.test.ts` refuses one.

## What arrives, and in which order

The order was forced. `src/components` composed product surfaces — the nine
Nova blocks, two landing components, three whole domain views — so those moved
**first**; moving the Agent into `features/agent/` while a component still
composed it would have forced the one import the boundary forbids.

| Slice | What lands                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------- |
| 1     | `nova/thread/blocks/`, `product/`, `founder-input/`, `marketing/` — `src/components` stops knowing the product |
| 2     | `agent/`, `plan/`, `health/`, `experiments/`, `project-settings/` — the surfaces leave the route tree          |
| 3     | `commands/` per feature; one URL owner in `src/lib/routing/`                                                   |
| 4     | `workspace/` — the artifact registry and its frame, and no views of its own                                    |
| 5     | `nova/threads/`, `nova/thread/` — persistent threads                                                           |
| 6     | `nova/conversation/` — the conversation lane and the action resolver                                           |
| 7     | `shell/` — the shell leaves `src/components`; the navigation waits on §E.4 and §E.5                            |

Until a surface has moved, it stays where it is and the route renders it. A
half-moved surface is a parallel architecture, which is the one thing this
directory must not become.

`src/components` is primitives only from Slice 7. What is left under
`components/layout/` — `atmosphere.tsx`, `auth-shell.tsx`, `settings-column.tsx`
— renders a shape and names no route.

The plan and its reasoning: [the restructure audit](../../docs/audits/2026-09-16-nova-first-restructure/README.md)
and [ADR 0109](../../docs/decisions/0109-nova-first-application-shell.md).

## Where a feature keeps its commands

`features/<x>/commands/` holds the `"use server"` modules that feature owns.
`src/lib/consistency/feature-boundaries.test.ts` refuses a Server Action
anywhere under `src/app`, with two named exemptions — the internal operator
console and the e2e fixture's own action — so the routing layer stays a gate
and a composition.

There is no `commands.ts` barrel. A barrel that re-exports server actions is an
extra hop that pulls a whole feature's server graph into any build that touches
one of them; the directory is the door.
