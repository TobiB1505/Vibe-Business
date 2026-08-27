-- Cache token quantities become metered units (docs/ROADMAP.md, §17).
--
-- The cost half closed in Sprint 0057 E2: `costForAiRow` already prices cache
-- reads and writes, and the whole call cost rides on the input row. What was
-- left is narrower and is what this migration reaches — the *quantity* of cache
-- tokens is measured by `ai_usage_events` and dropped on the floor before it
-- reaches `billing_usage_events`, because this CHECK constraint had no value to
-- put it under.
--
-- ## Why these are chargeable rather than informational
--
-- `anthropic_thinking_tokens` exists but is in `NON_CHARGEABLE_SKUS`, because
-- Anthropic already counts thinking inside the output tokens it bills. Cache is
-- the opposite: a response counts cache reads and cache writes *separately*
-- from the uncached input charged at the base rate, and they are billed at
-- 0.1x and 1.25x input respectively. So they are real, separately-billed units
-- and they stay rateable.
--
-- Nothing is mischarged today either way — `CREDIT_RATE_CARDS` is empty. The
-- consequence arrives with the first card: a card that lists neither SKU now
-- makes `rateUsage` return `sku_not_priced` rather than silently charging zero
-- for the 55-70% of agent provider cost `ECONOMY_MODEL.md` measured in cache.
-- Refusing to rate is the intended behaviour; billing nothing was the defect.
--
-- No backfill. `billing_usage_events` is unique on (source_kind, source_id, sku)
-- and `reconcileAiUsage` re-projects historical `ai_usage_events` rows, so the
-- next reconciliation run inserts the missing cache rows and leaves every
-- existing row untouched.

alter table public.billing_usage_events
  drop constraint billing_usage_events_sku_check,
  add constraint billing_usage_events_sku_check check (
    sku in (
      'anthropic_input_tokens', 'anthropic_output_tokens', 'anthropic_thinking_tokens',
      'anthropic_cache_read_tokens', 'anthropic_cache_write_tokens',
      'browser_duration_ms', 'sandbox_duration_ms', 'sandbox_active_cpu_ms',
      'sandbox_ingress_bytes', 'sandbox_egress_bytes'
    )
  );
