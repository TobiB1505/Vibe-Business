# Calibration Run 3 — Actual

- Fixture: `calibration-3-standard-logic`
- Agent run: `d91d077b-cfaa-449a-ab9b-2d56a4399c10`
- Run status: `succeeded`
- Validation: `passed` (standard)
- Economy model: `economy-model.v1`

## Actual economics

| Component | Cost | Basis |
|---|---|---|
| Model | $0.1706 | measured |
| Agent sandbox | $0.0176 | estimated |
| Validation | $0.0610 | estimated |
| Infrastructure | $0.0013 | estimated |

**Known floor: $0.2506** — every component resolved.

Measurement confidence: **medium**.

## Prediction vs reality

| | |
|---|---|
| Predicted | $0.3644 |
| Actual (floor) | $0.2506 |
| Difference | $-0.1138 |
| Relative error | -31.2% |
| Comparable | yes |

## Variance explanation

**Unexplained.** None of the measured signals moved in the direction of this variance. Attributing it to the nearest-looking cause would be a guess.

Unexplained share: **100%**.

## Repository movement since the previous calibration run

Drift level: **unknown** — no axis had a value on both sides, so nothing is claimed.

## Economy learning

**Not yet.** This run joins the learning dataset, but the adjustment policy requires 20 comparable observations before any correction is proposed. One run moving a future estimate would be the loop fitting itself to noise.

Recorded for the cohort: relative error -31.2%.
