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

The register is product-first. Marketing expression does not lead inside `/app`. Avoid glassmorphism, neon gradients, oversized empty hero areas, generic statistic-card grids, and fabricated activity that exists only to make a screen look busy.

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

Motion communicates interaction state only on ordinary product surfaces. Use the shared transition utility and respect reduced motion; never animate static dashboard furniture continuously. The narrowly-scoped Business Brain and Product Scan exceptions are defined below.

The project Product page reads as one coherent product dossier, not a stack of scanner reports. Its opening identity card may combine the real product mark, evidence-backed description, category, capability count and source coverage, but never a fabricated screenshot or product metric. Product DNA, founder intent, discovered capabilities, journey, brand identity and source coverage follow in that order; raw technical evidence stays available behind disclosure. The profile confirmation is the terminal surface: legacy scan summaries, coach prompts and cross-navigation actions must not continue below it.

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

## Do's and Don'ts

- Do keep account metrics honest and derived from stored domain data.
- Do preserve full repository and branch identity through responsive transformations.
- Do use one visual accent and a quiet foreground hierarchy.
- Do reserve cinematic motion and luminous depth for the Business Brain on project Home.
- Do let Product Scan motion follow stored discoveries and nothing else.
- Don't invent “active”, trend, pull-request or activity data for reference fidelity.
- Don't duplicate shared surfaces, buttons, status pills or icon grammar in screen-local systems.
- Don't let a table impose viewport height or overflow rules on the account shell.
- Don't reintroduce a sticky project header or repeat repository/branch metadata above every project page.
- Don't copy the Business Brain glow or choreography onto ordinary cards, forms or index pages.
- Don't reuse Product Scan's scanner core outside onboarding and My Product.
