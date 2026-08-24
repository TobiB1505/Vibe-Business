# UI-13 — Planetary Business Brain

Status: Implemented, verification pending

Date: 2026-08-24

## Outcome

The signature Business Brain now follows the supplied planetary reference:
the overall core is a luminous sphere, nine circular business planets occupy
stable orbits, colour expresses health, size expresses real materiality, and a
dedicated SVG icon identifies every lens. Motion remains staged and bounded;
real relationship paths alone receive interactive signal emphasis.

The default decision column is more concise and the lower context card now
explains how Vibe scores the business in general terms. The legend separates
score bands from the honest `Not scored` state.

Audit contract v7 adds evidence-grounded nullable lens diagnostic scores. New
provider output must include a number or null, and application validation drops
unsupported or health-inconsistent numbers. Existing v6 audits stay current
and render `—`. Representative numbers exist only in the E2E fixture used for
visual verification.

## Remaining gap

Per-lens recent changes remain unavailable until the project has two comparable
v7 audits and a bounded history read model. The current Recent Changes surface
continues to report only the existing comparable overall score.

Architecture decision: [ADR 0045](../decisions/0045-business-lens-diagnostic-scores.md).
