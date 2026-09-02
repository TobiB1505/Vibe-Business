-- The product's own name and logo, on the columns a list can read.
--
-- `product_profiles.result` already holds both: `identity.name` is what the
-- product calls itself, and `brand.assets[].displayUrl` is a logo Vibe checked
-- it can actually show. Neither reached the account dashboard, because
-- `dashboard-contract.test.ts` keeps that read model on columns — a dashboard
-- across every project is the last place to ship one large JSONB document per
-- row. So every card showed the *project* name, which is the label a founder
-- typed at connection time, over an initials tile.
--
-- This is the same denormalisation `business_readiness_audits.overall_score`
-- already uses, and for the same reason: the document stays authoritative, and
-- a list reads two small columns beside it.
--
-- Written at completion in `product-understanding/store.ts`, from the same
-- validated document being stored in `result`. Corrections are deliberately
-- NOT baked in — they live in `product_profile_corrections`, survive every
-- re-scan, and are applied on read, which is what keeps a founder's own name
-- for their product from being erased by the next derivation.

alter table public.product_profiles
  add column product_name text,
  add column product_logo_url text;

-- A stored name is a real one or absent. Blank is neither, and a card that
-- renders it shows an empty heading rather than falling back to the project
-- label.
alter table public.product_profiles
  add constraint product_profiles_product_name_is_stated
  check (product_name is null or char_length(btrim(product_name)) > 0);

-- The value goes straight into an `<img src>`.
--
-- `resolveDisplayUrl` in `product-understanding/brand.ts` already guarantees
-- https and same-origin-as-the-live-product before a `displayUrl` is ever
-- stored, so this constraint rejects nothing that path produces. It is here so
-- the guarantee survives a future writer that does not go through it: what a
-- browser is handed should be bounded by the database, not only by the code
-- that happened to write the row.
alter table public.product_profiles
  add constraint product_profiles_logo_is_https
  check (product_logo_url is null or product_logo_url like 'https://%');

comment on column public.product_profiles.product_name is
  'Denormalised identity.name from result, for list reads. Derived only — corrections are applied on read from product_profile_corrections.';

comment on column public.product_profiles.product_logo_url is
  'Denormalised brand asset displayUrl (logo, else logo_alternate) from result. Always https and on the product''s own origin; null when no asset can be displayed.';

-- ---------------------------------------------------------------------
-- Backfill
--
-- Completed rows only: a pending or failed profile has no result to read, and
-- the completed-has-result constraint makes that the exact set.
--
-- The logo takes `logo` over `logo_alternate` regardless of stored order, and
-- only where the value is one the https constraint above accepts — a row
-- written before `resolveDisplayUrl` existed is skipped rather than failing
-- the migration.
-- ---------------------------------------------------------------------
update public.product_profiles p
set
  product_name = nullif(btrim(p.result -> 'identity' -> 'name' ->> 'value'), ''),
  product_logo_url = (
    select asset ->> 'displayUrl'
    from jsonb_array_elements(coalesce(p.result -> 'brand' -> 'assets', '[]'::jsonb)) as asset
    where asset ->> 'role' in ('logo', 'logo_alternate')
      and asset ->> 'displayUrl' like 'https://%'
    order by case asset ->> 'role' when 'logo' then 0 else 1 end
    limit 1
  )
where p.status = 'completed'
  and p.result is not null;
