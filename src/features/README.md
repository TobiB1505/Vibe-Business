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
feature layer may import a feature**, and unlike the crossings that are on their
way out, that one can never be registered — it is not a debt, it is the layering
inverted.

Which makes the question _what a component is_, and the answer is the line this
directory exists to hold: a component **renders a shape**. It may take a
module's types and label tables; it may never compose a product surface, bind a
Server Action or know a route. A file that does is a feature wearing a
component's address, and it moves here rather than earning an exception. Vibe's
semantic components — `StatusPill`, `FindingCard`, `CostDisclosure`,
`ConfidenceIndicator`, `EvidenceDrawer`, `ActionBlock`, `SourceCoverage`,
`NovaPresence` — stay where they are: each renders one module's view type and
composes no screen.

The crossings that still exist are written down in
`src/lib/consistency/feature-boundaries.test.ts` with the slice that retires
each. That list shrinks and never grows.

A feature is cut by **what a founder does**, a module by **what is true**. One
feature reads several modules; one module serves several features. That is why
`nova/` reads eleven modules and owns none of them, and why `features → features`
is ordinary rather than suspect — the thread's blocks mount the Agent's and the
Plan's views.

## What is here

```
nova/    the Nova surface — the project index's thread, its bindings, and her voice on two pages
```

## What arrives, and in which order

The order is forced. `src/components` still composes product surfaces — the nine
Nova blocks, two landing components, three whole domain views — so those move
**first**; moving the Agent into `features/agent/` while a component still
composed it would force the one import the boundary forbids.

| Slice | What lands                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------- |
| 1     | `nova/thread/blocks/`, `product/`, `founder-input/`, `marketing/` — `src/components` stops knowing the product |
| 2     | `agent/`, `plan/`, `health/`, `experiments/`, `project-settings/` — the surfaces leave the route tree          |
| 3     | `commands.ts` and `queries.ts` per feature; one URL owner in `src/lib/routing/`                                |
| 4     | `workspace/` — the host and the artifact registry, and no views of its own                                     |
| 5     | `nova/threads/`, `nova/thread/` — persistent threads                                                           |
| 6     | `nova/conversation/`, `nova/actions/` — the conversation lane and the action resolver                          |
| 7     | `shell/` — the project and account navigation                                                                  |

Until a surface has moved, it stays where it is and the route renders it. A
half-moved surface is a parallel architecture, which is the one thing this
directory must not become.

The plan and its reasoning: [the restructure audit](../../docs/audits/2026-09-16-nova-first-restructure/README.md)
and [ADR 0109](../../docs/decisions/0109-nova-first-application-shell.md).
