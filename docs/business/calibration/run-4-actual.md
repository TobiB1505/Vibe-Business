# Calibration Run 4 — Actual

- Fixture: `calibration-4-standard-validation-heavy`
- Agent run: `ab2ac0e4-21dd-4d56-8a18-360fb619287b`
- Run status: `succeeded`
- Validation: `passed` (standard)
- Economy model: `economy-model.v1`

## Actual economics

| Component | Cost | Basis |
|---|---|---|
| Model | $0.5981 | measured |
| Agent sandbox | $0.0284 | estimated |
| Validation | $0.0732 | estimated |
| Infrastructure | $0.0018 | estimated |

**Known floor: $0.7014** — every component resolved.

Measurement confidence: **medium**.

## Prediction vs reality

| | |
|---|---|
| Predicted | $0.3169 |
| Actual (floor) | $0.7014 |
| Difference | $0.3845 |
| Relative error | 121.4% |
| Comparable | yes |

## Variance explanation

**Unexplained.** None of the measured signals moved in the direction of this variance. Attributing it to the nearest-looking cause would be a guess.

Unexplained share: **100%**.

## Repository movement since the previous calibration run

Drift level: **unknown** — no axis had a value on both sides, so nothing is claimed.

## Economy learning

**Not yet.** This run joins the learning dataset, but the adjustment policy requires 20 comparable observations before any correction is proposed. One run moving a future estimate would be the loop fitting itself to noise.

Recorded for the cohort: relative error 121.4%.
