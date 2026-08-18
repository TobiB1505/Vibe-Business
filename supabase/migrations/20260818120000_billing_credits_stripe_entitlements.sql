-- BILLING CORE-2: Stripe, credit grant lots, allocations and entitlements.
-- See docs/sprints/0038-billing-core2-stripe-entitlements.md and ADR 0025.
--
-- Billing Core-1 made Credits financially correct: exact integers, an
-- append-only ledger, quote → reserve → settle → release, and an atomic
-- reservation primitive proven under real concurrency. It deliberately left
-- Credits as shadow accounting — nothing granted them, nothing spent them.
--
-- Core-2 makes them real. Three things are added, and nothing in Core-1 is
-- replaced:
--
--   1. **Provenance.** A Credit now knows where it came from and when it dies.
--      `billing_credit_grants` is the immutable lot; `billing_credit_allocations`
--      records which lot funded which hold and which charge.
--   2. **Money.** Stripe is the payment rail only. A verified Stripe event
--      becomes an idempotent grant; Stripe is never asked at runtime whether a
--      customer can afford an audit.
--   3. **Expiration.** Welcome Credits die after 30 days, subscription Credits
--      at the end of the period that paid for them, purchased Credits not on
--      any normal schedule.
--
-- ## What is deliberately NOT here
--
-- No second wallet. `billing_credit_accounts.posted_credits` remains the
-- materialized balance and the atomic admission gate; grant lots sit *beneath*
-- it as provenance, and the ledger remains the reconstructable truth. A lot is
-- never the authority on how many Credits exist — the ledger is, and every lot
-- is created by exactly one ledger entry.
--
-- No payment instruments, no card data, no Stripe secrets, no webhook
-- payloads. `billing_stripe_events` stores an id, a type and a status, which
-- is the minimum that makes replay idempotent and debugging possible.

-- ---------------------------------------------------------------------
-- New ledger kind: `expiry`
--
-- Expiration is a posted, append-only event, not a deletion and not a
-- read-time filter. That choice is what keeps Core-1's atomic gate intact:
-- `posted_credits` stays the number the reservation predicate is evaluated
-- against, so expiring Credits lowers it exactly like any other debit, and
-- `reconcileBalance` keeps working unchanged.
--
-- An expired grant row is never deleted or rewritten — the lot stays, its
-- status becomes 'expired', and a compensating negative entry records the
-- amount that lapsed. "100 Welcome Credits — expired Aug 30" is answerable
-- from history forever.
-- ---------------------------------------------------------------------
alter table public.billing_credit_ledger
  drop constraint billing_credit_ledger_kind_check;

alter table public.billing_credit_ledger
  add constraint billing_credit_ledger_kind_check
  check (kind in ('grant', 'purchase', 'charge', 'refund', 'adjustment', 'expiry'));

alter table public.billing_credit_ledger
  drop constraint billing_credit_ledger_sign_matches_kind;

alter table public.billing_credit_ledger
  add constraint billing_credit_ledger_sign_matches_kind check (
    (kind in ('charge', 'expiry') and credit_delta < 0)
    or (kind in ('grant', 'purchase', 'refund') and credit_delta > 0)
    or kind = 'adjustment'
  );

