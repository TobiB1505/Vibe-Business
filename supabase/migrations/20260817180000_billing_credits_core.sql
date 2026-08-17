-- BILLING CORE-1: Vibe Credits, usage ledger, reservations and quotes.
-- See docs/sprints/0037-billing-core1-credits-ledger.md.
--
-- The customer-facing economic layer. Vibe already measures what providers
-- charge it — `ai_usage_events` for inference, `deep_scan_provider_usage`,
-- `sandbox_usage_events` and `review_browser_usage` for the rest — and each of
-- those stays authoritative for its own domain. Nothing here replaces them;
-- `billing_usage_events` is a normalized projection that references them.
--
-- ## Shadow mode
--
-- Nothing in this migration gates an existing workflow. No balance is required
-- to run an audit, a Deep Scan, the Opportunity engine or the Planner today,
-- and no customer is charged. These tables record, normalize and rate; the
-- enforcement seam (`src/modules/operations/service.ts`, where the audit
-- entitlement is already checked) is deliberately untouched.
--
-- ## Deliberately absent
--
-- Prompt text, model responses, reasoning, source code, screenshots, browser
-- content, credentials, payment instruments, and any copy of the provider
-- token counts that already live in the canonical ledgers. Billing stores an
-- amount, a reference and an identity — never the content that produced them.
--
-- ## Credit units
--
-- Every credit column is `bigint` holding **integer credit units**, where one
-- displayed Vibe Credit is 1000 units (three decimal places). Floats are never
-- used for balances; see src/modules/credits/units.ts. Provider cost stays in
-- integer nanodollars to match src/modules/ai/pricing.ts exactly.

-- ---------------------------------------------------------------------
-- billing_credit_accounts
-- One credit wallet per owner. Carries the materialized balance the atomic
-- reservation primitive depends on (§8, §10, §12).
-- ---------------------------------------------------------------------
create table public.billing_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),

  -- Materialized from public.billing_credit_ledger. Kept on the row because a
  -- reservation must be admitted by a single atomic statement, and a sum over
  -- history cannot be locked. src/modules/credits/balance.ts reconciles both
  -- figures against the ledger, so the cache can be proven rather than trusted.
  posted_credits bigint not null default 0,
  -- Sum of currently active reservations. Never a posted debit (§9).
  reserved_credits bigint not null default 0 check (reserved_credits >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The reservation invariant, enforced by the database rather than only by the
  -- application (§12, §47). A conditional UPDATE is what admits a reservation;
  -- this constraint is the backstop that makes an overspend impossible even if
  -- that predicate were ever written wrong.
  constraint billing_credit_accounts_available_non_negative
    check (posted_credits - reserved_credits >= 0)
);

comment on table public.billing_credit_accounts is 'One Vibe Credit wallet per user. Never stores payment instruments or provider identifiers.';
comment on column public.billing_credit_accounts.posted_credits is 'Materialized sum of billing_credit_ledger deltas, in integer credit units (1000 = 1 Credit).';
comment on column public.billing_credit_accounts.reserved_credits is 'Sum of active reservations. A hold, never a posted charge.';

-- One wallet per owner (§8). A second account would split a balance in two and
-- make "available" unanswerable.
create unique index billing_credit_accounts_user_idx
  on public.billing_credit_accounts (user_id);

alter table public.billing_credit_accounts enable row level security;

create trigger set_updated_at
  before update on public.billing_credit_accounts
  for each row execute function public.set_updated_at();

create policy "select own billing_credit_accounts"
  on public.billing_credit_accounts
  for select using (user_id = auth.uid());

-- No insert, update or delete policy, deliberately. A client that could write
-- here could mint Credits (§31). Every financial write goes through the
-- service role, exactly as free_audit_grants already does — the absence of a
-- policy is the enforcement.

