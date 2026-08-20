# Calibration Run 1 — Prediction

**Frozen before execution.** Nothing below may be edited after the run; the reconciliation
is appended to `run-1-actual.md` instead.

- Fixture: `calibration-1-small-copy`
- Step key: `dogfood-fixture--calibration-1-small-copy`
- Project: `b95779dc-73ca-40d8-bc60-40878d079ca7`
- Base commit: `405439b56b0e0f3e56ae895801ca1f3d831c870c`
- Economy model: `economy-model.v1`
- Provider pricing: `claude-sonnet-5-introductory-2026`
- Report version: `calibration-report.v1`

## What this run is for

A second observation of the `small` class, and a repeat of run #8's evidence against a repository that has grown since — so repository drift can be measured against a known step.

## Prediction

| | |
|---|---|
| Estimated cost | $0.2873 |
| Upper bound | $0.3291 |
| Protected cost | $0.3735 (buffer 30%) |
| Pricing class | `small` (public_pages_only) |
| Confidence | **low**, from 7 comparable run(s) |

### Confidence, by axis

- Historical data: low
- Repository signal: high
- Provider pricing: high

## Historical basis

Basis: `kind_matched`, 7 matched run(s).

| Run | Similarity | Matched on | Floor |
|---|---|---|---|
| #8 | 1.00 | pricing_class, change_kind, risk_class, evidence_overlap | $0.2541 |
| #3 | 0.35 | change_kind, risk_class | $0.4331 |
| #4 | 0.35 | change_kind, risk_class | $0.2845 |
| #5 | 0.35 | change_kind, risk_class | $0.3542 |
| #6 | 0.35 | change_kind, risk_class | $0.1739 |
| #7 | 0.35 | change_kind, risk_class | $0.2821 |
| #9 | 0.35 | change_kind, risk_class | $0.3470 |

## Cost drivers

- **validation_depth** (unknown) — the depth this change will validate at is not yet resolved
- **repository_complexity** (lowers) — complexity 0.98x against the reference repository
- **historical_baseline** (neutral) — 7 comparable run(s), kind_matched

## What this prediction could not see

- No prior execution to measure repository movement against.
- Validation depth is unresolved before a Prepared Change exists, so the validation term is 1.

## Repository context at the pinned commit

- Tree entries: 1367
- Files analyzed: 2
- Routes detected: 33
- Surfaces detected: 14
- Context candidates: 8 sent of 8 available
- Context pressure: **unclipped** (1.00x)
