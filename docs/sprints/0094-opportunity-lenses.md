# CORE-2c — Opportunity Lenses

Status: Implemented

Date: 2026-08-24

Decision: [ADR 0050 §5 — Lenses are the audit's only framework](../decisions/0050-lenses-are-the-audit.md) (no new ADR; this executes the downstream half that decision already covered)

## Outcome

The Opportunity Engine and the Action Planner now speak the audit's own
vocabulary. Each Move names the business lens it most belongs to
(`primaryLens`, up to two `secondaryLenses`) instead of one of the five
retired dimensions, end to end: wire schema (nine-value enum), validator,
domain model, store and prompt. The duplicate-detection identity becomes
`category:lens`. With the last consumer moved, `AUDIT_DIMENSIONS`,
`AuditDimensionId`, `DIMENSION_LABELS` and `BusinessConclusion.dimensions`
are deleted from the audit schema — completing the removal ADR 0050 §5
scheduled.

## Version matrix

| Constant | Before | After |
|---|---|---|
| `OPPORTUNITY_SCHEMA_VERSION` | business-opportunity.v2 | .v3 |
| `OPPORTUNITY_SET_SCHEMA_VERSION` | business-opportunity-set.v2 | .v3 |
| `OPPORTUNITY_ENGINE_VERSION` | opportunity-engine-v2 | v3 |
| `OPPORTUNITY_PROMPT_VERSION` | opportunity-prompt-v2 | v3 |
| `OPPORTUNITY_RUBRIC_VERSION` | opportunity-rubric-v2 | v3 |

All five feed `computeOpportunityInputHash`, so the reuse identity shifts
with the contract (rule 48) — no dimension-attributed set is ever reused as
an answer under the lens contract.

## Legacy Moves

Rows stored before v3 keep their recorded dimension attribution; it is a
record and is not translated into a lens they never asserted. In the domain
they surface as `primaryLens: null`. No customer-facing surface rendered the
attribution under either vocabulary (pinned by `one-loop.test.ts`), so
nothing visible changes for old Moves.

The Action Planner's legacy reconciliation now matches on lens overlap. A
pre-v3 Move carries no lenses, so its affinity rests entirely on evidence
overlap — which the shared-evidence threshold (`score >= 10`) always
required to resolve at all. The one behavioural narrowing, accepted
deliberately: a tie between two candidates that the retired dimension
overlap used to break now resolves to `ambiguous_legacy_match`, and
ambiguous was always the honest answer there. The planner prompt's lens
line is simply omitted for a lens-less Move rather than reconstructed.

## Migration

`supabase/migrations/20260824170000_opportunity_lenses.sql` — additive:
`primary_lens` (nine-value CHECK, nullable) and `secondary_lenses` on
`business_opportunities`; `primary_dimension` loses only its NOT NULL (its
IN check already passes on null); `business_opportunities_has_attribution`
requires one generation's vocabulary per row.

## What was deliberately not built

A five→nine mapping for stored rows. Every candidate mapping invents a
judgment no audit made ("distribution" is not "acquisition" — it merely
overlaps it), and the only consumer that would have used it, the legacy
reconciliation, is stronger resting on evidence overlap than on a guessed
lens.
