# Calibration Run 5 — Actual

- Fixture: `calibration-5-complex-structural`
- Agent run: `8d0d47ce-f5f9-4edb-81a4-d28749cf31ff`
- Run status: `succeeded`
- Validation: `passed` (standard)
- Economy model: `economy-model.v1`

## Actual economics

| Component | Cost | Basis |
|---|---|---|
| Model | $0.2034 | measured |
| Agent sandbox | $0.0265 | estimated |
| Validation | $0.0650 | estimated |
| Infrastructure | $0.0014 | estimated |

**Known floor: $0.2964** — every component resolved.

Measurement confidence: **medium**.

## Prediction vs reality

| | |
|---|---|
| Predicted | $0.3210 |
| Actual (floor) | $0.2964 |
| Difference | $-0.0246 |
| Relative error | -7.7% |
| Comparable | yes |

## Variance explanation

**Unexplained.** None of the measured signals moved in the direction of this variance. Attributing it to the nearest-looking cause would be a guess.

Unexplained share: **100%**.

## Repository movement since the previous calibration run

Drift level: **unknown** — no axis had a value on both sides, so nothing is claimed.

## Economy learning

**Not yet.** This run joins the learning dataset, but the adjustment policy requires 20 comparable observations before any correction is proposed. One run moving a future estimate would be the loop fitting itself to noise.

Recorded for the cohort: relative error -7.7%.
