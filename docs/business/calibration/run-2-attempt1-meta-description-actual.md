# Calibration Run 2 — Actual

- Fixture: `calibration-2-complex-multi-surface`
- Agent run: `1b17a989-3ed6-47a7-8fb2-f090420f06fa`
- Run status: `failed`
- Validation: `not run`
- Economy model: `economy-model.v1`

## Actual economics

| Component | Cost | Basis |
|---|---|---|
| Model | $0.1635 | measured |
| Agent sandbox | $0.0170 | estimated |
| Validation | unknown | stage_not_run |
| Infrastructure | $0.0014 | estimated |

**Known floor: $0.1819** — every component resolved.

Measurement confidence: **medium**.

## Prediction vs reality

| | |
|---|---|
| Predicted | $0.3592 |
| Actual (floor) | $0.1819 |
| Difference | $-0.1773 |
| Relative error | -49.4% |
| Comparable | yes |

## Variance explanation

**Unexplained.** None of the measured signals moved in the direction of this variance. Attributing it to the nearest-looking cause would be a guess.

Unexplained share: **100%**.

## Repository movement since the previous calibration run

Drift level: **unknown** — no axis had a value on both sides, so nothing is claimed.

## Economy learning

**Not yet.** This run joins the learning dataset, but the adjustment policy requires 20 comparable observations before any correction is proposed. One run moving a future estimate would be the loop fitting itself to noise.

Recorded for the cohort: relative error -49.4%.