-- ---------------------------------------------------------------------
-- billing_credit_grants
-- An immutable Credit lot: where a balance came from, and when it dies.
--
-- Expiration and spend order are impossible without provenance. A single
-- undifferentiated balance cannot answer "which 100 of these expire on the
-- 30th", so it could not enforce either policy correctly.
-- ---------------------------------------------------------------------
create table public.billing_credit_grants (
  id uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null references public.billing_credit_accounts (id) on delete cascade,

  -- The ledger entry that posted these Credits. One entry, one lot — this is
  -- the exactly-once guarantee for grants, and it is deliberately not a second
  -- idempotency mechanism: the ledger's own
  -- `billing_credit_ledger_idempotency_idx` already collapses a retried grant
  -- to one entry, and the unique index below carries that guarantee through to
  -- the lot. A replayed Stripe webhook therefore cannot mint a second lot even
  -- if it somehow reached the insert.
  ledger_entry_id uuid not null references public.billing_credit_ledger (id) on delete restrict,

  source_kind text not null check (
    source_kind in ('welcome', 'subscription', 'purchase', 'promotional', 'compensation')
  ),

  -- Immutable. What was granted, never what remains.
  initial_credit_units bigint not null check (initial_credit_units > 0),

  -- Capacity currently held by a reservation or already consumed by a charge.
  -- Materialized for the same reason `billing_credit_accounts.reserved_credits`
  -- is: allocation must be admitted by a single atomic statement, and a sum
  -- over `billing_credit_allocations` cannot be locked. Reconcilable from those
  -- rows, and proven against them by src/modules/credits/lots.ts.
  allocated_credit_units bigint not null default 0 check (allocated_credit_units >= 0),

  -- Capacity that lapsed unspent. Set once, by the expiry sweep.
  expired_credit_units bigint not null default 0 check (expired_credit_units >= 0),

  granted_at timestamptz not null default now(),
  -- Null means "no normal expiration" — purchased top-up Credits. Deliberately
  -- not a far-future date: "never expires on a monthly schedule" and "expires
  -- in 2099" are different promises, and only one of them is true.
  expires_at timestamptz,

  status text not null default 'active' check (status in ('active', 'expired')),
  expired_at timestamptz,

  -- What paid for this lot, when anything did. A Stripe invoice or checkout
  -- session id — an identifier, never an amount, a card or a customer detail.
  external_reference text,

  -- The paid billing period a subscription lot belongs to. Null for every
  -- other source kind.
  subscription_id uuid,
  period_start timestamptz,
  period_end timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A lot can never give out more than it holds. The structural backstop that
  -- makes over-allocation impossible even if the application predicate were
  -- written wrong — the same posture as
  -- `billing_credit_accounts_available_non_negative`.
  constraint billing_credit_grants_capacity_not_exceeded
    check (allocated_credit_units + expired_credit_units <= initial_credit_units),

  -- Expiry is a terminal, timestamped fact.
  constraint billing_credit_grants_expired_has_timestamp
    check ((status = 'expired') = (expired_at is not null)),
  -- Only an expiring lot may expire. A purchased lot has no expiry date and
  -- must never acquire one by an application bug.
  constraint billing_credit_grants_expired_had_a_date
    check (status <> 'expired' or expires_at is not null),
  -- A subscription lot names its period; nothing else may claim one.
  constraint billing_credit_grants_period_matches_kind check (
    (source_kind = 'subscription') = (period_start is not null and period_end is not null)
  )
);

comment on table public.billing_credit_grants is 'Immutable Vibe Credit lots. Provenance and expiry for a balance the ledger still defines.';
comment on column public.billing_credit_grants.ledger_entry_id is 'The one ledger entry that posted this lot. Unique — this is what makes a grant exactly-once.';
comment on column public.billing_credit_grants.allocated_credit_units is 'Held plus consumed capacity, in integer credit units. Reconcilable from billing_credit_allocations.';
comment on column public.billing_credit_grants.expires_at is 'When this lot lapses. Null means no normal expiration (purchased Credits), never a far-future date.';

-- One ledger entry produces at most one lot (§28 — webhook replay cannot
-- double-grant).
create unique index billing_credit_grants_ledger_entry_idx
  on public.billing_credit_grants (ledger_entry_id);

-- The allocator's hot path: spendable lots for an account, in spend order.
-- Expiring soonest first, oldest first within that — `nulls last` is the spend
-- policy itself expressed as an index, so non-expiring purchased Credits are
-- naturally preserved until expiring capacity is exhausted.
create index billing_credit_grants_spend_order_idx
  on public.billing_credit_grants (credit_account_id, expires_at asc nulls last, granted_at asc)
  where status = 'active';

-- The expiry sweep: which lots are due, without scanning history.
create index billing_credit_grants_due_idx
  on public.billing_credit_grants (expires_at)
  where status = 'active' and expires_at is not null;

-- "Was this Stripe payment already granted?" without a ledger scan.
create index billing_credit_grants_external_reference_idx
  on public.billing_credit_grants (external_reference)
  where external_reference is not null;

create index billing_credit_grants_subscription_idx
  on public.billing_credit_grants (subscription_id)
  where subscription_id is not null;

alter table public.billing_credit_grants enable row level security;

create trigger set_updated_at
  before update on public.billing_credit_grants
  for each row execute function public.set_updated_at();

create policy "select own billing_credit_grants"
  on public.billing_credit_grants
  for select using (
    exists (
      select 1
      from public.billing_credit_accounts a
      where a.id = billing_credit_grants.credit_account_id and a.user_id = auth.uid()
    )
  );

-- No insert, update or delete policy, deliberately. A client that could write
-- here could mint Credits, change its own expiry date, or relabel purchased
-- Credits as welcome Credits. The absence of a policy is the enforcement.