-- ---------------------------------------------------------------------
-- billing_credit_ledger
-- Append-only posted balance changes. The reconstructable source of truth (§9).
-- ---------------------------------------------------------------------
create table public.billing_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null references public.billing_credit_accounts (id) on delete cascade,

  kind text not null check (kind in ('grant', 'purchase', 'charge', 'refund', 'adjustment')),

  -- Signed, in credit units. Never zero: an entry that changes nothing is a
  -- mistake, not a record (§47).
  credit_delta bigint not null check (credit_delta <> 0),

  -- What this entry is about. All nullable because a grant has no reservation
  -- and an adjustment may have neither.
  project_id uuid references public.projects (id) on delete set null,
  operation_run_id uuid,
  reservation_id uuid,
  -- A refund names the charge it compensates (§30). Self-referencing rather
  -- than a separate table: a refund *is* a ledger entry.
  refunds_ledger_entry_id uuid references public.billing_credit_ledger (id) on delete restrict,

  -- The Credit policy that produced a charge, pinned so history never re-rates
  -- under a future card (§22).
  rate_card_version text,

  -- Why an adjustment exists. Required for adjustments (§31).
  reason text,

  -- Exactly-once guarantee (§26). Two attempts carrying the same key produce
  -- one entry, enforced here rather than only in the application.
  idempotency_key text not null check (char_length(btrim(idempotency_key)) > 0),

  created_at timestamptz not null default now(),

  -- Sign follows kind (§9). A positive charge or a negative grant is a bug,
  -- and the database says so independently of TypeScript.
  constraint billing_credit_ledger_sign_matches_kind check (
    (kind = 'charge' and credit_delta < 0)
    or (kind in ('grant', 'purchase', 'refund') and credit_delta > 0)
    or kind = 'adjustment'
  ),
  -- A refund must name what it refunds; nothing else may.
  constraint billing_credit_ledger_refund_references_charge check (
    (kind = 'refund') = (refunds_ledger_entry_id is not null)
  ),
  -- A manual correction always carries a stated reason (§31).
  constraint billing_credit_ledger_adjustment_has_reason check (
    kind <> 'adjustment' or char_length(btrim(coalesce(reason, ''))) > 0
  )
);

comment on table public.billing_credit_ledger is 'Append-only Vibe Credit ledger. Never updated or deleted; corrections are compensating entries.';
comment on column public.billing_credit_ledger.credit_delta is 'Signed change in integer credit units. Negative only for a charge.';
comment on column public.billing_credit_ledger.idempotency_key is 'Durable identity so a retried financial write posts once (§26).';

-- The exactly-once guarantee (§26, §49).
create unique index billing_credit_ledger_idempotency_idx
  on public.billing_credit_ledger (credit_account_id, idempotency_key);

-- Balance reconstruction and statement reads.
create index billing_credit_ledger_account_created_idx
  on public.billing_credit_ledger (credit_account_id, created_at desc);

-- Refund cap lookup: how much of one charge has already been returned.
create index billing_credit_ledger_refunds_idx
  on public.billing_credit_ledger (refunds_ledger_entry_id)
  where refunds_ledger_entry_id is not null;

-- "What did this operation cost?" without scanning the ledger.
create index billing_credit_ledger_operation_idx
  on public.billing_credit_ledger (operation_run_id)
  where operation_run_id is not null;

alter table public.billing_credit_ledger enable row level security;

create policy "select own billing_credit_ledger"
  on public.billing_credit_ledger
  for select using (
    exists (
      select 1
      from public.billing_credit_accounts a
      where a.id = billing_credit_ledger.credit_account_id and a.user_id = auth.uid()
    )
  );

-- No insert, update or delete policy, deliberately. Append-only by omission,
-- the same posture as audit_events — and here it is also what stops a browser
-- from writing itself a grant.

