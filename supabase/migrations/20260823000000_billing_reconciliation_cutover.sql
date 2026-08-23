-- BILLING RECONCILIATION CUTOVER — Sprint B0 of ADR 0041.
-- See docs/decisions/0041-billing-reconciliation-authority.md, §P3 "Rollout".
--
-- This migration does exactly three things, in one transaction, and nothing
-- else: it locks the five tables a reconciliation formula reads or writes;
-- it certifies, against that now-closed snapshot, that no account or lot is
-- currently drifted; and it adds four nullable marker columns, backfilled
-- for every existing row, phase-aware. It does NOT add the five
-- `materialize_*`/`repair_*` functions (§P3, "The corrected mechanism") —
-- those are Sprint B1, reviewed and shipped separately, because a function
-- that will sit on the money-moving hot path deserves scrutiny this
-- migration's own certification logic does not.
--
-- ## Why locking is not optional here
--
-- Under READ COMMITTED (the default), two separate reads inside one
-- transaction each see a fresh snapshot as of that statement, not one
-- snapshot for the whole transaction. Certifying "no drift" against two
-- unlocked reads admits a writer committing in between — a false pass this
-- migration must not be capable of producing. The lock modes below are
-- derived from what actually writes each table (ADR 0041, §P3 Rollout):
-- `share` is the weakest mode that blocks every `UPDATE`/`INSERT` a
-- hot-path writer issues; `access exclusive` on the three tables gaining a
-- column is not a choice — Postgres's own `ADD COLUMN` requires it, held
-- for the rest of this transaction regardless of what a writer alone would
-- have needed.
--
-- Fixed order (`accounts` → `ledger` → `reservations` → `grants` →
-- `allocations`), each with `NOWAIT`: this migration fails closed. An
-- unobtainable lock raises immediately and the whole transaction rolls
-- back — it does not hang, and it does not proceed unlocked.
--
-- ## Why a bare backfill would be unsafe
--
-- `ADD COLUMN ... materialized_at` with no backfill leaves every historical
-- row `NULL` — indistinguishable, to a repair scan built later, from a row
-- genuinely awaiting materialization. But a *blanket* "mark everything
-- materialized" is the opposite hazard: `credits/store.ts`'s
-- `MaterializationError` already proves a ledger row can be genuinely
-- unmaterialized in production today (a past `CONTENTION_ATTEMPTS`
-- exhaustion nobody has repaired, because nothing could). Backfilling that
-- row's marker to non-null would make it permanently unrepairable rather
-- than fixing it. So the backfill below only runs once the certification
-- below has passed for every account and lot — never unconditionally.
--
-- ## No data migration otherwise
--
-- Every new column starts `NULL` and is backfilled in place below; no
-- existing ledger, reservation, allocation, account or lot row is
-- reinterpreted retroactively beyond that. This migration is additive: it
-- drops nothing, renames nothing, and changes no existing constraint. Old
-- application code, which selects its columns by name throughout
-- (`credits/store.ts`, `credits/lot-store.ts`), cannot even see the four
-- new columns and continues to operate exactly as it does today —
-- indifferent to this migration, not broken by it (ADR 0041, §P3 Rollout,
-- "Rollback").
--
-- ## What this migration is not
--
-- It does not enable repair. `repair_account_balance`/`repair_lot_allocation`
-- do not exist yet (Sprint B1), and even once they do, nothing calls them
-- until an operator sets `BILLING_REPAIR_ENABLED` after independently
-- verifying both mechanical drain conditions in ADR 0041 §P3 Rollout, R3 —
-- this migration changes no application behaviour and authorizes nothing.

-- ---------------------------------------------------------------------
-- Locks, in one fixed order, all NOWAIT — fail closed rather than hang or
-- proceed against an open snapshot.
-- ---------------------------------------------------------------------
lock table public.billing_credit_accounts     in share mode nowait;
lock table public.billing_credit_ledger       in access exclusive mode nowait;
lock table public.billing_credit_reservations in access exclusive mode nowait;
lock table public.billing_credit_grants       in share mode nowait;
lock table public.billing_credit_allocations  in access exclusive mode nowait;

-- ---------------------------------------------------------------------
-- Certification, against the snapshot the locks above just closed.
--
-- Mirrors src/modules/credits/balance.ts's reconcileBalance and
-- src/modules/credits/lots.ts's reconcileLotAllocation exactly:
--   posted_credits   = SUM(credit_delta) over every ledger entry for the account
--   reserved_credits = SUM(reserved_credits) over active reservations for the account
--   allocated_credit_units = SUM(held credit_units, or consumed_units where
--                            consumed, 0 where released) over a grant's allocations
--
-- Any account or lot that disagrees aborts the whole transaction. There is
-- no automated repairer at this point in the rollout — this migration
-- exists specifically to make one safe to build — so a failure here is a
-- manual, pre-migration remediation, not something to proceed around.
-- ---------------------------------------------------------------------
do $$
declare
  v_drifted_accounts bigint;
  v_drifted_grants bigint;
