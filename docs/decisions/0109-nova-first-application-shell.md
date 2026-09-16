# 0109 - Nova-first application shell

Status: Accepted
Date: 2026-09-16

Amends the navigation half of [ADR 0045](0045-command-center-information-architecture.md) and completes what [ADR 0085](0085-nova-is-the-project-home.md) started. Reopens, under conditions, two items the [Nova architecture audit](../audits/2026-09-03-nova-architecture-audit/README.md) §M closed — *an unrestricted chat input* and *a transcript as source of truth* — in the shape [ADR 0086](0086-nova-presentation-is-claimed-stored-and-attempted-once.md) used for a third. Changes no domain module, no provider, no background technology, no approval or merge semantics, and no audit principle. The evidence is [the restructure audit](../audits/2026-09-16-nova-first-restructure/README.md); the first slice is [Sprint 0222](../sprints/0222-nova-leaves-the-route-layer.md).

## Context

### The dashboard is the product's shape, and the product has outgrown it

The signed-in product is seven equal rail rows — Nova, Business Health, My Product, Action Plan, Agent, Experiments, Project Settings — and a screen behind each. ADR 0045 chose that shape when the product's job was to *show* a founder their diagnosis, their moves and their changes. ADR 0085 then put Nova first because a founder returning to a project asks *what do I do now*, not *how is my business doing*, and wrote the sentence this decision acts on: *every non-Nova section becomes a drill-down from something Nova said*. It kept the seven rows.

Three sprints since ([0162](../sprints/0162-the-screen-nobody-had-looked-at.md), [0163](../sprints/0163-the-room-she-assembles.md), [0214](../sprints/0214-the-screen-no-founder-could-reach.md)) turned Home and setup into a conversation and composed all five Agent stages into it. The thread is now where the offer to spend Credits is made, where the approval that authorizes a branch write is given, and where the record of every change is read. It is the primary surface in everything but navigation. A founder still opens a project to a menu of seven doors and a thread that is one of them.

The founder's framing, which this decision adopts: the product should feel like *an AI business operator with a visual workspace*, not *a dashboard with an AI assistant*. The question a founder asks changes from *which page do I open* to *what do I want Nova to know or do*.

### What already exists, measured

The audit's arithmetic still holds and has improved. `src/modules/nova/` is a pure ranking over canonical rows (`deriveNovaFocus`), a closed catalogue of eighteen priced, bound controls, two sentence tables, a block registry total over every moment and operation type, a briefing, and a measured voice tier claimed once per identity. `src/components/nova/` holds every visual primitive of a chat — bubble, thread, header, presence, typing beat, event row, render block, room, control — except the composer. The domain layer beneath is already a query side (`build<Card|View>` beside `get*`) and a command side (Server Actions). Nothing needs a new engine.

### What stands in the way, measured

Three things, none of them domain:

1. **The surfaces live in the route tree and reach into each other.** The Nova, Agent and Plan surfaces are directories under `src/app/app/projects/[projectId]/`. `src/components/nova/blocks/*` imports ten components from `@/app/**/agent/*` and `plan/*` to compose them into the thread; `src/modules/coding-agent` imports two types from the same place; one Server Action imports a layout component to build its redirect. Putting the Agent's view into a workspace pane beside the thread is route-tree surgery, not an import.
2. **The layering is a convention.** `src/modules/nova/actions.ts` and the module README state that every Server Action lives under `src/app/` and nothing under `src/modules/` imports one. `src/modules/auth/actions.ts` and the two type crossings already contradict it, and no test would have said so.
3. **The chat is foreclosed in three places at once.** The Nova audit's §M refuses *an unrestricted chat input* — no system in the product reads free text into a decision, and a chat box is a third, unbounded one — and *a transcript as source of truth*. `nova-ui.test.ts` asserts *no chat input anywhere*; `first-run.ts` tells the founder *there is nothing to type*; `nova-feed.tsx` says *not a chat*. Those reasons are still right. What they refuse is an unbounded input and a transcript that decides. They do not refuse a bounded input that resolves to the catalogue, or a transcript that records.

### Why not a rewrite, and why not Vite

