-- Measure what a Deep Scan's browser costs, now that Vibe owns it (ADR 0076).
-- See docs/sprints/0130-the-browser-we-own.md.
--
-- All 7 rows in `deep_scan_provider_usage` have `provider_cost_usd` null, and
-- that column stays correct: it holds what the provider reported, and neither
-- Browserbase nor Vercel reports a price per session.
--
-- What changed is not that a provider started answering. It is that the browser
-- is now a Vercel sandbox, `VERCEL_SANDBOX_RATES` has been founder-attested and
-- `verified: true` since 2026-08-20, and `stop()` reports the dimensions that
-- rate applies to. So the cost is knowable, and only the epistemic state is
-- different — the same argument the sandbox estimate made in ADR 0073, and the
-- same columns, deliberately, so the two are summed the same way.
--
-- Deep Scan was the last priced operation with no measured cost behind it: 25
-- Credits of revenue against a bill nobody could compute. This is the
-- instrument that will produce that measurement, not the measurement.
--
-- Nothing is backfilled. The 7 historical rows ran at Browserbase under no rate
-- Vibe holds, and deriving a Vercel figure for them would date an estimate to a
-- provider that did not run them.

alter table public.deep_scan_provider_usage
  -- The dimensions the rate applies to, as `stop()` reports them. Null on every
  -- historical row, and null is not zero: "we did not measure this" and "this
  -- was zero" are different facts and only one is safe to sum.
  add column if not exists active_cpu_ms bigint
    check (active_cpu_ms is null or active_cpu_ms >= 0),
  add column if not exists network_egress_bytes bigint
    check (network_egress_bytes is null or network_egress_bytes >= 0),
  -- What the session cost, derived from those dimensions. Never a bill.
  add column if not exists estimated_cost_nano_usd bigint
    check (estimated_cost_nano_usd is null or estimated_cost_nano_usd >= 0),
  -- The rate card the figure was computed under, so a later price change cannot
  -- silently restate a historical row.
  add column if not exists cost_pricing_version text
    check (cost_pricing_version is null or char_length(btrim(cost_pricing_version)) > 0),
  -- The vCPU allocation the estimate assumed. CPU and memory both scale with it
  -- and it belongs to the sandbox profile rather than to the row, so storing it
  -- is what keeps the estimate reproducible after the profile moves.
  add column if not exists vcpus integer
    check (vcpus is null or vcpus > 0);

-- An estimate without the two facts that make it readable is not an estimate,
-- it is a number. The same constraint `sandbox_usage_events` carries.
alter table public.deep_scan_provider_usage
  drop constraint if exists deep_scan_usage_estimate_is_attributable;

alter table public.deep_scan_provider_usage
  add constraint deep_scan_usage_estimate_is_attributable
  check (
    estimated_cost_nano_usd is null
    or (cost_pricing_version is not null and vcpus is not null)
  );

comment on column public.deep_scan_provider_usage.estimated_cost_nano_usd is
  'ADR 0076. Vibe''s own derivation from the dimensions beside it, under the rate card named in cost_pricing_version. Never what a provider charged — that is provider_cost_usd, and it stays null.';
