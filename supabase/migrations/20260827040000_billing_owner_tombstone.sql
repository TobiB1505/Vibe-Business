-- VB-002 M3′ — the billing graph is tombstoned, never deleted (ADR 0056 §6, §9).
--
-- Erasure adopts model R1: the `auth.users` row is actually deleted, so every
-- `on delete cascade` edge into it fires. Three of those edges currently sit at
-- the head of the financial graph. Left as they are, the first erasure would
-- delete a credit account, and with it the ledger, reservations, quotes, grants
-- and allocations hanging beneath it — the exact outcome §6 forbids, and the
-- one F5 showed has no repair path: the repair functions re-materialize rows
-- marked `materialized_at is null`, and a deleted row is invisible to them
-- rather than pending for them.
--
-- `on delete set null` makes the same event a tombstone. The account survives
-- whole with no owner, so the twenty-odd `not null` columns keyed on
-- `credit_account_id` never need migrating. The Stripe identifiers survive too,
-- deliberately (decision P-3): retaining financial evidence that can no longer
-- be reconciled against the processor would be retention without value, and
-- `stripe_customer_id` is what makes a later dispute or refund for a past
-- charge attributable.
--
-- Measured before writing this, on a cluster carrying every migration:
--   * all three columns are `not null … on delete cascade`;
--   * `billing_credit_accounts_user_idx` is `(user_id)` and
--     `billing_stripe_customers_user_mode_idx` is `(user_id, livemode)`, both
--     plain `nulls distinct` btrees — so any number of tombstoned rows coexist
--     and no erasure can collide with an earlier one;
--   * `billing_subscriptions` is unique on `stripe_subscription_id` only, and
--     `billing_stripe_customers` additionally on `stripe_customer_id`. Both
--     survive untouched, which is what keeps P-3's retention meaningful.
--
-- This migration must land before any erasure runs. §11 states the deploy order
-- for exactly this reason.

alter table public.billing_credit_accounts
  alter column user_id drop not null;

alter table public.billing_credit_accounts
  drop constraint billing_credit_accounts_user_id_fkey,
  add constraint billing_credit_accounts_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

alter table public.billing_stripe_customers
  alter column user_id drop not null;

alter table public.billing_stripe_customers
  drop constraint billing_stripe_customers_user_id_fkey,
  add constraint billing_stripe_customers_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

alter table public.billing_subscriptions
  alter column user_id drop not null;

alter table public.billing_subscriptions
  drop constraint billing_subscriptions_user_id_fkey,
  add constraint billing_subscriptions_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;
