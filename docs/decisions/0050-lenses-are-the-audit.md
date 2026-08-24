# ADR 0050 — Lenses are the audit's only framework

**Status:** Accepted · 2026-08-24

## Context

The audit has carried two frameworks since CORE-2a.3: five scored **dimensions** (product, monetization, distribution, conversion, retention — PRODUCT.md §10) and nine reasoning **lenses** (offer, audience, revenue_economics, acquisition, conversion, retention, measurement, business_readiness, scalability). The dimensions were the scored layer; the lenses were where the thinking happened. ADR 0049 then gave every lens its own evidence-grounded diagnostic score, and was explicit that those scores "must not become a sixth calculation of the overall score".

The product owner has decided the split ends: one framework, and it is the nine lenses. The five-square breakdown leaves the product, the per-lens scores become the scored layer, and the overall score derives from them.

## Decision

1. **The audit contract stops carrying dimensions.** The model is no longer asked for, and the wire schema no longer accepts, a per-dimension block. `business-audit-contract-v8`.
2. **The overall score is computed from lens scores**, deterministically, by the application — never by the model. The rule, exactly:
   - `eligibleLenses = 9 − |validated lenses with materiality = "not_material"|`. A lens absent from the model output counts as eligible — we cannot know it is immaterial.
   - `scoredLenses` = validated lenses with a non-null score. Validation has already nulled a score lacking cited evidence or contradicting its health band (ADR 0049); materiality plays no role here.
   - `MINIMUM_SCORED_LENSES = max(3, ceil(eligibleLenses / 2))`. A fully material product needs 5 of 9 — the same majority spirit as the previous 3-of-5. A product with two `not_material` lenses needs 4 of 7. The floor of 3 means a headline number never rests on fewer than three scores, however many lenses a model declares immaterial.
   - `overall = round(unweighted mean of scoredLenses)` when the threshold is met, else `null` with a coverage reason. Unscored is excluded, never zero (rule 44).
3. **Materiality neither weights nor gates the mean.** A scored `not_material` lens counts in the numerator and the scored count, and is excluded only from the eligibility denominator. This is deliberate: if re-labelling a weak lens as immaterial removed it from the average, the priority judgment would become a lever on the score — the exact leak the health/materiality split (CORE-2a.3.1 §29) exists to prevent, pointed the other way.
4. **Stored v6/v7 audits remain current and renderable.** `MIN_SUPPORTED_AUDIT_CONTRACT_VERSION` stays v6. Their JSONB keeps its `dimensions` as a record; no surface renders the five-square breakdown; their stored `overall_score` continues to display as recorded. Rule 60 forbids invalidating a paid result to force a refresh.
5. **Downstream attribution follows.** Opportunities' `primaryDimension`/`secondaryDimensions` and action-plan dimension matching move to lenses in the immediately following change; between the two merges the opportunity renderer degrades to its lens block and matching rests on evidence overlap, which is already the dominant term.

## What this supersedes, honestly

- **ADR 0049's** sentence "no change to the authoritative overall score" and its premise that lens scores are diagnostic-only. That decision was correct for its moment — it added scores without changing what anyone was already relying on. This ADR is the deliberate second step it declined to take.
- **PRODUCT.md §10's** five-dimension definition of the audit, rewritten in the same change.
- **Sprint 4 §7's** `computeOverallReadiness` rule (3 of 5, equal weight over scored dimensions). The new rule keeps both of its principles — equal weighting, unscored-is-not-zero — and changes the population they run over.

## Consequences

- `schema_version`, `audit_version`, `prompt_version` and `rubric_version` all bump, so the score series breaks its line at the boundary rather than joining incomparable readings — by design (`score-series.ts`).
- `business_readiness_audits` gains `assessed_lenses`/`eligible_lenses` columns (additive; the dimension columns stay for old rows, which are records).
- `assessed > eligible` is legitimate (a scored `not_material` lens), so no cross-column check is added.
- The five-dimension vocabulary (`AUDIT_DIMENSIONS`, `DIMENSION_LABELS`) survives temporarily as deprecated exports for the opportunity engine and leaves entirely with the follow-up change.
