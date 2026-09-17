# 0109 - Nova-first application shell

Status: Accepted; **revised in review the same day** — the founder's review found that §2's boundary and §7's first slice contradicted each other, and that §5's conditions specified a command palette rather than an operator. Three things changed: §2 gains the clause that a component holds no product surface (and that an import into a feature can never be registered); §5 is replaced by the two-lane architecture below; §6 is new and makes the canonical/conversational distinction precise. The original §5 read *"Free text is bounded and closed … the composer resolves text to a closed intent set"* and *"Nova's replies come from the tables first"*, and its first condition claimed *"deleting every thread changes no screen except the thread list"*. Nothing in §1, §3, §4 or the address guarantee changed, and no safety property was weakened.
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

1. **The surfaces live in the route tree, and `src/components` composes them.** The Nova, Agent and Plan surfaces are directories under `src/app/app/projects/[projectId]/`. `src/components/nova/blocks/*` imports eleven components out of `@/app/**/agent/*`, `plan/` and `business-brain/` to compose them into the thread; two landing components do the same; `src/modules/coding-agent` borrows two types from the same place; one Server Action imports a layout component to build its redirect; four layout primitives reach into `src/app` for the palette. Putting the Agent's view into a workspace pane beside the thread is route-tree surgery, not an import — and because the composing files sit in `src/components`, moving the surfaces into `src/features` without moving them first would force `components → features`, which is the layering inverted. Eleven files there compose a product surface and three more are whole domain views; they are features wearing a component's address.
2. **The layering is a convention.** `src/modules/nova/actions.ts` and the module README state that every Server Action lives under `src/app/` and nothing under `src/modules/` imports one. `src/modules/auth/actions.ts` and the two type crossings already contradict it, and no test would have said so.
3. **The chat is foreclosed in three places at once.** The Nova audit's §M refuses *an unrestricted chat input* — no system in the product reads free text into a decision, and a chat box is a third, unbounded one — and *a transcript as source of truth*. `nova-ui.test.ts` asserts *no chat input anywhere*; `first-run.ts` tells the founder *there is nothing to type*; `nova-feed.tsx` says *not a chat*. Those reasons are still right. What they refuse is an unbounded input and a transcript that decides. They do not refuse a bounded input that resolves to the catalogue, or a transcript that records.

### Why not a rewrite, and why not Vite

Server-side logic, Route Handlers, webhooks, Supabase SSR auth, Stripe, the Anthropic gateway, GitHub, the Vercel sandbox and Workflows are all integrated through the App Router. Every one of them is a reason ADR 0001 gave for the monolith and none has weakened. The two things the product needs — a feature layer between routes and modules, and a chat that is a record rather than an authority — are additive. A migration project would spend the year on the framework and deliver the same product on a different bundler.

## Decision

### 1. Nova is the primary interaction surface; the workspace shows what she is talking about

Inside a project, the screen is **Nova and the Workspace**: a persistent thread with a composer on one side, and on the other the artifact Nova is speaking about or working on — the business reading, a product understanding, a Move, a plan, a running agent, a prepared change, a preview, a diff, an experiment, a question. The founder talks to Nova; Nova uses the existing systems; the workspace makes the result visible, controllable and trustworthy.

The app-level navigation becomes **Products · New chat · Threads · Settings**. The seven-row project rail stops being the product's mental model. Nothing that has an address loses it (§7).

### 2. Three layers, with one direction

```
src/app        routing and composition — layouts, pages, route handlers, the rail slot; nothing else
src/features   product surfaces and use cases — screens, commands.ts ("use server"), queries.ts (composed reads), artifact views
src/modules    the domain engine — unchanged
src/components presentation primitives with no product knowledge
src/lib        cross-cutting
```

Imports flow downward: `app → features → modules`; `components` and `lib` sit beside `modules` and above nothing. `src/app` may not hold product logic or large UI; a route file is an access gate plus a composition. The rule is enforced by `src/lib/consistency/feature-boundaries.test.ts`, whose allowlist is the debt register: every crossing that exists today is recorded with the slice that retires it, and the test fails both when a new crossing appears and when a recorded one has quietly gone — the shape `REVIEWED_SITES` gave the service-role boundary.

