# Calibration Run 2 — Prediction

**Frozen before execution.** Nothing below may be edited after the run; the reconciliation
is appended to `run-2-actual.md` instead.

- Fixture: `calibration-2-complex-multi-surface`
- Step key: `dogfood-fixture--calibration-2-complex-multi-surface`
- Project: `b95779dc-73ca-40d8-bc60-40878d079ca7`
- Base commit: `bd7dc420b74feb123d3d8dd4c2060880872d5df5`
- Economy model: `economy-model.v1`
- Provider pricing: `claude-sonnet-5-introductory-2026`
- Report version: `calibration-report.v1`

## What this run is for

The first observation of `complex` in Vibe's history. Reached by surface count rather than by risk, because a high-risk agentic run is refused and would produce no cost data.

## Prediction

| | |
|---|---|
| Estimated cost | $0.3592 |
| Upper bound | $0.4082 |
| Protected cost | $0.4670 (buffer 30%) |
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
- **repository_complexity** (raises) — complexity 1.03x against the reference repository
- **repository_drift** (raises) — the repository moved substantially since the last execution
- **historical_baseline** (neutral) — 7 comparable run(s), kind_matched

## What this prediction could not see

- Validation depth is unresolved before a Prepared Change exists, so the validation term is 1.

## Repository context at the pinned commit

- Tree entries: 1367
- Files analyzed: 2
- Routes detected: 33
- Surfaces detected: 14
- Context candidates: 12 sent of 12 available
- Context pressure: **unclipped** (1.00x)
