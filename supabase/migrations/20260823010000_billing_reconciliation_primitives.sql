-- BILLING RECONCILIATION PRIMITIVES — Sprint B1 of ADR 0041.
-- See docs/decisions/0041-billing-reconciliation-authority.md, §P3
-- "The corrected mechanism" and "Security model".
--
-- Five functions, and nothing else. Three are the shared idempotent
-- materialization primitives the hot path and repair both call —
-- `materialize_ledger_entry`, `materialize_reservation_hold`,
-- `materialize_allocation_capacity`. Two are thin scans over them —
-- `repair_account_balance`, `repair_lot_allocation` — which no longer
-- recompute or overwrite anything; they find rows whose marker is still
-- `NULL` and call the same primitive a hot-path writer would.
--
-- This migration does not wire anything to call these functions. Nothing in
-- `src/` changes, `getBillingBalance` does not call `repair_account_balance`
-- yet (Sprint C), and no hot-path writer calls the `materialize_*`
-- primitives yet (Sprints C/D). Deploying this migration alone has zero
-- effect on any billing behaviour — the functions exist and can be called
-- directly, but nothing does.
--
-- ## Why one idempotent primitive per cache, not a recompute
--
-- The design this migration ships was reached only after a repair-only,
-- recompute-and-overwrite version was proven unsafe (ADR 0041 §P3, first and
-- second revisions): a repair that recomputes a total from every row it can
-- see can fold in a hot-path writer's not-yet-materialized delta, and that
-- writer's own next attempt then re-applies it, with no crash required. The
-- fix removes the question "has this already been applied by someone else"
-- rather than trying to answer it: each function below locks exactly one
-- durable row (one ledger entry; one reservation; one allocation), checks a
-- marker set inside the same transaction as the effect it describes, and is
-- therefore safe to call twice, from any two callers, in any order — the
-- second call always finds the marker set and no-ops.
--
-- ## Why no retry loop
--
-- Every write below is `SET col = col + delta` inside a transaction holding
-- the row lock, not a compare-and-swap. Postgres serializes concurrent
-- writers to one row itself; there is no "lost swap" to retry because there
-- is no swap. `CONTENTION_ATTEMPTS` continues to govern the one hot-path
-- writer this design does not touch, `takeFromLot` — it has no independent
-- durable row for a repair to read separately from its own materialization,
-- proven in ADR 0041 §P3.
--
-- ## Security model (ADR 0041 §P3, "Security model")
--
-- Matches the precedent this schema already set and corrected once for
-- exactly this reason: `execution_specs.sql`'s `reject_execution_spec_mutation`,
-- shipped `SECURITY DEFINER`, corrected in
-- `execution_spec_guard_security_invoker.sql` after `get_advisors --type
-- security` found it reachable by `anon` with no reason to be.
--
-- - `SECURITY INVOKER`, stated explicitly. The only caller is the
--   service-role client (rule 53), which already has full table access
--   directly — there is no lower-privileged caller these functions exist to
--   grant anything to, so `DEFINER` buys nothing and is a real cost when
--   wrong.
-- - `SET search_path = ''`, every reference fully qualified as `public.…`.
-- - No dynamic SQL. Every statement is fixed at definition time; every id is
--   a bound parameter, never interpolated into a query string.
-- - `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated`, granted to
--   `service_role` only, for all five functions, explicitly — Postgres
--   grants `EXECUTE` to `PUBLIC` by default on function creation, and left
--   alone every one of these would be callable over PostgREST's RPC surface
--   by an authenticated or even anonymous browser session.
-- - `supabase get_advisors --type security` is run against this migration
--   before Sprint C/D wire anything to it, the same verification step that
--   caught the precedent's mistake.
--
-- ## What a constraint violation means here, deliberately unhandled
--
-- None of the five functions below catch an exception. If a correction
-- would violate `billing_credit_accounts_available_non_negative` or
-- `billing_credit_grants_capacity_not_exceeded`, the `UPDATE` throws and the
-- whole call aborts — including every row a `repair_*` scan had already
-- materialized earlier in the same call, since the scan's loop and every
-- primitive it calls share the one transaction the top-level call opened.
-- This is deliberate (ADR 0041 invariant I6): a repair never corrects drift
-- it cannot attribute to the rows it scans, and the database's own existing
-- constraints are the enforcement, not application-level judgment.

