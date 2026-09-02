-- What a lot's allocation rows actually occupy, summed in the database
-- (PERF-018's correctness half).
--
-- ## The read this replaces, and why deleting rows would not have fixed it
--
-- `listAllocationsForGrants` transferred **every** allocation row for every lot
-- an account has ever held, on every render of the billing page, so that
-- `reconcileLotAllocation` could add them up in JavaScript. Behind
-- `max_rows = 1000` that read truncates without an error, and the consequence
-- is not a slow page:
--
--   * `expected` comes out too low, so `drift` is positive and **fabricated**
--   * the operator gets "a lot's materialized allocation disagrees with its
--     allocation rows" — an alert that would fire on every visit and mean
--     nothing, which is how real alerts stop being read
--   * a `credit_drift.detected` audit event records a drift that does not exist
--   * with `BILLING_REPAIR_ENABLED`, a service-role repair runs for nothing,
--     and the re-check against the same truncated list fails again as
--     `credit_drift.repair_failed`
--
-- The balance itself was never at risk: `repair_lot_allocation` re-derives
-- inside the database and never overwrites `allocated_credit_units` (ADR 0041
-- §P3), so the damage is a false alarm rather than wrong money.
--
-- [ADR 0068](../../docs/decisions/0068-retention-periods.md) §1 is the rule
-- being followed here, and it is deliberately independent of retention: a read
-- that depends on completeness must aggregate or paginate **whatever the row
-- limit is**, because deleting old rows only moves the date the read starts
-- being wrong.
--
-- ## Why a function rather than a PostgREST aggregate
--
-- This project's PostgREST refuses them — measured in
-- `20260828163645_sum_ledger_deltas.sql`:
--
--     GET /rest/v1/...?select=credit_units.sum()
--     {"code":"PGRST123","message":"Use of aggregate functions is not allowed"}
--
-- ## The occupancy rule now lives here and nowhere else
--
-- A live hold occupies its full held amount; a consumed allocation occupies
-- only what it actually charged; a released one occupies nothing. That rule was
-- a `if/if/return` in `reconcileLotAllocation` and is now this CASE. It is
-- stated once: the caller receives a number, so there is no second copy in
-- TypeScript to disagree with this one.
--
-- **The `coalesce` on `consumed_units` is unreachable**, and saying so is the
-- point. `billing_credit_allocations_consumed_has_amount` is a biconditional —
-- `status = 'consumed'` *equals* `consumed_units is not null` — so a consumed
-- row without a charge is refused at INSERT, which `lot-capacity.migration.ts`
-- asserts rather than assumes. It is kept because it mirrors the `?? ZERO` this
-- replaced and costs nothing, and because a CASE returning null for one row
-- would make the whole lot's sum null, which the caller reads as "occupies
-- nothing" for a lot that is fully allocated. A comment claiming it guards a
-- reachable case would be false. `supabase/tests/lot-capacity.migration.ts`
-- proves the arithmetic against a real cluster, which is what makes the fake
-- client's handler trustworthy rather than a second implementation nobody
-- checked.
--
-- ## Security model
--
-- `SECURITY INVOKER`, following `sum_ledger_deltas`: RLS decides which
-- allocations are visible, exactly as it does for a direct select, so this
-- cannot become a way to read across accounts. A grant is not sufficient
-- authority here and is not treated as one.

create or replace function public.sum_lot_allocation_capacity(p_grant_ids uuid[])
returns table (grant_id uuid, occupied_units bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select allocation.grant_id,
         coalesce(
           sum(
             case allocation.status
               when 'held' then allocation.credit_units
               when 'consumed' then coalesce(allocation.consumed_units, 0)
               else 0
             end
           ),
           0
         )::bigint
    from public.billing_credit_allocations allocation
   where allocation.grant_id = any (p_grant_ids)
   group by allocation.grant_id;
$$;

comment on function public.sum_lot_allocation_capacity(uuid[]) is
  'What each lot''s allocation rows occupy, summed in the database rather than by transferring every row (PERF-018). held → credit_units, consumed → consumed_units, released → nothing. SECURITY INVOKER: RLS decides which allocations are visible, exactly as it does for a direct select.';

revoke execute on function public.sum_lot_allocation_capacity(uuid[]) from public, anon;
grant execute on function public.sum_lot_allocation_capacity(uuid[]) to authenticated, service_role;