-- ---------------------------------------------------------------------
-- billing_credit_reservations
-- Credits held against a maximum before variable-cost work runs (§11).
-- ---------------------------------------------------------------------
create table public.billing_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null references public.billing_credit_accounts (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,

  -- The operation this hold is for. Not a foreign key, for the reason
  -- ai_usage_events gives for job_id: the financial record must outlive the
  -- job it paid for, because deleting a run does not undo a charge.
  operation_run_id uuid,
  quote_id uuid,

  reserved_credits bigint not null check (reserved_credits > 0),

  status text not null default 'active'
    check (status in ('active', 'settled', 'released', 'expired')),

  -- Set on settlement: what was actually charged, and by which policy.
  settled_credits bigint check (settled_credits is null or settled_credits >= 0),
  rate_card_version text,
  -- Why a hold was given back. 'abandoned_with_usage' records that real
  -- provider spend happened and the commercial question is still open (§29).
  -- Nullable while the reservation is active: a CHECK is satisfied when its
  -- expression is NULL, so this permits "not released yet" without an
  -- `is null or` disjunction that would read as a second rule.
  release_reason text check (
    release_reason in ('cancelled_before_usage', 'failed_without_usage', 'abandoned_with_usage', 'expired')
  ),

  idempotency_key text not null check (char_length(btrim(idempotency_key)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  settled_at timestamptz,
  released_at timestamptz,

  -- Each terminal state carries its own timestamp, and only its own (§47).
  constraint billing_credit_reservations_settled_has_timestamp
    check ((status = 'settled') = (settled_at is not null)),
  constraint billing_credit_reservations_released_has_timestamp
    check ((status in ('released', 'expired')) = (released_at is not null)),
  -- A settlement records what it charged; nothing else may claim to have.
  constraint billing_credit_reservations_settled_has_amount
    check ((status = 'settled') = (settled_credits is not null)),
  -- The ceiling the customer approved is never silently exceeded (§28).
  constraint billing_credit_reservations_settled_within_reserved
    check (settled_credits is null or settled_credits <= reserved_credits)
);

comment on table public.billing_credit_reservations is 'Credit holds. A reservation is never a posted charge; settlement writes the charge to billing_credit_ledger.';
comment on column public.billing_credit_reservations.reserved_credits is 'Maximum credit units this operation may consume, in integer credit units.';

-- Retrying a reservation request must not create a second hold (§49).
create unique index billing_credit_reservations_idempotency_idx
  on public.billing_credit_reservations (credit_account_id, idempotency_key);

-- Summing active holds, and the reconciliation that proves reserved_credits.
create index billing_credit_reservations_active_idx
  on public.billing_credit_reservations (credit_account_id, status)
  where status = 'active';

-- At most one active hold per operation. A second concurrent start for the
-- same run loses here, exactly as operation_runs_single_active_idx does for
-- the run itself.
create unique index billing_credit_reservations_single_active_operation_idx
  on public.billing_credit_reservations (operation_run_id)
  where operation_run_id is not null and status = 'active';

alter table public.billing_credit_reservations enable row level security;

create trigger set_updated_at
  before update on public.billing_credit_reservations
  for each row execute function public.set_updated_at();

create policy "select own billing_credit_reservations"
  on public.billing_credit_reservations
  for select using (
    exists (
      select 1
      from public.billing_credit_accounts a
      where a.id = billing_credit_reservations.credit_account_id and a.user_id = auth.uid()
    )
  );

-- No write policies. A client that could release its own reservation could
-- spend past its balance.

-- ---------------------------------------------------------------------
-- billing_credit_quotes
-- What an operation is estimated to cost, and its ceiling, before it starts (§14).
-- ---------------------------------------------------------------------
create table public.billing_credit_quotes (
  id uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null references public.billing_credit_accounts (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,

  operation_type text not null check (char_length(btrim(operation_type)) > 0),
  operation_run_id uuid,

  estimated_credits bigint not null check (estimated_credits >= 0),
  maximum_credits bigint not null check (maximum_credits > 0),

  -- The policy the estimate was produced under, so an accepted quote can be
  -- explained later even after the card changes.
  rate_card_version text,
  -- What the estimate assumed, as bounded derived facts only — never a prompt,
  -- never model output.
  assumptions jsonb not null default '{}'::jsonb,

  status text not null default 'open'
    check (status in ('open', 'accepted', 'expired', 'superseded')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,

  -- An estimate above its own ceiling is incoherent (§47).
  constraint billing_credit_quotes_maximum_covers_estimate
    check (maximum_credits >= estimated_credits)
);

comment on table public.billing_credit_quotes is 'Pre-operation Credit estimates and ceilings. A quote authorizes nothing; a reservation does.';
comment on column public.billing_credit_quotes.maximum_credits is 'The ceiling a customer would approve. Settlement may never exceed it silently.';

create index billing_credit_quotes_account_created_idx
  on public.billing_credit_quotes (credit_account_id, created_at desc);

alter table public.billing_credit_quotes enable row level security;

create trigger set_updated_at
  before update on public.billing_credit_quotes
  for each row execute function public.set_updated_at();

create policy "select own billing_credit_quotes"
  on public.billing_credit_quotes
  for select using (
    exists (
      select 1
      from public.billing_credit_accounts a
      where a.id = billing_credit_quotes.credit_account_id and a.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- billing_usage_events
-- Provider-neutral normalized usage, projected from the canonical ledgers (§16).
-- ---------------------------------------------------------------------
create table public.billing_usage_events (
  id uuid primary key default gen_random_uuid(),

  -- Which canonical ledger this projects, and the row within it. Not a foreign
  -- key: the source tables are per-domain and one of them may be pruned
  -- without invalidating the economic record.
  source_kind text not null check (
    source_kind in ('ai_usage_event', 'deep_scan_provider_usage', 'sandbox_usage_event', 'review_browser_usage')
  ),
  source_id uuid not null,

  project_id uuid not null references public.projects (id) on delete cascade,
  -- The economic owner, resolved through project ownership — never supplied by
  -- a caller (§55, §56).
  user_id uuid not null references auth.users (id) on delete cascade,
  operation_run_id uuid,

  provider text not null check (char_length(btrim(provider)) > 0),
  sku text not null check (
    sku in (
      'anthropic_input_tokens', 'anthropic_output_tokens', 'anthropic_thinking_tokens',
      'browser_duration_ms', 'sandbox_duration_ms', 'sandbox_active_cpu_ms',
      'sandbox_ingress_bytes', 'sandbox_egress_bytes'
    )
  ),
  quantity bigint not null check (quantity >= 0),

  -- Integer nanodollars, matching src/modules/ai/pricing.ts exactly so the two
  -- layers can be reconciled without a unit conversion (§69).
  raw_cost_nano_usd bigint check (raw_cost_nano_usd is null or raw_cost_nano_usd >= 0),
  -- Unknown is not zero (§18). Three of Vibe's four provider ledgers report no
  -- price at all, and this column is what stops that becoming "free".
  cost_status text not null check (
    cost_status in ('costed', 'cost_unknown', 'rate_unavailable', 'not_billable')
  ),
  provider_pricing_version text,

  -- Customer rating, separate from provider cost (§20). Null credits with a
  -- status of 'rate_card_not_configured' is the honest steady state of Core 1.
  rating_status text not null default 'rate_card_not_configured' check (
    rating_status in ('rated', 'rate_card_not_configured', 'sku_not_priced', 'not_rateable')
  ),
  rated_credits bigint check (rated_credits is null or rated_credits >= 0),
  rate_card_version text,

  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  -- A price and its provenance travel together, in both directions.
  constraint billing_usage_events_costed_has_amount
    check ((cost_status = 'costed') = (raw_cost_nano_usd is not null)),
  -- Rated credits exist if and only if the usage was actually rated (§18).
  -- This is what makes "unknown became zero" unrepresentable rather than
  -- merely discouraged.
  constraint billing_usage_events_rated_has_credits
    check ((rating_status = 'rated') = (rated_credits is not null)),
  constraint billing_usage_events_rated_has_card
    check (rating_status <> 'rated' or rate_card_version is not null)
);

comment on table public.billing_usage_events is 'Normalized provider-neutral usage projected from the canonical provider ledgers. Never stores prompts, responses, code or credentials.';
comment on column public.billing_usage_events.cost_status is 'Whether Vibe knows its own cost. cost_unknown must never be summed as zero.';
comment on column public.billing_usage_events.rated_credits is 'Customer Credit rating in integer credit units, or null when not rated.';

-- Reconciliation idempotency (§43, §49). Running the backfill twice creates no
-- duplicate rows, because one source row projects to one event per SKU.
create unique index billing_usage_events_source_sku_idx
  on public.billing_usage_events (source_kind, source_id, sku);

-- Per-operation aggregation: many usage events belong to one economic
-- operation, which is the whole point for a future agent run (§62, §63).
create index billing_usage_events_operation_idx
  on public.billing_usage_events (operation_run_id)
  where operation_run_id is not null;

create index billing_usage_events_project_occurred_idx
  on public.billing_usage_events (project_id, occurred_at desc);

-- Calibration reporting: "what is still unpriced?" without a full scan.
create index billing_usage_events_cost_status_idx
  on public.billing_usage_events (cost_status, occurred_at desc);

alter table public.billing_usage_events enable row level security;

create policy "select own billing_usage_events"
  on public.billing_usage_events
  for select using (
    exists (select 1 from public.projects p where p.id = billing_usage_events.project_id and p.user_id = auth.uid())
  );

-- No write policies. Usage is projected by trusted server code from ledgers
-- the client cannot write either.