-- ---------------------------------------------------------------------
-- materialize_ledger_entry — the ledger/posted_credits primitive.
-- ---------------------------------------------------------------------
create or replace function public.materialize_ledger_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_delta bigint;
  v_materialized_at timestamptz;
begin
  select credit_account_id, credit_delta, materialized_at
    into v_account_id, v_delta, v_materialized_at
    from public.billing_credit_ledger
    where id = p_entry_id
    for update;

  if not found then
    raise exception 'materialize_ledger_entry: no ledger entry %', p_entry_id;
  end if;

  if v_materialized_at is not null then
    return;
  end if;

  update public.billing_credit_accounts
    set posted_credits = posted_credits + v_delta
    where id = v_account_id;

  update public.billing_credit_ledger
    set materialized_at = now()
    where id = p_entry_id;
end;
$$;

comment on function public.materialize_ledger_entry(uuid) is
  'Applies one ledger entry''s delta to its account''s posted_credits, exactly once, transactionally with the marker that records it. Called by both postLedgerEntry (hot path) and repair_account_balance (ADR 0041 §P3) — the same function, two triggers, never two mechanisms that could disagree.';

revoke execute on function public.materialize_ledger_entry(uuid) from public, anon, authenticated;
grant execute on function public.materialize_ledger_entry(uuid) to service_role;

