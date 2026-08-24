# 0044 - Signature Business Brain view model and interaction

Status: Accepted

Date: 2026-08-24

## Context

ADR 0043 made Business Health the project Home and allowed a bounded theatrical
surface. Its first implementation still coupled the visual layer to the audit
map and placed selected detail below the visualization. The new reference
requires a materially different interaction: the map remains in place while the
right panel changes from the highest-priority blocker to one selected business
area, with hover-visible relationships and a short staged reveal.

The audit document contains real lens health, materiality, conclusions,
evidence and undirected co-membership relationships. It does not contain a
numeric score per lens, directional dependencies, per-lens score history,
expected impact or a recommendation checklist. The UI must be visually complete
without turning those absences into invented business intelligence.

## Decision

Business Health receives a dedicated `BusinessBrainView` read/view model. The
server converts the latest audit, project-scoped comparable score readings and
current Move lineage into this bounded contract before React receives it. The
interactive layer never reads the large audit document directly.

The contract carries the overall score and summary, all nine lens states, real
undirected relationships, the highest-ranked real blocker, exact additional
priority count, the first lineage-backed Move's title/impact class/effort class,
cited signal/source counts, last scan time and at most one latest comparable
overall-score change. Lens scores remain `null` because the domain does not
produce them. Unknown remains absent rather than zero.

Score history uses the existing seven-column reproducibility rule in
`score-series.ts`. A changed contract, an unscored endpoint or a single reading
renders an explicit no-comparable-history state rather than a delta.

Motion for React (`motion/react`) owns staged entrance, node hover/focus,
selected-node layout, right-panel presence and the restrained core/signal
ambient behavior. After entry, at most a slow centre breath and one low-opacity
signal path may continue; both pause when the document is hidden. Reduced motion
removes those effects and all large transforms. CSS owns static atmosphere only.

The default panel shows one real top priority. Selecting a node changes that
same panel into founder-facing detail with real related areas, diagnosis,
missing context, evidence and an Action Plan link. It does not navigate, open a
modal or append a second report below the map.

On mobile, the desktop geometry is replaced by an aggregate core and a
horizontally browsable list of the same nine semantic controls. Detail follows
below. Every node remains a keyboard-reachable button with health, priority and
the absence of an individual score in its accessible name.

This decision amends only the motion paragraph of ADR 0043. It changes no audit
semantics, score calculation, evidence rule, provider, paid operation or
persistence schema.

## Consequences

**Easier.** Visual evolution no longer requires JSX to understand audit JSON.
Missing fields are explicit in one contract, selection has one owner, and
default/selected panels cannot drift into different interpretations.

**Harder.** Business Health now performs one additional bounded project-scoped
history read. The query selects score and reproducibility columns only; it does
not open historical JSONB documents.

**Foreclosed.** A reference screenshot cannot introduce a lens score,
directional dependency, improvement event, source count or measured outcome.
Those appear only after the domain/read model can produce them truthfully.
