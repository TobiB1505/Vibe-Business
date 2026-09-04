---
version: alpha
colors:
  ground: "#030506"
  app: "#070a0c"
  mint: "#00e5a0"
  amber: "#e8b54a"
  coral: "#ff7a5c"
  foreground: "#f7f5f1"
  body: "#edebe7"
  muted: "#95928a"
typography:
  sans:
    fontFamily: 'Inter, "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
  mono:
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, ui-monospace, monospace'
rounded:
  nav: "10px"
  well: "14px"
  panel: "14px"
  card: "16px"
components:
  button:
    radius: "nav"
  panel:
    radius: "panel"
  status:
    radius: "9999px"
omitted:
  - section: spacing
    reason: "Tailwind utility spacing remains canonical; the product has no exported spacing token map."
---

# Vibe Business Design System

## Overview

Vibe Business is a founder command center: calm enough for daily use, precise enough for consequential work. Product surfaces should feel like a dark operations console made for business decisions, not a developer IDE and not a decorative analytics template. Its signature is disciplined mint guidance over near-black layered surfaces. Restraint wins everywhere data or action needs to be compared.

The audience is AI-native builders. They arrive from Linear, Vercel, Claude, Raycast, Arc, Framer and Lovable, and they read interface quality as product quality — so for this product, craft is not decoration around the value, it is part of it. The bar for a major surface is not "clean SaaS UI" but "would this feel at home in a premium AI-native product?". A surface that merely works is not yet finished.

Restraint here is a compositional tool, not a ceiling. Ordinary surfaces stay quiet so that the moments which deserve spectacle can have it; a product where everything is loud has no emphasis left to spend. Both are in play, and choosing between them per surface is the design work.

The register is product-first, and the standing prohibitions are against the _generic_, not against ambition. Marketing expression does not lead inside `/app`. Avoid glassmorphism, neon gradients, oversized empty hero areas, generic statistic-card grids, and fabricated activity that exists only to make a screen look busy — the first four because they are the house style of every dashboard template and would make Vibe unrecognisable, the last because it is a lie. Those are different reasons, and only the last one is absolute: an expressive treatment that is unmistakably Vibe's own is welcome, while inventing state is never permitted at any level of polish.

The runtime source of truth is [src/app/globals.css](src/app/globals.css). This file records the durable intent and maps to those established tokens; it does not generate them.

## Colors

Ground and app establish the frame. Surface depth is created with the four alpha surface tokens in `globals.css`, not arbitrary solid greys. Mint is brand, active navigation, focus and primary action. Amber means waiting or incomplete; coral means a real failure, gap or destructive risk. Neither status colour is decorative.

Text uses the named foreground ramp. Important data must not drop below `fg-muted`; `fg-disabled` is reserved for genuinely unavailable controls. Repository names, branches and SHAs may use mono, but ordinary scores and labels stay in the interface family.

## Typography

Use the neutral native interface stack for product UI. Hierarchy comes from size, weight and spacing rather than a recognisable display face. Headings are compact and confident; body copy is direct and low-drama. Technical identifiers use the mono family sparingly.

## Layout

Account pages use one persistent rail on desktop and a top strip below the large breakpoint. Main content is a single readable column with wide comparison surfaces. Index pages establish hierarchy in this order: route heading and primary action, context/summary, searchable dataset, then supporting trust or explanation.

Project pages use one 256px desktop rail that owns the current product, repository connection, project navigation and account footer. The project document is the only independent vertical scroll surface; its content is capped at 1440px with 32–40px page padding. No persistent project header repeats the product name above the page. Routes lead with a quiet `My Products / Product` breadcrumb, then one large page title, description and local action in normal document flow.

Dense comparison data uses a semantic table on desktop. Independent records transform into labeled stacked rows on narrow screens without dropping status, identity or actions. Page-level horizontal overflow is never acceptable.

## Elevation & Depth

Depth comes primarily from surface and border contrast. Static sections use subtle or no shadow. The strongest card elevation is reserved for the primary context block; nested cards should become wells or divided rows rather than another elevated rectangle.

## Shapes

Controls and navigation use precise 10px corners. Panels use 14px, major cards 16px, and pills only represent compact statuses or filters. Avoid making every element pill-shaped.

## Components