-- ---------------------------------------------------------------------
-- billing_credit_allocations
-- Which lot funded which hold, and how much of it was actually spent.
--
-- This is what makes a charge attributable: "70 Credits = 30 Welcome + 40
-- Subscription" is a set of rows, not a recomputation from a policy that may
-- have changed since.
-- ---------------------------------------------------------------------
create table public.billing_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.billing_credit_grants (id) on delete restrict,
  -- Denormalized from the grant so account-scoped reads and RLS do not need a
  -- join through it.
  credit_account_id uuid not null references public.billing_credit_accounts (id) on delete cascade,
  reservation_id uuid not null references public.billing_credit_reservations (id) on delete restrict,

  -- Immutable: what this reservation took from this lot.
  credit_units bigint not null check (credit_units > 0),

  -- Set at settlement: how much of the hold this lot actually funded. The
  -- remainder returns. Null while held.
  --
  -- Recording both figures on one row rather than splitting the row at
  -- settlement is what keeps allocation history immutable in the way that
  -- matters: the held amount is never rewritten, and "held 170, consumed 120"
  -- stays legible forever. It mirrors how a reservation itself already records
  -- `reserved_credits` alongside `settled_credits`.
  consumed_units bigint check (consumed_units is null or consumed_units > 0),

  status text not null default 'held' check (status in ('held', 'consumed', 'released')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  released_at timestamptz,

  -- A lot may never fund more than it was asked to hold.
  constraint billing_credit_allocations_consumed_within_held
    check (consumed_units is null or consumed_units <= credit_units),
  -- Consumed amounts exist if and only if the allocation was consumed.
  constraint billing_credit_allocations_consumed_has_amount
    check ((status = 'consumed') = (consumed_units is not null)),
  constraint billing_credit_allocations_consumed_has_timestamp
    check ((status = 'consumed') = (settled_at is not null)),
  constraint billing_credit_allocations_released_has_timestamp
    check ((status = 'released') = (released_at is not null))
);

comment on table public.billing_credit_allocations is 'Which Credit lot funded which reservation, and how much of it a settlement actually consumed.';
comment on column public.billing_credit_allocations.credit_units is 'Immutable held amount taken from the lot, in integer credit units.';
comment on column public.billing_credit_allocations.consumed_units is 'How much of the hold the settlement charged. Null while held; the remainder returns to the lot.';

-- Settlement and release walk one reservation's allocations.
create index billing_credit_allocations_reservation_idx
  on public.billing_credit_allocations (reservation_id);

-- Reconciling a lot's materialized `allocated_credit_units` against the rows
-- that define it, and the expiry sweep's "does this lot still have a live
-- hold?" question.
create index billing_credit_allocations_grant_status_idx
  on public.billing_credit_allocations (grant_id, status);

create index billing_credit_allocations_account_idx
  on public.billing_credit_allocations (credit_account_id, created_at desc);

alter table public.billing_credit_allocations enable row level security;

create trigger set_updated_at
  before update on public.billing_credit_allocations
  for each row execute function public.set_updated_at();

create policy "select own billing_credit_allocations"
  on public.billing_credit_allocations
  for select using (
    exists (
      select 1
      from public.billing_credit_accounts a
      where a.id = billing_credit_allocations.credit_account_id and a.user_id = auth.uid()
    )
  );

-- No write policies. A client that could release its own allocations could
-- spend the same Credits twice.

-- ---------------------------------------------------------------------
-- billing_stripe_customers
-- One canonical Stripe customer per Vibe billing owner.
--
-- The mapping exists so a browser never needs to name a Stripe customer —
-- ownership is resolved from the authenticated session, and this table is the
-- only place the association lives.
-- ---------------------------------------------------------------------
create table public.billing_stripe_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  stripe_customer_id text not null check (char_length(btrim(stripe_customer_id)) > 0),
  -- Test-mode and live-mode Stripe objects share an id namespace but are
  -- entirely separate worlds. Recording which one a row belongs to is what
  -- stops a test-mode customer from ever being treated as a live one.
  livemode boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_stripe_customers is 'Vibe user to Stripe customer mapping. Stores identifiers only — never payment instruments or card data.';
comment on column public.billing_stripe_customers.livemode is 'Whether this customer belongs to Stripe live mode. Test and live are separate worlds and must never be mixed.';

-- One Stripe customer per Vibe owner per mode.
create unique index billing_stripe_customers_user_mode_idx
  on public.billing_stripe_customers (user_id, livemode);

-- Webhook resolution: a Stripe customer id maps back to exactly one owner.
create unique index billing_stripe_customers_stripe_id_idx
  on public.billing_stripe_customers (stripe_customer_id);