**`components → features` and `modules → features` can never be registered.** The register exists for crossings being retired on a named slice; an import into a feature is not a crossing to retire, it is the layering inverted, and one exception would make the rest of this decision decorative. The test asserts it unconditionally and refuses any register entry that targets `features/`.

Which turns the question into **what a component is**. A component renders a shape; it may take a module's types and label tables, and it may not compose a product surface, bind a Server Action or know a route. By that reading, fourteen files under `src/components` are features wearing a component's address — the nine Nova blocks, the two landing embeds, and the three whole domain views (`FounderInputCard`, `DiffView`, `ProductScanExperience`) — and the landing page's other eighteen files are a surface in their own right. They move out **before** anything moves in beside them, which is why the first slice of §8 is `src/components`, not the Agent. Vibe's semantic components stay exactly where they are: `StatusPill`, `FindingCard`, `CostDisclosure`, `ConfidenceIndicator`, `EvidenceDrawer`, `ActionBlock`, `SourceCoverage` and `NovaPresence` render one module's view type and compose no screen, which is the line.

The typed boundary the UI reaches through is a feature's `commands.ts` and `queries.ts`. A component does not call an arbitrary Server Action or a module internal; it calls the feature's named command or renders the feature's composed read. The read models (`build*View`, `build*Card`) and the Server Actions that exist today *are* that boundary's two halves; the decision gives them a door, not a rewrite.

### 3. The domain modules stay the brain

Every module under `src/modules/` — intelligence, understanding, audit, opportunities, plans, execution, the coding agent and its gateway, validation, preview, review, approvals, merge, measurement, credits, billing, operations — is unchanged in code and in authority. Nova orchestrates by calling the same commands the buttons call; the workspace renders the same read models the pages render. `src/modules/nova/` is part of the brain: the chat opens with its ranking, prices with its catalogue, and speaks with its voice.

### 4. Workspace artifacts are a closed registry, not an engine

An artifact is a `{ kind, ref }` resolved by one total record `ArtifactKind → { read, view, href }` over a closed union — checked by the compiler and by a test that every kind has an existing read model, an existing view and an existing address.

**One view, two frames, and no copies.** The artifact view *is* the owning feature's view, mounted with a frame: eight components already carry a `presentation` prop for exactly this (`"section" | "workspace"` on the five gate panels, `"panel" | "block"` on `NeedsUserPanel`, `"card" | "workspace" | "block"` on `FounderInputCard`, `"page" | "block"` on the Agent's validate stage). So `features/workspace/` holds the host and the registry and not a single view — `AuditOverview` over `BusinessBrainView`, `UnderstandingPanel`, `MoveCard`, the four Agent stages over `PreparedChangeWorkspaceItem`, `PreviewPanel`, `DiffView`, `ExperimentCard` and `FounderInputCard` each stay in the feature that owns them. `BLOCK_FOR_MOMENT` keeps deciding which artifact a moment opens; one more total record maps a `BlockKind` to an `ArtifactKind`. On a desktop the artifact is the pane beside the thread; below `lg` it is the bottom sheet ([ADR 0108](0108-a-phone-is-not-a-narrow-desktop.md)). A section route renders its artifact full-page at its unchanged address.

**Nova explains, the workspace shows.** A reply that would be a wall of text is a short reply and an artifact beside it; the message carries a paragraph bound like the voice slots already do. The workspace is not a second navigation — it shows the object under discussion, and its full-page address is how a founder leaves the conversation for it.

No universal artifact engine, no generic renderer, no artifact that a model composes.

### 5. Nova has two lanes: she may reason freely, and act only through closed capabilities

The closed catalogue answers *what to do*. A founder also asks *why is conversion the blocker*, *how do you read our pricing*, *what changed since last week*, *why Move 1 before Move 2*, *explain the audit more simply*, *what are our two options*, *what would happen if we shipped this*. None of those is an action, none can be pressed into eighteen ids, and a product that refuses them is a command palette with a face on it. The original condition 2 refused them, and that is what this revision reverses.

