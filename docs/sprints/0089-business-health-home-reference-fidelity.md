# UI-11 — Business Health Home Reference Fidelity

Status: Implemented, not dogfooded

Date: 2026-08-24

## What was missing

The project workspace opened on a compact Home summary while its strongest
answer — the business audit, nine-lens map and current priorities — lived on a
second Business Health route. The supplied reference made that duplication
obvious: one project needs one opening command surface, and this one should be
the product's visual high point rather than another quiet dashboard card.

The existing map already held the difficult truth correctly. Distance meant
when a lens matters, health was a separate textual judgment, connections came
from shared audit conclusions, and the centre was the only aggregate score.
Replacing it with the reference's invented per-node percentages would have
made the screen prettier by making the product less truthful.

## What changed

Business Health is now canonical project Home at
`/app/projects/:projectId`. The separate rail item is gone, leaving six project
destinations. The old `/health` address remains a guarded compatibility route,
and `#business-audit` now resolves on the canonical Home so every blocked-state
recovery link still lands somewhere real. Both routes authorize themselves and
share one server-owned content component, so there is no second audit read and
no UI state that can drift between the addresses.

The audit's intelligence panel became the **Business Brain**: a wider radial
stage, stronger connected topology, luminous centre, staged rings and nodes,
and a deliberately critical first-priority treatment where the audit actually
marks a critical blocker. The right column now says **What matters now**, while
the map states its own core idea — one business, nine connected areas. The
reference influenced hierarchy, scale and drama; all numbers, health labels,
materiality and links still come from the existing audit and opportunity
models.

Motion is finite. Rings, spokes, connections, nodes and centre arrive in a
short sequence; active edges flow for only a few cycles and the node aura
settles in under eight seconds. `prefers-reduced-motion` collapses all of that
to effectively immediate presentation, pinned by a browser test. On narrow
screens the radial geometry remains replaced by the existing priority-grouped
list, preserving labels, health, materiality and interaction instead of
shrinking an unreadable circle.

The Business Brain moved into its own feature directory. That creates one
auditable visual owner and prevents the screen's intentionally theatrical
language from becoming the default for forms, tables and account indexes. The
design and UX contracts now name this as the only cinematic product surface.

## What was not done

- No score, trend, activity, dependency direction or priority was invented.
- No audit schema, read model, provider, database table or paid operation
  changed.
- The old Home view model and component remain for the fixture-backed truth
  tests that guard their states; they are no longer the project index surface.
- Older application-owned forms found by an initially over-broad Premium audit
  were not modified as collateral work. The strict audit is scoped to the
  account repository surface it already governed and the new Business Brain
  feature owner.

## What has not been proved

The local app server cannot be started in this workspace because doing so would
execute repository-controlled code outside the approved isolation boundary.
Therefore the new browser assertions and visual desktop/mobile pass were not
run here, and the screen was not dogfooded against live project data. The
fixture-backed browser suite now contains the reduced-motion and revised
reading-order expectations for an environment where that server is permitted.

## Validation

- ESLint: 0 errors; 15 existing unused-variable warnings outside this work.
- Typecheck: passed (`next typegen` and `tsc --noEmit`).
- Unit/integration: 6,131 tests across 343 files passed.
- Production build: passed; both canonical Home and compatibility `/health`
  are present as dynamic routes.
- Frontend Design Premium strict audit: 0 findings.
- Targeted route, audit and documentation contracts: 79 tests passed before
  the full suite; the final full suite includes them.
- Browser E2E: authored/updated, not run locally for the isolation reason above.

Architecture decision: [ADR 0043](../decisions/0047-business-health-is-project-home.md).