alter table public.billing_stripe_customers enable row level security;

create trigger set_updated_at
  before update on public.billing_stripe_customers
  for each row execute function public.set_updated_at();

create policy "select own billing_stripe_customers"
  on public.billing_stripe_customers
  for select using (user_id = auth.uid());

-- No write policies. A client that could write here could point its Vibe
-- account at somebody else's Stripe customer.

-- ---------------------------------------------------------------------
-- billing_subscriptions
-- A snapshot of the Stripe subscription, for showing a plan and stopping
-- future grants. Never the authority on whether a period was paid.
--
-- The distinction matters: a subscription can sit at status 'active' for a
-- month, so `status = 'active'` is not a reason to grant Credits. A grant
-- follows a paid invoice, and only a paid invoice.
-- ---------------------------------------------------------------------
create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  stripe_subscription_id text not null check (char_length(btrim(stripe_subscription_id)) > 0),
  stripe_customer_id text not null,

  -- Resolved server-side from the approved catalog, never from the browser and
  -- never from a Price id a webhook happened to carry.
  plan_key text not null check (plan_key in ('builder', 'pro')),

  -- Stripe's own lifecycle value, stored as a label for display and for
  -- "should future grants happen?". Not constrained to an enum: Stripe owns
  -- this vocabulary and may extend it, and a CHECK that rejected a new status
  -- would fail a webhook rather than record a fact.
  status text not null,

  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,

  livemode boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_subscriptions is 'Stripe subscription snapshot. Shows the plan and stops future grants; never authorizes one.';
comment on column public.billing_subscriptions.status is 'Stripe lifecycle label. Deliberately unconstrained — Stripe owns this vocabulary.';

create unique index billing_subscriptions_stripe_id_idx
  on public.billing_subscriptions (stripe_subscription_id);

create index billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id, created_at desc);

alter table public.billing_subscriptions enable row level security;

create trigger set_updated_at
  before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();

create policy "select own billing_subscriptions"
  on public.billing_subscriptions
  for select using (user_id = auth.uid());

-- No write policies. A client that could write here could grant itself Pro.

-- ---------------------------------------------------------------------
-- billing_stripe_events
-- Durable external event identity, so a replayed webhook is a no-op.
--
-- Stripe retries. It retries on timeouts, on 500s, and on its own schedule
-- after an outage, and it explicitly does not guarantee ordering. The unique
-- index below is what makes "delivered five times, granted once" a property of
-- the database rather than a claim about the application's control flow.
--
-- Deliberately absent: the event payload. Storing it would duplicate customer
-- and payment data Vibe has no reason to hold, and none of idempotency,
-- debugging or auditability needs it.
-- ---------------------------------------------------------------------
create table public.billing_stripe_events (
  id uuid primary key default gen_random_uuid(),

  stripe_event_id text not null check (char_length(btrim(stripe_event_id)) > 0),
  event_type text not null,
  livemode boolean not null default false,

  status text not null default 'processing'
    check (status in ('processing', 'processed', 'ignored', 'failed')),

  -- A short machine-readable reason. Never a stack trace, never a Stripe
  -- error body, never a signature.
  outcome_reason text,

  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.billing_stripe_events is 'Bounded Stripe event identity for idempotency and debugging. Never stores webhook payloads, signatures or secrets.';
comment on column public.billing_stripe_events.outcome_reason is 'Short machine-readable outcome. Never an error body, a payload or a signature.';

-- The idempotency guarantee (§28). Claiming this row is what admits an event
-- into processing; a retry loses the index and is answered from the existing
-- row instead of re-running the handler.
create unique index billing_stripe_events_stripe_id_idx
  on public.billing_stripe_events (stripe_event_id);

create index billing_stripe_events_received_idx
  on public.billing_stripe_events (received_at desc);

alter table public.billing_stripe_events enable row level security;

create trigger set_updated_at
  before update on public.billing_stripe_events
  for each row execute function public.set_updated_at();

-- No policies at all, deliberately — not even select. This table is Vibe's
-- operational record of its payment provider's traffic; it belongs to no
-- customer and no customer needs to read it.

-- ---------------------------------------------------------------------
-- Reservation → allocation linkage
--
-- Core-1's reservation carries the account-level hold. Core-2 adds the lot
-- breakdown beneath it, so nothing about the atomic admission path changes.
-- ---------------------------------------------------------------------
comment on column public.billing_credit_reservations.reserved_credits is
  'Maximum credit units this operation may consume. Backed by billing_credit_allocations rows naming which lots fund it.';