Server-side logic, Route Handlers, webhooks, Supabase SSR auth, Stripe, the Anthropic gateway, GitHub, the Vercel sandbox and Workflows are all integrated through the App Router. Every one of them is a reason ADR 0001 gave for the monolith and none has weakened. The two things the product needs — a feature layer between routes and modules, and a chat that is a record rather than an authority — are additive. A migration project would spend the year on the framework and deliver the same product on a different bundler.

## Decision

### 1. Nova is the primary interaction surface; the workspace shows what she is talking about

Inside a project, the screen is **Nova and the Workspace**: a persistent thread with a composer on one side, and on the other the artifact Nova is speaking about or working on — the business reading, a product understanding, a Move, a plan, a running agent, a prepared change, a preview, a diff, an experiment, a question. The founder talks to Nova; Nova uses the existing systems; the workspace makes the result visible, controllable and trustworthy.

The app-level navigation becomes **Products · New chat · Threads · Settings**. The seven-row project rail stops being the product's mental model. Nothing that has an address loses it (§6).

### 2. Three layers, with one direction

```
src/app        routing and composition — layouts, pages, route handlers, the rail slot; nothing else
src/features   product surfaces and use cases — screens, commands.ts ("use server"), queries.ts (composed reads), artifact views
src/modules    the domain engine — unchanged
src/components presentation primitives with no product knowledge
src/lib        cross-cutting
```

Imports flow downward: `app → features → modules`; `components` and `lib` sit beside `modules` and above nothing. `src/app` may not hold product logic or large UI; a route file is an access gate plus a composition. The rule is enforced by `src/lib/consistency/feature-boundaries.test.ts`, whose allowlist is the debt register: every crossing that exists today is recorded with the slice that retires it, and the test fails both when a new crossing appears and when a recorded one has quietly gone — the shape `REVIEWED_SITES` gave the service-role boundary.

The typed boundary the UI reaches through is a feature's `commands.ts` and `queries.ts`. A component does not call an arbitrary Server Action or a module internal; it calls the feature's named command or renders the feature's composed read. The read models (`build*View`, `build*Card`) and the Server Actions that exist today *are* that boundary's two halves; the decision gives them a door, not a rewrite.

### 3. The domain modules stay the brain

Every module under `src/modules/` — intelligence, understanding, audit, opportunities, plans, execution, the coding agent and its gateway, validation, preview, review, approvals, merge, measurement, credits, billing, operations — is unchanged in code and in authority. Nova orchestrates by calling the same commands the buttons call; the workspace renders the same read models the pages render. `src/modules/nova/` is part of the brain: the chat opens with its ranking, prices with its catalogue, and speaks with its voice.

### 4. Workspace artifacts are a closed registry, not an engine

An artifact is a `{ kind, ref }` resolved by one total record `ArtifactKind → { read, view, href }` over a closed union — checked by the compiler and by a test that every kind has an existing read model, an existing view and an existing address. The first views are the ones already pure over a domain object: `AuditOverview` over `BusinessBrainView`, `UnderstandingPanel`, `MoveCard`, the four Agent stages over `PreparedChangeWorkspaceItem`, `PreviewPanel`, `DiffView`, `ExperimentCard`, `FounderInputCard`. `BLOCK_FOR_MOMENT` keeps deciding which artifact a moment opens. On a desktop the artifact is the pane beside the thread; below `lg` it is the bottom sheet ([ADR 0108](0108-a-phone-is-not-a-narrow-desktop.md)). A section route renders its artifact full-page at its unchanged address.

No universal artifact engine, no generic renderer, no artifact that a model composes.

### 5. The chat is permitted under six conditions, all six together

This amends the Nova audit's §M the way ADR 0086 amended it: not *yes*, but *only like this*.