begin
  select count(*) into v_drifted_accounts
  from public.billing_credit_accounts a
  where a.posted_credits <> coalesce((
      select sum(l.credit_delta)
      from public.billing_credit_ledger l
      where l.credit_account_id = a.id
    ), 0)
     or a.reserved_credits <> coalesce((
      select sum(r.reserved_credits)
      from public.billing_credit_reservations r
      where r.credit_account_id = a.id and r.status = 'active'
    ), 0);

  if v_drifted_accounts > 0 then
    raise exception
      'billing_reconciliation_cutover: % account(s) are currently drifted (posted_credits/reserved_credits disagree with billing_credit_ledger/billing_credit_reservations) — resolve manually before this migration proceeds. See ADR 0041, §P3 Rollout, R1.',
      v_drifted_accounts;
  end if;

  select count(*) into v_drifted_grants
  from public.billing_credit_grants g
  where g.allocated_credit_units <> coalesce((
      select sum(
        case
          when al.status = 'held' then al.credit_units
          when al.status = 'consumed' then coalesce(al.consumed_units, 0)
          else 0
        end
      )
      from public.billing_credit_allocations al
      where al.grant_id = g.id
    ), 0);

  if v_drifted_grants > 0 then
    raise exception
      'billing_reconciliation_cutover: % lot(s) are currently drifted (allocated_credit_units disagrees with billing_credit_allocations) — resolve manually before this migration proceeds. See ADR 0041, §P3 Rollout, R1.',
      v_drifted_grants;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- The four marker columns. Nullable, no default beyond NULL — the backfill
-- below sets every value explicitly rather than relying on a column-level
-- DEFAULT, which cannot express the phase-conditional values existing rows
-- need (ADR 0041, §P3 Rollout, R1).
-- ---------------------------------------------------------------------
alter table public.billing_credit_ledger
  add column materialized_at timestamptz;

comment on column public.billing_credit_ledger.materialized_at is
  'Set only inside materialize_ledger_entry (ADR 0041 §P3, Sprint B1), transactionally with the posted_credits delta it describes. NULL means this entry''s effect has not yet been folded into the cache — the only signal repair may act on, and only once BILLING_REPAIR_ENABLED is set (ADR 0041 §P3 Rollout, R3).';

alter table public.billing_credit_reservations
  add column admitted_at timestamptz,
  add column hold_released_at timestamptz;

comment on column public.billing_credit_reservations.admitted_at is
  'Set only inside materialize_reservation_hold (ADR 0041 §P3, Sprint B1) when this reservation''s admit is folded into reserved_credits.';
comment on column public.billing_credit_reservations.hold_released_at is
  'Set only inside materialize_reservation_hold (ADR 0041 §P3, Sprint B1) when this reservation''s release is folded into reserved_credits. NULL while active, by design.';

alter table public.billing_credit_allocations
  add column capacity_materialized_at timestamptz;

comment on column public.billing_credit_allocations.capacity_materialized_at is
  'Set only inside materialize_allocation_capacity (ADR 0041 §P3, Sprint B1) when this allocation''s return is folded into the lot''s allocated_credit_units. NULL while held, by design.';

-- ---------------------------------------------------------------------
-- Backfill, phase-aware, only reached because certification above passed.
--
-- Every ledger row is an already-resolved fact under the pre-0041 protocol
-- (postLedgerEntry always materialized synchronously, or this migration
-- would have aborted above) — unconditional.
--
-- Reservations and allocations are two-phase. A row still in its first
-- phase (an active reservation; a held allocation) correctly gets only the
-- marker for the phase it has actually resolved, leaving the other NULL —
-- that NULL is not a defect the backfill missed, it is the true state: that
-- phase genuinely has not happened yet.
-- ---------------------------------------------------------------------
update public.billing_credit_ledger
set materialized_at = created_at
where materialized_at is null;

update public.billing_credit_reservations
set admitted_at = created_at
where admitted_at is null;

update public.billing_credit_reservations
set hold_released_at = coalesce(settled_at, released_at)
where status in ('settled', 'released', 'expired')
  and hold_released_at is null;

update public.billing_credit_allocations
set capacity_materialized_at = coalesce(settled_at, released_at)
where status in ('consumed', 'released')
  and capacity_materialized_at is null;