```
                         NOVA
                          │
              ┌───────────┴───────────┐
              │                       │
       CONVERSATION                ACTION
       reasons, explains           does
              │                       │
   structured generation,        typed intent → one catalogue id
   no tools, a bounded pack      → the existing binding
   Vibe assembles, the model     → the existing authorization
   never chooses what to read    → the existing confirmation and price
   validated before display      → the existing execution path
   deterministic floor beneath   │
              │                  a control the founder presses
              └───────────┬───────────┘
                          │
                    DOMAIN ENGINE  (canonical, unchanged)
```

**The conversation lane may read and explain; it may not act.** It is given canonical project context — identity, product understanding, repository and live intelligence, Deep Scan, the audit, opportunities, plans, execution and change state, experiments, measurements, and the thread's own recent turns — and it returns prose, optionally a pointer at an artifact, optionally a proposal. It writes nothing but its own message.

**The action lane is what ships today, unchanged.** A proposal names a catalogue id and a subject; Vibe renders the control that id already has, carrying the label, the price kind, the consequence flag and the confirmation `NOVA_ACTION_META` already holds. The founder presses it. `audit-is-a-choice.test.ts` already asserts both halves — *a priced operation is always a press* and *no Nova module starts an operation itself* — and the conversation is not an exemption from either.

**One sentence joins the lanes:** generated text is never the last thing before a consequential effect; a press always is. A read-only navigation — open the diff, show the plan — has no consequence and may follow a resolved intent directly.

The conditions, all of them together:

