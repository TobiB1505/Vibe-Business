# Cache token quantities become metered units

**Recorded 2026-08-27, after the work.** One migration, two SKUs, ten lines of projection. Closes the last open entry in [ROADMAP](../ROADMAP.md)'s *Then* section that could be closed by code rather than by more data.

## What was missing

`ai_usage_events` has stored `cache_read_input_tokens` and `cache_creation_input_tokens` since `20260818210000_agent_execution.sql`. `ai/pricing.ts` has priced them since the same sprint, and Sprint 0057 E2 fixed `costForAiRow` to re-price them — which repaired 234 of the live ledger's 314 AI rows.

The quantities still went nowhere. `projectAiUsage` split an AI row into at most three billing events — input, output, thinking — and dropped both cache columns on the floor, because `billing_usage_events.sku` carries a CHECK constraint listing every permitted value and neither cache SKU was in it. The measurement existed at both ends and had no unit to travel in.

`credits/schema.ts` already said so, at length, in a docblock explaining why the SKUs were absent. It had outlived two earlier reasons and was down to the honest one: *"Adding it is a migration … so it is not a comment's decision to make."*

## Why it matters, and what it does not change

The entry that named this gap reads as though metering makes cache *chargeable*. That conflates two axes that this codebase keeps deliberately separate, and the distinction is the whole of the change.

**Provider cost is untouched.** `calculateProviderCost` returns one figure for the whole call, cache included, and the established doctrine attaches it to the input row alone — every other SKU carries `not_billable` and a null cost. The cache rows follow that rule exactly, so summing `raw_cost_nano_usd` across billing usage still reproduces the AI ledger, which is what §69 requires.

**Rating is what changes, and only because of one omission.** `rateUsage` skips `NON_CHARGEABLE_SKUS` — thinking tokens live there because Anthropic already counts them inside the output tokens it bills, so pricing them again would double-charge reasoning. Cache is the opposite: a response counts cache reads and cache writes *separately* from the uncached input charged at the base rate, and bills them at 0.1× and 1.25× input. So the cache SKUs are deliberately **not** in that list.

The consequence arrives with the first Credit rate card. `CREDIT_RATE_CARDS` is `[]`, so nothing changes today. A future card that lists neither SKU will make `rateUsage` return `sku_not_priced` rather than silently charging zero for the 55–70% of agent provider cost [`ECONOMY_MODEL.md`](../business/ECONOMY_MODEL.md) measured in cache. **Refusing to rate is the intended behaviour; billing nothing was the defect.**

## What changed

- **`20260827080000_cache_token_metering.sql`** — two values added to the `sku` CHECK.
- **`credits/schema.ts`** — `USAGE_SKUS` and `SKU_UNITS`. The docblock explaining the absence is replaced by one explaining the cache-versus-thinking distinction, since the old one is now false.
- **`credits/projection.ts`** — the two events, emitted only when the quantity is above zero, following `anthropic_thinking_tokens`' precedent and for its reason: every operation but an agent turn has no cache breakpoint, so a zero-quantity row on every AI call would be noise rather than a measurement.

## What was not done, and why

**No backfill migration, and this is a decision rather than an omission.** `billing_usage_events` is unique on `(source_kind, source_id, sku)`, and `reconcileAiUsage` re-projects historical `ai_usage_events` rows on every run — including the two cache columns, which it has always selected. So the next reconciliation inserts exactly the missing cache rows and leaves every existing row untouched. A backfill would be a second mechanism doing what the first already does idempotently.

**No rate-card entry.** Adding a price is a commercial decision, not an implementation detail, and `retail.ts` says so about its own list. This sprint makes the quantity available to a card; it does not write one.

**No change to `costForAiRow`.** The cost half closed in Sprint 0057 E2 and re-opening it would risk moving financial history that is already correct.

## What has not been proved

- **The migration is not deployed.** It is committed and asserted against the migration text by `credits/schema.test.ts`, and it has not been pushed to the remote database. Nothing in the application writes a cache SKU until it is.
- **No reconciliation run against real data.** The claim that the next `reconcileAiUsage` backfills historical rows rests on the unique index and the projection, both tested — not on a run against the live ledger.
- **Nothing was rated.** `CREDIT_RATE_CARDS` is empty, so the `sku_not_priced` behaviour this sprint's argument turns on is asserted in tests against a constructed card, never observed in production.

## Validation

| check | result |
| --- | --- |
| Credits module | 258 passed, 14 files |
| Unit tests | 6680 passed, 382 files |
| Typecheck | clean |
| Lint | 19 warnings, 0 errors |
| Build | clean |

The three behavioural assertions were each verified to have teeth by breaking what they guard: removing the emission fails *"meters cache read and cache write as their own SKUs"* and *"attaches no second cost to the cache rows"*; relaxing the zero-guard to emit on `0` fails *"emits nothing for a call that used no cache"*. `credits/schema.test.ts`'s existing drift guard — which compares `checkedValues("billing_usage_events", "sku")` against `USAGE_SKUS` — is what proves the migration text and the TypeScript union agree, and it passes only because both were changed.