Primary buttons use mint once per action area; secondary controls use the shared bordered surface. Focus is always the global mint `:focus-visible` ring. Search owns an explicit clear action. Short filter and sort menus use native selects only where platform popup geometry is accepted. Tables keep headers, range feedback and pagination stable.

On ordinary product surfaces — settings, billing, tables, index pages, forms — motion communicates interaction state. Use the shared transition utility, respect reduced motion, and never animate static dashboard furniture continuously. That restraint is deliberate and it is what buys the signature surfaces their contrast; it is a statement about _ordinary_ surfaces, not a cap on the product.

Motion beyond that is governed by [Craft and Motion](#craft-and-motion) below, which supersedes this document's earlier position that the three named signature surfaces were the only places cinematic motion could exist.

Billing follows a compact financial-dashboard composition: plan, spendable Credits and the Credit model form one equal-height overview row; real Credit prices and top-up packs come next; recent activity and plan choices complete the page. Stripe remains the visible payment boundary for renewal, invoices and cancellation. Reference-only finance data such as payment-card suffixes, invoice rows, period charts or per-product usage must not appear until the billing read model can supply it truthfully. The balance expiry ring may visualize only the actual next-expiring share of currently spendable Credits, with an explicit text label; it is never a fabricated usage meter.

The project Product page reads as one coherent product dossier, not a stack of scanner reports. Its opening identity card may combine the real product mark, evidence-backed description, category, capability count and source coverage, but never a fabricated screenshot or product metric. Product DNA, founder intent, discovered capabilities, journey, brand identity and source coverage follow in that order; raw technical evidence stays available behind disclosure. The profile confirmation is the terminal surface: legacy scan summaries, coach prompts and cross-navigation actions must not continue below it.

The Action Plan guides one decision at a time, not a project-management board.
A horizontal Now/Next/Later priority track leads to one active Move card and one
stable detail region below it. Other Moves remain available through the track,
but never compete as full cards or permanent side panels. Selection is local and
immediate; the URL records it only so refresh and browser history preserve the
founder's place, never to turn a step change into route navigation.

Inside the active Move, planned work reads as a compact to-do checklist. Every
row is closed by default and keeps only its title, order/completion mark and a
short readiness state visible. Opening one row reveals ownership, description,
exact dependencies, completion criteria and approval context. The completion
mark reflects durable state; it is never an editable checkbox or a shortcut
around the existing founder-confirmation action.

Nothing on this surface may state a duration, a percentage or a step counter. A
Move's effort is the coarse label the domain records, the parts of the product a
plan touches are derived from stored evidence, and a run's progress is the named
stages its executor actually wrote. Where the reference composition asked for a
figure the domain cannot produce, the honest reading takes the slot or the slot
goes.

The Action Plan may use bounded orchestration because priority and focus are part
of its meaning: the active Move slides horizontally for step, arrow and swipe
selection while the detail region fades by a shorter distance and adapts its
height. The motion lasts roughly 350–450ms, never changes rank or state, and has
button and keyboard equivalents. The forming-plan state may use a contained
orbital core only while a real operation is active and the document is visible.
It never advances copy, numbers or stage state on a timer. Reduced motion removes
slides, transforms, orbit and pulse while leaving the same priority, Move and
named stages present immediately. Static cards do not breathe, scan or glow.

## External UI and Design Tooling

### Vibe owns the visual identity

This document, the runtime tokens, the primitives in `src/components/ui/` and every Vibe-owned product component are the design authority. External libraries and catalogues are **resources, not authorities** — nothing is adopted because a catalogue is confident about it.

Within that, adopt aggressively. An external pattern is worth taking when it materially improves visual quality, interaction quality, perceived craftsmanship, motion, usability, accessibility or delight. Do not reject one merely because it is visually expressive; judge whether it strengthens Vibe. The test applied to the result is not how much was changed but whether the surface still reads as this product.

### shadcn is reference infrastructure, not the design system

Vibe is not a shadcn project. There is no `components.json`, and the dependency set carries no Radix package, no icon library and no `clsx`/`tailwind-merge`/`cva`; `cn` is a local join and every primitive under `src/components/ui/` is hand-written on Tailwind v4. Two consequences follow and both are easy to trip over:

- Never run `shadcn init`, and never introduce a second design system implicitly. Registry install commands (`npx shadcn@latest add …`) will _create_ `components.json` when none exists, scaffolding a parallel `ui/` convention beside this one. Port by hand instead.
- A pasted component's `className` prop will not override its base classes here, because `cn` does no Tailwind conflict resolution. This fails silently.

Use the shadcn MCP for what it is genuinely good at: component research, accessible interaction primitives, Dialog / Popover / Tooltip / Select / Command / Tabs / Accordion patterns, keyboard and focus behaviour, and implementation reference.

A shadcn or Radix primitive **may** be introduced where it materially improves Vibe. That is not forbidden. Before it is, state the concrete problem, why the existing Vibe implementation is weaker, the dependencies it brings, and how it will be visually integrated. The objective is not to avoid shadcn — it is to avoid becoming generic shadcn.

### 21st.dev is an active design resource

Search it broadly when designing a significant new surface: interaction patterns, high-end cards, unusual layouts, AI interfaces, progress experiences, transitions, state changes, review interfaces, motion ideas, spatial UI, microinteractions and visual hierarchy.

Its components are not inspiration that must always be reduced to something simpler. A finding may be reused conceptually, adapted, heavily adapted, partially ported, or — where technically appropriate — integrated fairly directly. Classify each one explicitly as **REUSE**, **ADAPT**, **HEAVILY ADAPT**, **INSPIRE** or **REJECT**, and do not default to keeping Vibe's existing presentation when an external pattern is materially better.

### Dependencies

External UI dependencies are not prohibited categorically. One earns its place by providing real value in accessibility, interaction correctness, sophisticated motion, rendering quality, implementation quality, development speed or product polish. Before adding one, state what it solves, whether Vibe already solves it, its bundle and runtime implications, who owns it long-term, and how it fits visually.

What this guards against is accumulation by accident — a dependency arriving because a component demo was copied whole rather than because anyone decided it should.

### Reuse logic, not necessarily presentation

Architecture reuse and visual reuse are separate decisions. Before building something new, inspect what exists and reuse the parts that carry authority: domain state, actions, data models, validation and established accessibility behaviour. Do not preserve an old visual presentation merely because it is already there — an existing component may be reused, extended, recomposed, visually redesigned, or replaced at the presentation layer when the new experience is materially better.

### Research workflow for significant UI work

Understand the product state and the user's goal; read the rules here that apply; inspect the existing Vibe components; search 21st.dev broadly; search shadcn where primitives or accessibility are relevant; consider motion patterns; compare several directions; prefer the strongest product experience rather than automatically the smallest change; report meaningful dependency or architecture changes before introducing them; then build the chosen direction in Vibe's own visual language.

## Craft and Motion

### The craft bar

For an important surface, "does this work?" is the first question and not the last. Also ask whether it feels exceptional, and consider deliberately: entrance choreography, shared-layout transitions, contextual animation, hover depth, active-state transitions, progressive disclosure, animated hierarchy changes, spatial continuity, subtle parallax, animated typography, state morphing, timed stagger, responsive motion, tactile button feedback, and polished loading and success states.

The interface should be recognisable as Vibe rather than as default shadcn, default Tailwind, a dashboard template, a generic AI chat, or a collection of catalogue components stacked together.

### Motion is a first-class tool

Motion is encouraged wherever it improves continuity, hierarchy, comprehension, state awareness, perceived responsiveness, emotional quality or product identity. It is **not** restricted to a fixed list of surfaces, and a new important surface may establish its own motion language when the surface justifies one.

Onboarding, Nova Home, Nova's conversations and choices, the Product Understanding reveal, the Business Audit reveal, Move transitions, Action Plan progression, Agent execution, prepared-change review and completion transitions are all places where expressive motion is appropriate.

Three obligations travel with every motion language, new or existing, and none of them is negotiable:

- `prefers-reduced-motion` removes transforms, continuous movement and pulsing while leaving every piece of content, state and action present at first paint.
- Continuous motion pauses while the document is hidden.
- Panel geometry is reserved before the first event, so arriving content never moves text somebody is reading.

### Motion may be ambitious; it may never be false

Visual ambition is encouraged. False state is forbidden. Never animate fabricated progress or percentages, a state Vibe has not observed, success before success exists, deployment when only a merge is known, or activity while a process is in fact waiting.

This is the boundary that the rest of this section spends its freedom against: the design may be experimental, the state model may not. External UI never changes domain truth. An approval surface cannot alter what is actually approved; a diff surface cannot introduce partial approval where the product approves one immutable commit; a progress surface cannot invent a fraction; a question component cannot invent choices; an execution control cannot bypass Credit, risk or resolver checks; and model prose never becomes authority because it was rendered beautifully.

## Signature Surfaces

A signature surface is one where the product's understanding is the thing being shown, and where choreography carries meaning rather than decorating it. Three exist today — Business Brain, Product Scan and Agent — and they are described below.

**The set is open.** Earlier revisions of this document declared it closed at three; that position is retired. A new signature surface requires an intentional design argument — what it means, what its motion says that static layout could not, and why it earns the contrast — not a prohibition. What must not happen is every card behaving like one: the richest choreography is reserved for moments that deserve it, and ordinary cards, forms, tables and index pages stay quiet so that reservation means something.

**Nova is recognised as a signature surface.** Nova is intended to become the canonical Home experience, and when it is built it is to be designed as one of Vibe's strongest visual identities rather than constrained to being quieter than the surfaces that preceded it. It should read as an intelligent presence and a premium product agent — something that understands the product and is actively orchestrating the business — and it may use distinctive transitions, rich focus cards, animated state changes, sophisticated progress presentation, ambient motion, custom identity elements, spatial transitions, layered information and premium microinteractions. Avoid copying generic chatbot UI; do not read "not a chatbot" as "visually plain". The intended reaction is that this feels like a product from the future, without costing the reader any trust or clarity.

_Nova is not implemented at HEAD._ It exists as an architecture audit, a pure `deriveNovaFocus` ranking, and visual prototypes under `src/app/e2e/`. This paragraph is a standing design decision about what Nova is to be when it ships, and the surfaces described below remain the product's current signature set. Recognising Nova as Home reverses [ADR 0047](docs/decisions/0047-business-health-is-project-home.md), which is a decision to be recorded in its own ADR when Nova is built, not by this document.

## Signature Surface: Business Brain

The project Home is the deliberate exception to the product's otherwise quiet presentation. Its Business Brain may use a contained mint aura, traced connections, spherical planet nodes and staged entry to make the nine business areas read as one system. This is a semantic visualization, not a new decorative language: planet colour represents health, planet size represents materiality, and a relationship line exists only where the audit grouped areas into the same conclusion. The centre remains the only aggregate score; a planet may show its own evidence-grounded diagnostic lens score, which never contributes to the centre and is `—` when unsupported.

The entrance choreography settles within roughly 1.5 seconds. After that, only a very slow core breath and one bounded low-opacity signal path may remain active; document visibility pauses both. Hover and selection may wake only real related paths and must dim unrelated nodes without removing their labels. `prefers-reduced-motion` removes staged transforms, signal movement and pulsing without hiding content. Coral is reserved for a real critical gap and amber for incomplete or waiting states, even inside this signature surface.

Selection changes the Business Brain into a focused workspace rather than opening a drawer or appending a report. The map remains visible, a structured dimension explanation takes the primary detail column, and a narrow scoring rail separates current evidence coverage from unsupported history. Overview and detail occupy the same reserved grid cell and crossfade together, so a state change never exposes an empty page background. At narrower widths those regions stack without shrinking the map into an unreadable canvas. Tabs may organize real evidence, signals and history, but every unsupported dimension-level reading must render an explicit absent state instead of borrowing the overall Business Health history.

Motion for React owns the Business Brain's entrance, presence, layout, hover and selected-state transitions. CSS is limited to static atmosphere, surfaces and the global reduced-motion backstop. This exception must not be copied into settings, billing, tables or ordinary dashboard cards.

## Signature Surface: Product Scan

Product Scan is the second narrow signature surface, and its visual metaphor is discovery rather than health. A contained mint scanner core connects to six stable product facets while a chronological feed shows individual grounded findings. Connections activate only when a corresponding durable scan event exists. The graph must never emit random particles, cycle fake messages or suggest a percentage the backend cannot measure.

The reference composition is the implementation target: a centered understanding headline, a fixed scanner stage with six compact facet cards, a right-hand discovery summary, then equal-height activity and discovery panels above one quiet status footer. Desktop geometry is reserved before the first event. A new logo, typeface, color or capability animates inside its existing slot; it must never increase the scanner, feed or page height as it arrives. The My Product route must not wrap the scanner in another elevated card.

The onboarding variant may use the full available Understand-phase width; the My Product variant embeds the same component above the dossier. On narrow screens the constellation becomes a linear evidence rail while preserving the feed, source labels and event order. This is a named responsive variant, not a second component.

On My Product, an active scan stays fully expanded. A completed scan automatically folds into a compact, stable summary so the dossier is not pushed far below the fold; opening that summary restores the complete evidence view and the re-scan action. The onboarding variant stays expanded because discovery is the active step there. Failure states also stay expanded so recovery is never hidden.

Motion for React owns event arrival, connector activation and the active orbital movement. One new stored event may create one bounded outward impulse and a short in-slot card emphasis; it may not animate layout geometry. Existing events do not replay on mount, document visibility pauses continuous motion, and `prefers-reduced-motion` makes every state change immediate. Mint means active or grounded; amber marks a source that was unavailable without turning missing evidence into a bad result.

## Signature Surface: Agent

Agent is the third narrow signature surface, and its metaphor is neither health nor discovery but **work in progress**. It was the last one for as long as the set was closed; [Signature Surfaces](#signature-surfaces) above now governs how a fourth is added. It is the one screen where a founder is watching software change their product and can see none of it happening, and the surface exists to make that wait legible rather than decorative.

Five stages — Understand, Build, Validate, Preview, Review — are rendered from `agentStageSteps`, which projects over the execution timeline and the prepared change's own gates and re-decides neither. The rail is a completion indicator, unlike the Action Plan's Move stepper, so a tick means the work is done. Two things it must never draw: a connector that fills part way, which is a percentage in disguise, and a pending stage that looks like a skipped one — those mean "keep waiting" and "this is never coming" and must differ in mark, in label and in words.

The core has exactly three states: idle, working and settled. A failed run is settled and still; a core that kept breathing over a failure would be the animated form of a status line narrating work nobody is doing. The orbit's speed is constant by rule — accelerating it with apparent progress would be a progress bar with extra steps, because no measured fraction exists behind it.

Motion for React owns the entrance, the core's breath and the single orbiting signal. The entrance choreography settles within roughly 1.5 seconds; after it, exactly two elements may still move and only while working. Document visibility pauses both. `prefers-reduced-motion` renders the settled state immediately and moves nothing, without hiding content. Panel geometry is reserved before the first event, so a completing stage never moves text somebody is reading. No overshoot easing anywhere on the rail — it carries information. Mint means Vibe is acting or the work is behind you; coral is reserved for a run that genuinely stopped.

Estimated durations, expected file ranges and any other unmeasured number are out of bounds on this surface, as they are everywhere else in the product. Counts shown are counts Vibe recorded: files read from the harness's own tool stream, files changed from the verified candidate.

The Build stage owns the Agent's live event record beside the working core. Validate owns only the independently observed sandbox checks and their explicit retry; it never re-labels implementation events as validation activity. Stage footers reserve calm vertical space around their safety language so those guarantees read as part of the workspace rather than as a cramped legal afterthought.

## Do's and Don'ts

- Do keep account metrics honest and derived from stored domain data.
- Do preserve full repository and branch identity through responsive transformations.
- Do use one visual accent and a quiet foreground hierarchy.
- Do reserve cinematic motion and luminous depth for surfaces that have earned a signature argument, and keep ordinary surfaces quiet so that reservation reads.
- Do let Product Scan motion follow stored discoveries and nothing else.
- Do search 21st.dev and shadcn before designing a significant new surface, and say what was rejected as well as what was taken.
- Do state the problem, the alternative and the cost before adding a UI dependency.
- Don't invent “active”, trend, pull-request or activity data for reference fidelity.
- Don't duplicate shared surfaces, buttons, status pills or icon grammar in screen-local systems.
- Don't let a table impose viewport height or overflow rules on the account shell.
- Don't reintroduce a sticky project header or repeat repository/branch metadata above every project page.
- Don't copy the Business Brain glow or choreography onto ordinary cards, forms or index pages.
- Don't reuse Product Scan's scanner core outside onboarding and My Product.
- Don't run `shadcn init`, and don't let a registry install command scaffold a second `ui/` convention.
- Don't reject an external pattern for being visually expressive, and don't adopt one that leaves the surface looking like a catalogue.
- Don't let polish outrun observation: no animated percentage, no success before success, no motion that implies work nobody is doing.
