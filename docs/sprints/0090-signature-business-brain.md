# UI-12 — Signature Business Brain

Status: Implemented, browser verification blocked locally

Date: 2026-08-24

## Outcome

Business Health now follows the supplied composition as a signature product
moment: a dominant neural Business Brain on the left and a decision/detail
column on the right. Motion for React stages the first reveal, highlights only
real related paths on hover and keyboard focus, and transitions the right panel
in place when a node is selected. The screen no longer appends a generic audit
report below the map.

The implementation keeps the audit contract authoritative. Numeric lens scores
from the visual reference were not copied because the domain does not score
lenses. Relationship paths are generated only from conclusions that really
grouped those lenses. The recent-change card uses the same seven-field
comparability rule as the account dashboard; contract changes and null scores
produce an explicit absent state.

## Business Brain data gaps

- **Individual lens scores:** unavailable in the audit domain. Nodes render
  health, priority and “No individual score”; `score` remains `null` in the
  view model.
- **Directional/causal relationship graph:** unavailable. The current graph is
  undirected and available only where a stored conclusion grouped lenses
  together. Directional arrows require a new domain contract, not a JSX rule.
- **Comparable recent changes:** available for the overall score from
  project-scoped audit readings when all seven reproducibility fields match.
  Per-lens changes are unavailable because lenses have no numeric history.
- **Source and signal counts:** available from distinct evidence ids actually
  cited by the audit and their recognised source families.
- **Selected-area recommendation checklist and expected outcome:** a single
  real Move title, impact class and effort class are available through stable
  Move lineage and are bound. A multi-step recommendation checklist or measured
  expected outcome is not in this read model and is not fabricated.
- **Last scan time:** available from the completed audit row.

## Verification boundary

Static typing and pure view-model tests cover unknown-as-null, relationship
grounding and comparable-history behavior. The local application server cannot
be started in this workspace because that would execute repository-controlled
code outside the approved isolation boundary. Therefore the requested live
browser comparison, screenshot capture, hover/selection pass and reduced-motion
emulation remain explicitly unproved here rather than being claimed from source
inspection.

## Validation

- Frontend Design Premium strict audit: 0 findings.
- ESLint: 0 errors; 15 pre-existing unused-variable warnings outside this work.
- TypeScript: passed.
- Unit/integration: 6,133 tests across 344 files passed.
- Production build: passed with the canonical project Home and legacy
  `/health` compatibility route present.
- Business Brain browser suite: 14 tests authored and Playwright discovery
  passed; execution not run for the isolation reason above.

Architecture decision: [ADR 0048](../decisions/0048-signature-business-brain.md).
