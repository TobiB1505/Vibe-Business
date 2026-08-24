# CORE-2b — Lens-Scored Audit

Status: Implemented

Date: 2026-08-24

Decision: [ADR 0050 — Lenses are the audit's only framework](../decisions/0050-lenses-are-the-audit.md)

## Outcome

The nine business lenses are now the audit's only framework. The five scored
dimensions left the contract entirely: the model is no longer asked for them,
the wire schema no longer carries them, validation no longer requires them, and
the overall Business Health score is computed from the lens scores the audits
have carried since [ADR 0049](../decisions/0049-business-lens-diagnostic-scores.md).

The scoring rule (`scoring.ts`):

- `eligibleLenses = 9 − (validated lenses with materiality "not_material")`.
  A lens absent from the output counts eligible; `unknown` materiality counts
  eligible.
- The overall score is the unweighted, rounded mean over lenses with a non-null
  score — including a scored `not_material` lens, which counts in the mean and
  the numerator but not the denominator, so re-labelling a weak lens can never
  buy a higher number.
- Coverage threshold `max(3, ceil(eligibleLenses / 2))`. Below it the score is
  null with a stated reason. Null is never zero (rule 44), enforced in code.

## Version matrix

One coherent bump, because each half alone would let two different contracts
share a version string:

| Constant | Before | After |
|---|---|---|
| `BUSINESS_AUDIT_SCHEMA_VERSION` | business-readiness-audit.v1 | .v2 |
| `BUSINESS_AUDIT_VERSION` | business-audit-v2 | v3 |
| `AUDIT_SYNTHESIS_VERSION` | business-audit-synthesis-v6 | v7 |
| `AUDIT_CONTRACT_VERSION` | business-audit-contract-v7 | v8 |
| `PROMPT_VERSION` | business-audit-prompt-v4 | v5 |
| `RUBRIC_VERSION` | business-readiness-rubric-v10 | v11 |
| Evidence pack | business-evidence.v4 | unchanged |
| Supported contracts | [v6, v7] | [v6, v7, v8] |

Four of the seven score-series comparability columns change, so the Business
Signal trend breaks at this release by design — pinned with a test that uses
the real version constants, so the break is a recorded intention.

## What was removed

- The dimension layer of the contract: `DimensionAssessment`,
  `DIMENSION_QUESTIONS`, `DIMENSION_TOPICS`, the wire `dimensions` block, the
  five-dimension hard-fail loop in `validate.ts`, and prompt/rubric sections
  addressed to it.
- `human-view.ts` and the five-square `business-health.tsx` panel (zero
  production importers after the Business Brain became project Home).
- `computeOverallReadiness` / `MINIMUM_SCORED_DIMENSIONS`, replaced by
  `computeOverallScore` / `minimumScoredLenses`.
- Dead `assessed_dimensions` / `total_dimensions` reads in
  `projects/dashboard.ts` and `business-audit/store.ts` — no production
  consumer remained.

`AUDIT_DIMENSIONS`, `AuditDimensionId` and `DIMENSION_LABELS` stay exported
with a deprecation note: the opportunity engine still attributes to dimensions
until the follow-up stage (ADR 0050 §5) moves it to lenses and finishes the
deletion. The grammar probe's baseline candidates freeze the five ids as
literals — they are a record of what was sent to the provider, not a live
contract.

## Legacy audits

Stored v6/v7 audits stay `completed`, renderable and reusable under their own
recorded versions (rule 60). Their JSONB keeps `dimensions`; the opportunity
renderer reads it through an explicitly-typed legacy guard. The database
`completed_has_result` constraint now accepts either generation's coverage
verdict (`assessed_dimensions` or the new `assessed_lenses`), and there is
deliberately no `assessed_lenses <= eligible_lenses` check — a scored
`not_material` lens legitimately exceeds the denominator.

## Migration

`supabase/migrations/20260824120000_lens_scored_audit.sql` — additive:
`assessed_lenses` and `eligible_lenses` (smallint, 0–9 CHECKs), the widened
completed-has-result constraint, and column comments. Old columns untouched.

## Known gap

Per-lens score history: lens scores exist only inside each audit's JSONB, so
the Business Brain's per-area "Score over time" and History tab state that
absence honestly. Recorded in `docs/ROADMAP.md`.
