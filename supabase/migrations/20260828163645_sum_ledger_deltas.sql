-- Sum one credit account's ledger in the database (VB-025).
--
-- ## The read this exists to bound
--
-- `listLedgerEntries` transferred **every** ledger entry an account has ever
-- had, on every render of the billing page, and it did so for two unrelated
-- reasons: to show the last handful of movements, and to re-derive the posted
-- balance so the materialized figure on the account row can be checked against
-- the history that defines it (ADR 0041 §P3).
--
-- The first wants a page's worth. The second wants a single number over all of
-- it — and capping the read to serve the first would make the second report
-- drift that does not exist, on an account old enough to have more entries than
-- the cap. A false drift is not a cosmetic defect: with
-- `BILLING_REPAIR_ENABLED`, it triggers a repair.
--
-- So the sum moves to where the rows are, and the display read gets its cap.
--
-- ## Why a function rather than a PostgREST aggregate
--
-- Because this project's PostgREST refuses them. Measured rather than assumed:
--
--     GET /rest/v1/billing_credit_ledger?select=credit_delta.sum()
--     {"code":"PGRST123","message":"Use of aggregate functions is not allowed"}
--
-- ## Security model
--
-- `SECURITY INVOKER`, stated explicitly, following the precedent
-- `execution_spec_guard_security_invoker.sql` set after a `DEFINER` function
-- was found reachable by `anon` with no reason to be. There is no lower
-- privileged caller this exists to grant anything to: `authenticated` already
-- holds SELECT on the table, and `select own billing_credit_ledger` already
-- decides which rows that means. This function moves an aggregation to the
-- database; it must not move an authority there.
--
-- `SET search_path = ''` with every reference qualified. No dynamic SQL.
--
-- ## Grants
--
-- A newly created function is executable by `public` by default, so the
-- revokes below are the substance rather than boilerplate — and the grants are
-- equally load-bearing: sprint 0106 shipped a revoke without the compensating
-- grant, and the caller failed open silently for a whole deploy.

create or replace function public.sum_ledger_deltas(p_credit_account_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(entry.credit_delta), 0)::bigint
    from public.billing_credit_ledger entry
   where entry.credit_account_id = p_credit_account_id;
$$;

comment on function public.sum_ledger_deltas(uuid) is
  'The posted balance implied by one account''s ledger, summed in the database rather than by transferring every row (VB-025). SECURITY INVOKER: RLS decides which entries are visible, exactly as it does for a direct select.';

revoke execute on function public.sum_ledger_deltas(uuid) from public, anon;
grant execute on function public.sum_ledger_deltas(uuid) to authenticated, service_role;