-- ---------------------------------------------------------------------
-- materialize_reservation_hold — the reservation/reserved_credits primitive.
-- Two phases on one row: admit (status='active', not yet admitted) and
-- release (terminal, admitted, not yet released). A row that was voided
-- before its admit ever succeeded (store.ts's voidReservation) never passes
-- through the admit branch and never reaches the release branch either,
-- since that branch requires admitted_at already set — nothing is ever
-- subtracted for a hold that was never added.
-- ---------------------------------------------------------------------
create or replace function public.materialize_reservation_hold(p_reservation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_reserved_credits bigint;
  v_status text;
  v_admitted_at timestamptz;
  v_hold_released_at timestamptz;
begin
  select credit_account_id, reserved_credits, status, admitted_at, hold_released_at
    into v_account_id, v_reserved_credits, v_status, v_admitted_at, v_hold_released_at
    from public.billing_credit_reservations
    where id = p_reservation_id
    for update;

  if not found then
    raise exception 'materialize_reservation_hold: no reservation %', p_reservation_id;
  end if;

  if v_status = 'active' and v_admitted_at is null then
    update public.billing_credit_accounts
      set reserved_credits = reserved_credits + v_reserved_credits
      where id = v_account_id;

    update public.billing_credit_reservations
      set admitted_at = now()
      where id = p_reservation_id;

    return;
  end if;

  if v_status in ('settled', 'released', 'expired')
     and v_admitted_at is not null
     and v_hold_released_at is null then
    update public.billing_credit_accounts
      set reserved_credits = reserved_credits - v_reserved_credits
      where id = v_account_id;

    update public.billing_credit_reservations
      set hold_released_at = now()
      where id = p_reservation_id;

    return;
  end if;

  -- Nothing pending for this row's current phase: already materialized, or
  -- never admitted in the first place. Idempotent no-op either way.
end;
$$;

comment on function public.materialize_reservation_hold(uuid) is
  'Applies whichever of a reservation''s two phases (admit, release) is currently pending to its account''s reserved_credits, exactly once per phase, transactionally with the marker. Called by both claimReservation/closeReservation (hot path) and repair_account_balance (ADR 0041 §P3).';

revoke execute on function public.materialize_reservation_hold(uuid) from public, anon, authenticated;
grant execute on function public.materialize_reservation_hold(uuid) to service_role;

-- ---------------------------------------------------------------------
-- materialize_allocation_capacity — the allocation/lot-capacity primitive.
-- Only the return direction; takeFromLot has no equivalent gap (ADR 0041
-- §P3) because it materializes before the allocation row that would record
-- it separately even exists, so there is nothing for this primitive to
-- catch up on the take side.
-- ---------------------------------------------------------------------
create or replace function public.materialize_allocation_capacity(p_allocation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_credit_units bigint;
  v_consumed_units bigint;
  v_status text;
  v_capacity_materialized_at timestamptz;
  v_returned_units bigint;
begin
  select grant_id, credit_units, consumed_units, status, capacity_materialized_at
    into v_grant_id, v_credit_units, v_consumed_units, v_status, v_capacity_materialized_at
    from public.billing_credit_allocations
    where id = p_allocation_id
    for update;

  if not found then
    raise exception 'materialize_allocation_capacity: no allocation %', p_allocation_id;
  end if;

  if v_status not in ('consumed', 'released') then
    return; -- still held; nothing resolved to materialize yet
  end if;

  if v_capacity_materialized_at is not null then
    return;
  end if;

  v_returned_units := v_credit_units - coalesce(v_consumed_units, 0);

  if v_returned_units > 0 then
    update public.billing_credit_grants
      set allocated_credit_units = allocated_credit_units - v_returned_units
      where id = v_grant_id;
  end if;

  update public.billing_credit_allocations
    set capacity_materialized_at = now()
    where id = p_allocation_id;
end;
$$;

comment on function public.materialize_allocation_capacity(uuid) is
  'Returns an allocation''s unconsumed capacity to its lot''s allocated_credit_units, exactly once, transactionally with the marker. Called by both settleReservationAllocations/releaseReservationAllocations (hot path) and repair_lot_allocation (ADR 0041 §P3).';

revoke execute on function public.materialize_allocation_capacity(uuid) from public, anon, authenticated;
grant execute on function public.materialize_allocation_capacity(uuid) to service_role;

-- ---------------------------------------------------------------------
-- repair_account_balance — scan-and-delegate, account side. No recompute:
-- finds ledger entries and reservation phases still marked NULL for this
-- account and materializes each through the same primitive the hot path
-- uses. Idempotent by construction of what it calls; a repeat call against
-- an already-consistent account finds nothing pending and does nothing.
-- ---------------------------------------------------------------------
create or replace function public.repair_account_balance(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry record;
  v_reservation record;
begin
  for v_entry in
    select id
    from public.billing_credit_ledger
    where credit_account_id = p_account_id
      and materialized_at is null
    order by created_at
  loop
    perform public.materialize_ledger_entry(v_entry.id);
  end loop;

  for v_reservation in
    select id
    from public.billing_credit_reservations
    where credit_account_id = p_account_id
      and (
        (status = 'active' and admitted_at is null)
        or (status in ('settled', 'released', 'expired')
            and admitted_at is not null
            and hold_released_at is null)
      )
    order by created_at
  loop
    perform public.materialize_reservation_hold(v_reservation.id);
  end loop;
end;
$$;

comment on function public.repair_account_balance(uuid) is
  'Catches up every ledger entry and reservation phase still unmaterialized for one account, via materialize_ledger_entry/materialize_reservation_hold — never recomputes or overwrites posted_credits/reserved_credits directly (ADR 0041 §P3). Called from getBillingBalance on detected drift, gated behind BILLING_REPAIR_ENABLED (ADR 0041 §P3 Rollout) — not wired yet (Sprint C).';

revoke execute on function public.repair_account_balance(uuid) from public, anon, authenticated;
grant execute on function public.repair_account_balance(uuid) to service_role;

-- ---------------------------------------------------------------------
-- repair_lot_allocation — scan-and-delegate, lot side.
-- ---------------------------------------------------------------------
create or replace function public.repair_lot_allocation(p_grant_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allocation record;
begin
  for v_allocation in
    select id
    from public.billing_credit_allocations
    where grant_id = p_grant_id
      and status in ('consumed', 'released')
      and capacity_materialized_at is null
    order by created_at
  loop
    perform public.materialize_allocation_capacity(v_allocation.id);
  end loop;
end;
$$;

comment on function public.repair_lot_allocation(uuid) is
  'Catches up every allocation still unmaterialized for one lot, via materialize_allocation_capacity — never recomputes or overwrites allocated_credit_units directly (ADR 0041 §P3). Not wired yet (Sprint D) — gated behind BILLING_REPAIR_ENABLED once it is.';

revoke execute on function public.repair_lot_allocation(uuid) from public, anon, authenticated;
grant execute on function public.repair_lot_allocation(uuid) to service_role;
