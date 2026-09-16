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
only through `src/modules`; it never imports a route file, and nothing below it
imports a feature. The crossings that still exist are written down in the
boundary test with the slice that retires each — that list shrinks and never
grows.

A feature is cut by **what a founder does**, a module by **what is true**. One
feature reads several modules; one module serves several features. That is why
`nova/` reads eleven modules and owns none of them.

## What is here

```
nova/    the Nova surface — the project index's thread, its bindings, and her voice on two pages
```

The rest of the surfaces — the Agent, the Plan, Business Health, the product,
experiments, settings, and the workspace that will host them as artifacts —
arrive in the slices [the restructure audit](../../docs/audits/2026-09-16-nova-first-restructure/README.md)
derives. Until a surface has moved, it stays where it is and the route renders
it; a half-moved surface is a parallel architecture, which is the one thing
this directory must not become.
