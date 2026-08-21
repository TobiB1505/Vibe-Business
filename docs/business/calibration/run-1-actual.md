# Calibration Run 1 — Actual

- Fixture: `calibration-1-small-copy`
- Agent run: `8c14b567-7477-4e29-9c33-aef7a163bac7`
- Run status: `succeeded`
- Validation: `passed` (fast)
- Economy model: `economy-model.v1`

## Actual economics

| Component | Cost | Basis |
|---|---|---|
| Model | $0.1126 | measured |
| Agent sandbox | $0.0247 | estimated |
| Validation | unknown | not_measured |
| Infrastructure | $0.0014 | estimated |

**Known floor: $0.1388** — incomplete. Missing: validation.

Bracketed, the run cost between **$0.1507** and **$0.1866** — the ends are the unpriced sandbox at 0% and 100% active CPU. Neither end is the answer; the answer was not recorded.

Measurement confidence: **none**.

## Prediction vs reality

| | |
|---|---|
| Predicted | $0.2873 |
| Actual (floor) | $0.1388 |
| Difference | $-0.1485 |
| Relative error | -51.7% |
| Comparable | no — `actual_incomplete` |

## Variance explanation

- **actual_cost_incomplete** (high) — at least one cost component was never measured, so the total is a floor

## Repository movement since the previous calibration run

Drift level: **unknown** — no axis had a value on both sides, so nothing is claimed.

## Economy learning

**No.** This run is not comparable (`actual_incomplete`), so it contributes nothing to the learning dataset — not even a zero.
