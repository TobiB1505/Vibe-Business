# Calibration Run 2 — Actual

- Fixture: `calibration-2-complex-multi-surface`
- Agent run: `260a8453-611f-4ca1-b027-6d15647eb05e`
- Run status: `succeeded`
- Validation: `passed` (fast)
- Economy model: `economy-model.v1`

## Actual economics

| Component | Cost | Basis |
|---|---|---|
| Model | $0.1818 | measured |
| Agent sandbox | $0.0163 | estimated |
| Validation | unknown | not_measured |
| Infrastructure | $0.0013 | estimated |

**Known floor: $0.1994** — incomplete. Missing: validation.

Bracketed, the run cost between **$0.2118** and **$0.2490** — the ends are the unpriced sandbox at 0% and 100% active CPU. Neither end is the answer; the answer was not recorded.

Measurement confidence: **none**.

## Prediction vs reality

| | |
|---|---|
| Predicted | $0.5329 |
| Actual (floor) | $0.1994 |
| Difference | $-0.3334 |
| Relative error | -62.6% |
| Comparable | no — `actual_incomplete` |

## Variance explanation

- **actual_cost_incomplete** (high) — at least one cost component was never measured, so the total is a floor

## Repository movement since the previous calibration run

Drift level: **unknown** — no axis had a value on both sides, so nothing is claimed.

## Economy learning

**No.** This run is not comparable (`actual_incomplete`), so it contributes nothing to the learning dataset — not even a zero.