1. **Canonical truth is never conversational.** Audit scores and findings, opportunities, plans, execution state, prepared changes, approvals, validation, merge state, experiments, measurements, credits and pricing, repository and product intelligence: each keeps its own store, identity and write path, and none is ever derived from chat text. `deriveNovaFocus` and every position keep deriving from canonical rows. There is no `nova_state`.
2. **The model gets context, never capability.** No tool, no web access, no URL fetch, no code execution, no database handle, no service-role client, no credential, and no say in what is read: Vibe assembles a bounded pack deterministically and the model receives it. Removing capability, not prompt wording, is what bounds injection (rule 41). The founder's message and every customer-derived excerpt travel as fenced, untrusted-labelled user content, never in a system prompt (rules 25, 36, 42).
3. **Output is a shape, not a free-form answer.** One message string, an optional `{ kind, ref }` from the closed artifact union, an optional id from the closed catalogue. The model may name an artifact and an action; naming is not calling, and Vibe does the lookup.
4. **Nothing reaches a founder unvalidated.** `checkNovaMessage` already refuses a numeral outside the `allowedNumericFacts` list Vibe supplied and refuses `ALWAYS_BANNED_CLAIMS`; an artifact reference that does not resolve to a row the founder owns is dropped; an id absent from `NOVA_ACTION_META` is dropped. A discarded field degrades the reply and never becomes an unverifiable claim on screen (rule 45's shape, applied to a sentence). Under every failure there is a deterministic template, as `service.ts` already proves five ways.
5. **Generation happens in a command, never in a read or a render.** Rendering a thread costs no inference; only a founder-initiated turn does. This is stronger than [ADR 0086](0086-nova-presentation-is-claimed-stored-and-attempted-once.md)'s fifth condition and is what keeps the cost of looking at a screen knowable. Every call is counted before and recorded after (rule 47), and a turn is bounded per thread and per window.
6. **Every action is the existing binding.** Same preflight, same price before the click (rule 60), same confirmation, same execution path. The thread records the outcome Vibe observed, never the model's account of it (rule 77). No message authorizes a branch write: approval and merge stay bound to one commit and one person, and a *merge* intent resolves to the approval artifact rather than to the write (rules 67–74).
7. **No second agent loop.** The composer has no tools and never gets them. The coding agent stays the only agent, in its own VM, behind the gateway (rules 75–82).

**Replies from the tables are a preference, not a boundary.** Where a moment already has a written sentence — the twenty-one in `feed.ts`, the eleven setup states, the two voice slots — that sentence is used, because it is free, tested and consistent. The generative path exists for what those tables cannot answer, and a real question is not forced into a template to avoid a model call.

**What a generated reply may never do** is unchanged and not revisable ([ADR 0098](0098-design-rules-are-revisable-truth-rules-are-not.md)): claim a cause the evidence does not carry, state a figure Vibe did not measure, call anything safe, correct, deployed or live, say something was done when nothing ran, or present a proposal as executed. Where it cannot answer from what it has, it says so — an unassessable question is answered with its absence, the same way an unassessable lens scores `null` (rule 44).

### 6. The transcript is memory; the domain is truth

The original first condition said deleting every thread changes no screen but the thread list. That is right about canonical business state and wrong about the conversation: *"the second one"*, *"that option"*, *"like you just did"* and *"then let's do that"* resolve against what was said, and a Nova who cannot resolve them is a search box with a personality. So the thread's recent turns are part of the context pack, bounded like everything else in it.

> Deleting a thread must not change canonical business state.
> Deleting a thread may remove conversational memory, and therefore what Nova can infer from earlier dialogue.

And the seam between them: **a preference expressed in conversation becomes canonical only by passing through a canonical write that already exists** — a founder input resolution, a product correction, a founder intent, an attestation, an approval. *"I prefer variant B"* is memory. *"Then let's do that"* is a proposal, a control and a press, and what it writes is written by the command that already owns that write.

Threads are project- and owner-scoped, with RLS as `project_founder_resolutions`, `system` messages appended from operation tails through `src/modules/operations/`, and a retention class under [ADR 0068](0068-retention-periods.md). One table for threads and one for messages, with a `kind` discriminator and per-kind CHECK constraints — the idiom `nova_voice_messages` already uses — so a turn is a real turn rather than a list of system events with a chat theme, and no kind gets a table of its own.

### 7. Every address survives

Every `PROJECT_SECTIONS` and `PROJECT_SUBSECTIONS` address, `/health` as a rendering alias, the fragments the domain publishes (`#business-audit`, `#planned-work`, `#prepared-change-<id>`, `#product-scan`, `#founder-intent`), the parameters [ADR 0058](0058-move-focus-url-contract.md) owns (`?plan=`, `?change=`, `?from=`), `?opening`, the 307 table in `src/lib/routing/retired-addresses.ts`, the auth and connect routes, the API routes and the middleware matcher, the `revalidatePath` targets and the e2e fixture route all keep resolving to what they resolve to today. A rail row may disappear; an address may not. The restructure audit's §C.7 lists each with the test that guards it, and the URL shape gains one owner in `src/lib/routing/` in place of the three it has.

### 8. The rebuild is incremental, and the first slice is invisible

Nine slices, each independently green, each reverting by deleting its files, in the order the dependency graph forces: the Nova surface leaves the route layer with the boundary test (Slice 0, shipped); `src/components` stops composing product surfaces (1); the Agent, Plan, Health and product surfaces leave the route tree (2); one URL owner and a command/query door per feature (3); the workspace host and the first artifacts (4); persistent threads with system-authored messages (5); the conversation lane, the composer and the action resolver (6); the app shell (7); legacy removal (8). The first two are in that order because moving a surface into `src/features` while `src/components` still composes it would force the one import §2 forbids. No slice removes a function, rewrites an engine or lands a schema before the slice that needs it.

## Consequences

**Easier.** A surface can be put anywhere — in the thread, in the pane, full-page — because it is a feature view over a read model rather than a file in a route directory, and because the `presentation` prop the repository already uses means one view rather than two. Adding an artifact is a row in a total record. The layering fails the build instead of a review. A founder asks a question in their own words and gets an answer, or a control, rather than choosing a door.

**Harder.** Forty-two test files pin paths under `src/app/app/`, so every move is a test change; that cost is the price of a suite that asserts on source, and it is paid slice by slice rather than at once. Two ADRs now describe Nova's surface — 0085 said she is Home, this says Home is her — and only the dates say which is later. The Nova audit's §M is amended twice (0086 and here), and a reader has to hold both amendments to know what §M still forbids: everything it lists, except under the named conditions. And the product now has a generative surface a founder types into, which is a class of failure this repository has never had to hold: a sentence that is fluent, grounded-looking and wrong. §5's conditions 3, 4 and 5 exist because prompt wording cannot hold it and a validator, a closed output shape and a deterministic floor can.

**Foreclosed.** A Nova with tools, web access or a database handle. A thread that decides anything canonical. A composer whose text reaches a system prompt or a module internal. Generated text as the last step before a consequential effect. A component that composes a product surface, and any register entry that legalizes an import into a feature. A universal artifact engine. A rail item for Nova (ADR 0085 stands: she is the project, not a row in it). A Vite migration, a second front-end, a microservice split, a new state library, a new database, a new background technology. Removing an address to tidy the navigation.

**Not decided here.** The retention class for threads; what a conversation turn costs and who pays for it, which is its own decision before Slice 6 ships — though *that it is bounded* is decided here, only the shape of the bound is open; whether intent resolution may call a model at all; account-level threads; which of Threads or Account takes the phone's fourth tab. Each is named in the audit's §E and is decided by the slice that needs it, with its own record.

## Status of the code

**Every slice has shipped** ([Sprint 0222](../sprints/0222-nova-leaves-the-route-layer.md) through [0233](../sprints/0233-the-card-that-outlived-its-screen.md)).

§2 is complete: the layering holds with no exception available, and `src/components` is primitives only — the shell moved to `src/features/shell/` in Slice 7, and the boundary test found that `app-frame.tsx` had been classified as a primitive and composes the account surface. §6 is real, and `transcript-is-not-a-position.test.ts` refuses any import that would let the ranking read a message. §5 is built: a bounded pack assembled by pure code, one model with no capability, every field validated, a deterministic template underneath, one `"use server"` command, and seven conditions held as assertions. The price is [ADR 0110](0110-a-question-costs-nothing-and-is-bounded.md)'s.

**§1's navigation is built, and §E.4 is answered.** It was blocked on a contradiction rather than on effort: the app level here read *Products · New chat · Threads · Settings* while a thread is **project-scoped**, so *Threads* at the account level named something that did not exist. The owner answered it the way the ownership model already implied — the conversation group lives **inside the active product**, under the switcher. The rail leads with Nova, Threads and *New chat*; the five capabilities sit under a `Workspace` label, quieter and one click away with their counts and the Agent's live status intact. Every address is the one it was: this changed what a rail says, not where anything is.

**§4's pane is built**, as a query parameter on the conversation's own address rather than a route — so the conversation stays on screen and *returning to it* needs no mechanism. It is a column from `lg` and a stacked section below, which is a deliberate departure from [ADR 0108](0108-a-phone-is-not-a-narrow-desktop.md)'s bottom sheet: a `<dialog>` and an `<aside>` cannot hold one server-rendered artifact between them without rendering it twice. Five of the eight kinds are drawn by the view their owning feature already has; three are named and opened, because a plan, a run and a paused question are each a workspace rather than a thing to look at.

**Deployed, and off by default.** All three migrations are on the production database as of 2026-09-17 — Slice 5's tables, Slice 6's turn function, and Slice 7's boundary, which is what lets a founder open a thread at all. Each went through the Supabase MCP rather than the CLI workflow rule 29 prefers, because this environment holds no `SUPABASE_ACCESS_TOKEN`, and each was verified by reading the schema back rather than from the tool's own response. The conversation lane is behind `NOVA_CONVERSATION_ENABLED`, default off, and has never met a model: there is no conversation eval. A table that can hold a thread is not a decision that a founder should be talking to one.

**Slice 8 migrated eight browser assertions before deleting anything**, which was its own correction: they were titled *"Nova Home"* and drove a fixture mounting the card the thread replaced. Moving them onto the production surface found a real defect — a stalled run read *"Analyzing business"* in mint, because the header called every operation the ranking held *active*. Four fixture-only components are retained deliberately and are named in the ROADMAP with what each costs.

Every address is unchanged at HEAD.