1. **A message is a record, never an input to a ranking.** `deriveNovaFocus` and every position keep deriving from canonical rows. Deleting every thread changes no screen but the thread list. There is no `nova_state`.
2. **Free text is bounded and closed.** At most 1,200 characters, the founder-input secret guard, never interpolated into a system prompt (rule 42), never given to a model that holds a tool (rule 41). The composer resolves text to a closed intent set — the catalogue's ids, a small set of artifact-open intents, and *cannot* — deterministically first. If a model classifies, it returns one enumeration value from a fenced user message, is metered under a named operation whose price says so (rules 47, 94), and its answer is looked up, never executed.
3. **Every action is the existing binding.** A resolved intent calls the Server Action the button calls, with the same preflight, the same price before the click (rule 60) and the same confirmation for a consequential action. The thread records the outcome Vibe observed, never the model's account of it (rule 77). No message authorizes a branch write: approval and merge stay bound to one commit and one person (rules 67–74).
4. **Nova's replies come from the tables first.** A moment's sentence is `novaCandidateMessage`; the reply to an unresolvable request is a template; a generated sentence goes through the voice path under ADR 0086's five conditions. No per-message unbounded generation.
5. **No second agent loop.** The composer has no tools. The coding agent stays the only agent, in its VM, through the gateway (rules 75–82).
6. **Threads are project- and owner-scoped records.** RLS as `project_founder_resolutions`; `system` messages appended from operation tails through `src/modules/operations/`; a retention class under [ADR 0068](0068-retention-periods.md).

A chat that cannot satisfy all six is still the thing §M refuses.

### 6. Every address survives

Every `PROJECT_SECTIONS` and `PROJECT_SUBSECTIONS` address, `/health` as a rendering alias, the fragments the domain publishes (`#business-audit`, `#planned-work`, `#prepared-change-<id>`, `#product-scan`, `#founder-intent`), the parameters [ADR 0058](0058-move-focus-url-contract.md) owns (`?plan=`, `?change=`, `?from=`), `?opening`, the 307 table in `src/lib/routing/retired-addresses.ts`, the auth and connect routes, the API routes and the middleware matcher, the `revalidatePath` targets and the e2e fixture route all keep resolving to what they resolve to today. A rail row may disappear; an address may not. The restructure audit's §C.7 lists each with the test that guards it, and the URL shape gains one owner in `src/lib/routing/` in place of the three it has.

### 7. The rebuild is incremental, and the first slice is invisible

Eight slices, each independently green, each reverting by deleting its files, in the order the dependency graph forces: the Nova surface leaves the route layer with the boundary test (Slice 0, this sprint); the Agent and Plan surfaces follow, closing every upward import (1); one URL owner and a command/query door per feature (2); the workspace host and the first artifacts (3); persistent threads with system-authored messages (4); the composer and the bounded resolver (5); the app shell (6); legacy removal (7). No slice removes a function, rewrites an engine or lands a schema before the slice that needs it.

## Consequences

**Easier.** A surface can be put anywhere — in the thread, in the pane, full-page — because it is a feature view over a read model rather than a file in a route directory. Adding an artifact is a row in a total record. The layering fails the build instead of a review. A founder opens a project to one question and one answer.

**Harder.** Forty-two test files pin paths under `src/app/app/`, so every move is a test change; that cost is the price of a suite that asserts on source, and it is paid slice by slice rather than at once. Two ADRs now describe Nova's surface — 0085 said she is Home, this says Home is her — and only the dates say which is later. The Nova audit's §M is amended twice (0086 and here), and a reader has to hold both amendments to know what §M still forbids: everything it lists, except under the named conditions.

**Foreclosed.** A Nova with tools or web access. A thread that decides anything. A composer whose text reaches a system prompt or a module internal. A universal artifact engine. A rail item for Nova (ADR 0085 stands: she is the project, not a row in it). A Vite migration, a second front-end, a microservice split, a new state library, a new database, a new background technology. Removing an address to tidy the navigation.

**Not decided here.** The retention class for threads; whether intent classification may be a paid model call and at what price; whether Nova ever answers in generated prose beyond the slot templates; account-level threads; which of Threads or Account takes the phone's fourth tab. Each is named in the audit's §E and is decided by the slice that needs it, with its own record.

## Status of the code

Slice 0 lands with this decision: `src/features/nova/` holds the Nova surface, the project index composes it, `src/lib/consistency/feature-boundaries.test.ts` holds the layering, and CLAUDE.md rule 86 names it. The rail, every screen and every address are unchanged at HEAD. Slices 1–7 are recorded in the audit and are not yet built.
