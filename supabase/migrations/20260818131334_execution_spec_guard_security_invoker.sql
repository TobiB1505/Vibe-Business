-- EXECUTION CORE-3 follow-up — the immutability guard needs no elevation.
--
-- Found by `supabase get_advisors --type security` immediately after deploying
-- `execution_specs`, which is exactly what that check is for:
--
--   Function `public.reject_execution_spec_mutation()` can be executed by the
--   `anon` role as a `SECURITY DEFINER` function via
--   `/rest/v1/rpc/reject_execution_spec_mutation`.
--
-- ## Why it was wrong
--
-- `security definer` was copied from the shape of the privileged helpers this
-- schema already has, without asking what privilege this function needs. The
-- answer is none: it takes no arguments, reads nothing, writes nothing, and
-- does exactly one thing — raise. A `before update or delete` trigger fires on
-- its table regardless of the function's security context, so the guarantee is
-- identical under `security invoker` and the elevation buys nothing.
--
-- ## Why it still mattered
--
-- The practical blast radius was small — an anonymous caller who reached the
-- RPC would receive the exception the function exists to raise. But a
-- `security definer` function reachable by `anon` is a standing invitation for
-- a future edit to add a body that does something, at which point it becomes a
-- privilege escalation nobody re-reviewed. The elevation is removed now, while
-- the function is one line, rather than left as a trap.
--
-- Belt and braces: `execute` is also revoked from `public`, `anon` and
-- `authenticated`. A trigger invokes the function through the table, not
-- through a grant, so revoking it changes nothing about the guard and removes
-- the RPC surface entirely.

create or replace function public.reject_execution_spec_mutation()
returns trigger
language plpgsql
-- `security invoker` is the default and is stated explicitly, so the next
-- reader sees a decision rather than an omission.
security invoker
set search_path = ''
as $$
begin
  raise exception
    'execution_specs rows are immutable. Re-resolve the step and insert a new spec instead.'
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.reject_execution_spec_mutation() from public;
revoke execute on function public.reject_execution_spec_mutation() from anon;
revoke execute on function public.reject_execution_spec_mutation() from authenticated;

comment on function public.reject_execution_spec_mutation() is
  'Trigger guard: execution_specs rows are immutable (EXECUTION CORE-3 §10). Needs no elevated privilege and is not callable over the REST API.';
