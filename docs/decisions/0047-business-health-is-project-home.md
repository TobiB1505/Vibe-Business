# 0047 - Business Health is the project Home

Status: Accepted; the navigation decision is reversed by [0084](0084-nova-is-the-project-home.md) — Home becomes Nova and Business Health returns to the rail. What this ADR says about the audit surface itself, and its `#business-audit` / `/health` compatibility guarantee, still stands

Date: 2026-08-24

## Context

ADR 0045 gave the project workspace both a Home summary and a separate
Business Health destination. The split was internally coherent, but it made the
project's most valuable answer one navigation step away: the business audit is
the only surface that brings the score, nine connected business lenses,
priorities and their evidence together.

The supplied reference also made the product-level distinction visible. An
account Home is a quiet portfolio dashboard; a project Home should be the
immersive command surface for one business. Keeping a second summary in front
of that surface diluted the answer and made Home repeat a smaller version of
Business Health.

There is one compatibility constraint. `#business-audit` is a domain recovery
anchor used when an opportunity set is blocked. Saved `/health` URLs may also
exist. Neither may silently stop resolving.

## Decision

Business Health becomes the canonical project Home at
`/app/projects/:projectId`. The separate Business Health navigation item is
removed, leaving six project-rail destinations. The existing server-owned audit
states and data reads are shared by the canonical Home and the legacy
`/health` route; both routes perform their own project-access check before
rendering.

`projectSectionHref(projectId, "business-audit")` now resolves to the canonical
Home plus `#business-audit`. The section id itself remains unchanged. The
legacy `/health` route remains a compatibility alias and is not advertised in
the navigation.

The Business Brain is the one intentionally theatrical product surface. Its
visual motion is bounded to entry and direct interaction, conveys the
connections already present in the audit model, settles after a few cycles, and
is removed by the global reduced-motion contract. Motion introduces no new
score, health relationship, activity or priority.

This decision amends the seven-section navigation in ADR 0045. It changes no
domain module, persistence, provider, audit contract or paid operation.

## Consequences

**Easier.** Opening a project now answers the most important question first:
how the business is doing and what matters now. Home no longer competes with a
second diagnosis summary, and the rail maps more directly to the remaining
work after diagnosis.

**Harder.** Two URLs intentionally render one substantial server surface. The
shared content owner and per-route access tests are required to prevent visual
drift without weakening authorization.

**Compatibility.** Existing `/health` bookmarks continue to render and every
`#business-audit` recovery path moves to the canonical Home. No stored URL or
domain identifier needs a migration.

**Foreclosed.** A future project landing page cannot become a generic KPI
summary beside Business Health. New project-Home content must strengthen the
same diagnosis-and-next-action story or live in its owning section.
