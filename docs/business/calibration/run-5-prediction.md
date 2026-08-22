# Calibration Run 5 — Prediction

**Frozen before execution.** Nothing below may be edited after the run; the reconciliation
is appended to `run-5-actual.md` instead.

- Fixture: `calibration-5-complex-structural`
- Step key: `dogfood-fixture--calibration-5-complex-structural`
- Project: `b95779dc-73ca-40d8-bc60-40878d079ca7`
- Base commit: `bd7dc420b74feb123d3d8dd4c2060880872d5df5`
- Economy model: `economy-model.v1`
- Provider pricing: `claude-sonnet-5-introductory-2026`
- Report version: `calibration-report.v1`

## What this run is for

A second `complex` observation on a different surface pair, and the first observation of the agent working outside SEO — on the authenticated dashboard rather than a public page.

## Prediction

| | |
|---|---|
| Estimated cost | $0.3210 |
| Upper bound | $0.3648 |
| Protected cost | $0.4173 (buffer 30%) |
| Pricing class | `complex` (multi_surface) |
| Confidence | **low**, from 7 comparable run(s) |

### Confidence, by axis

- Historical data: low
- Repository signal: high
- Provider pricing: high

## Historical basis

Basis: `kind_matched`, 7 matched run(s).

| Run | Similarity | Matched on | Floor |
|---|---|---|---|
| #3 | 0.35 | change_kind, risk_class | $0.4331 |
| #4 | 0.35 | change_kind, risk_class | $0.2845 |
| #5 | 0.35 | change_kind, risk_class | $0.3542 |
| #6 | 0.35 | change_kind, risk_class | $0.1739 |
| #7 | 0.35 | change_kind, risk_class | $0.2821 |
| #8 | 0.35 | change_kind, risk_class | $0.2541 |
| #9 | 0.35 | change_kind, risk_class | $0.3470 |

## Cost drivers

- **validation_depth** (unknown) — the depth this change will validate at is not yet resolved
- **repository_complexity** (raises) — complexity 1.01x against the reference repository
- **historical_baseline** (neutral) — 7 comparable run(s), kind_matched

## What this prediction could not see

- Validation depth is unresolved before a Prepared Change exists, so the validation term is 1.

## Repository context at the pinned commit

- Tree entries: 1367
- Files analyzed: 2
- Routes detected: 33
- Surfaces detected: 14
- Context candidates: 10 sent of 10 available
- Context pressure: **unclipped** (1.00x)
