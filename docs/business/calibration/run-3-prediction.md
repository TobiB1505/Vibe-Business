# Calibration Run 3 — Prediction

**Frozen before execution.** Nothing below may be edited after the run; the reconciliation
is appended to `run-3-actual.md` instead.

- Fixture: `calibration-3-standard-logic`
- Step key: `dogfood-fixture--calibration-3-standard-logic`
- Project: `b95779dc-73ca-40d8-bc60-40878d079ca7`
- Base commit: `bd7dc420b74feb123d3d8dd4c2060880872d5df5`
- Economy model: `economy-model.v1`
- Provider pricing: `claude-sonnet-5-introductory-2026`
- Report version: `calibration-report.v1`

## What this run is for

The first non-presentational calibration change. Same class as most of the dataset, different kind of work, so `standard` can be tested for internal spread.

## Prediction

| | |
|---|---|
| Estimated cost | $0.3644 |
| Upper bound | $0.4127 |
| Protected cost | $0.4737 (buffer 30%) |
| Pricing class | `standard` (single_surface) |
| Confidence | **low**, from 7 comparable run(s) |

### Confidence, by axis

- Historical data: low
- Repository signal: high
- Provider pricing: high

## Historical basis

Basis: `class_matched`, 7 matched run(s).

| Run | Similarity | Matched on | Floor |
|---|---|---|---|
| #3 | 0.80 | pricing_class, change_kind, risk_class | $0.4331 |
| #4 | 0.80 | pricing_class, change_kind, risk_class | $0.2845 |
| #5 | 0.80 | pricing_class, change_kind, risk_class | $0.3542 |
| #6 | 0.80 | pricing_class, change_kind, risk_class | $0.1739 |
| #7 | 0.80 | pricing_class, change_kind, risk_class | $0.2821 |
| #9 | 0.80 | pricing_class, change_kind, risk_class | $0.3470 |
| #8 | 0.35 | change_kind, risk_class | $0.2541 |

## Cost drivers

- **validation_depth** (unknown) — the depth this change will validate at is not yet resolved
- **repository_complexity** (raises) — complexity 1.03x against the reference repository
- **repository_drift** (raises) — the repository moved substantially since the last execution
- **historical_baseline** (neutral) — 7 comparable run(s), class_matched

## What this prediction could not see

- Validation depth is unresolved before a Prepared Change exists, so the validation term is 1.

## Repository context at the pinned commit

- Tree entries: 1367
- Files analyzed: 2
- Routes detected: 33
- Surfaces detected: 14
- Context candidates: 12 sent of 12 available
- Context pressure: **unclipped** (1.00x)
