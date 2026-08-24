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

Dense comparison data uses a semantic table on desktop. Independent records transform into labeled stacked rows on narrow screens without dropping status, identity or actions. Page-level horizontal overflow is never acceptable.

## Elevation & Depth

Depth comes primarily from surface and border contrast. Static sections use subtle or no shadow. The strongest card elevation is reserved for the primary context block; nested cards should become wells or divided rows rather than another elevated rectangle.

## Shapes

Controls and navigation use precise 10px corners. Panels use 14px, major cards 16px, and pills only represent compact statuses or filters. Avoid making every element pill-shaped.

## Components

Primary buttons use mint once per action area; secondary controls use the shared bordered surface. Focus is always the global mint `:focus-visible` ring. Search owns an explicit clear action. Short filter and sort menus use native selects only where platform popup geometry is accepted. Tables keep headers, range feedback and pagination stable.

Motion communicates interaction state only. Use the shared transition utility and respect reduced motion; never animate static dashboard furniture continuously.

## Do's and Don'ts

- Do keep account metrics honest and derived from stored domain data.
- Do preserve full repository and branch identity through responsive transformations.
- Do use one visual accent and a quiet foreground hierarchy.
- Don't invent “active”, trend, pull-request or activity data for reference fidelity.
- Don't duplicate shared surfaces, buttons, status pills or icon grammar in screen-local systems.
- Don't let a table impose viewport height or overflow rules on the account shell.
