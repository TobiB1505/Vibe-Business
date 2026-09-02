-- Price the sandbox where it is measured, without claiming the provider said so
-- (ADR 0073).
--
-- Every one of the 63 rows in `sandbox_usage_events` has `provider_cost_usd`
-- null, and that column is correct as it stands: it holds what the provider
-- reported, and Vercel reports nothing per sandbox. `VERCEL_SANDBOX_RATES` has
-- been founder-attested and `verified: true` since 2026-08-20, though, and
-- `deriveSandboxCost` computes a figure from dimensions these rows already
-- carry — so the cost is knowable, and only the epistemic state is different.
--
-- Overloading `provider_cost_usd` with that figure would mix "the provider
-- charged this" with "Vibe computed this from a rate", in a column that means
-- the first everywhere else. `economy/cost.ts` exists to keep exactly those two
-- apart. So the estimate gets columns of its own.
--
-- All three are nullable and nothing is backfilled. A historical row was
-- genuinely written under no rate card, and inventing one for it now would date
-- an estimate to a day the rate was not yet attested.

alter table public.sandbox_usage_events
  -- What the run cost, derived from the dimensions beside it. Never a bill.
  add column if not exists estimated_cost_nano_usd bigint
    check (estimated_cost_nano_usd is null or estimated_cost_nano_usd >= 0),
  -- The rate card the figure was computed under, so a later price change cannot
  -- silently restate a historical row — the rule `rateCardByVersion` enforces.
  add column if not exists cost_pricing_version text
    check (cost_pricing_version is null or char_length(btrim(cost_pricing_version)) > 0),
  -- The vCPU allocation the estimate assumed. CPU and memory both scale with it
  -- and it is a property of the sandbox profile rather than of the row, so
  -- storing it is what makes the estimate reproducible after the profile moves.
  add column if not exists vcpus integer
    check (vcpus is null or vcpus > 0);

-- An estimate without the two facts that make it readable is not an estimate,
-- it is a number.
alter table public.sandbox_usage_events
  drop constraint if exists sandbox_usage_estimate_is_attributable;

alter table public.sandbox_usage_events
  add constraint sandbox_usage_estimate_is_attributable
  check (
    estimated_cost_nano_usd is null
    or (cost_pricing_version is not null and vcpus is not null)
  );

-- `cost_estimated` joins the billing usage vocabulary.
--
-- `costed` means a price the provider stated. `cost_unknown` means Vibe refuses
-- to invent one. Neither describes a figure derived from a quantity the
-- provider reported and a rate Vibe holds — and folding it into `costed` would
-- let an assumption be summed as a measurement.
alter table public.billing_usage_events
  drop constraint if exists billing_usage_events_cost_status_check;

alter table public.billing_usage_events
  add constraint billing_usage_events_cost_status_check
  check (
    cost_status in ('costed', 'cost_estimated', 'cost_unknown', 'rate_unavailable', 'not_billable')
  );
