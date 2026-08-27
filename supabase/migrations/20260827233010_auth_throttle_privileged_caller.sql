-- VB-053 — the sign-in throttle stops being reachable by the public.
--
-- See [ADR 0060](../../docs/decisions/0060-sign-in-throttle-authority.md).
--
-- `record_auth_attempt` was granted to `anon` on the reasoning that sign-in
-- happens before there is a session, so the caller *is* `anon`. That is correct
-- about the caller and wrong about the consequence: `anon` is reachable by
-- anyone holding the publishable key, and the publishable key is published.
--
-- Measured against the deployed database with nothing else: eight POSTs
-- carrying `sha256(lower(victim@example.com))` and `p_succeeded: false` refuse
-- that account sign-in for 884 seconds, repeatable indefinitely. That is not a
-- weakness in the control — it is the control used as a weapon. Before VB-010
-- nobody could stop a known address from signing in; after it, anyone who can
-- guess an email address could.
--
-- ## The fix is the reach, not the arguments
--
-- `execute` is revoked from `anon` and `authenticated`. The only caller is
-- `src/modules/auth/throttle.ts`, which obtains a service-role client itself.
-- The forgery was a transport-layer fact, so removing the transport removes it
-- by construction rather than by validation.
--
-- ## Why the JWT-derived clear goes with it
--
-- `20260827210658` made a success clear the window for the address in the
-- caller's own verified JWT, because the function was publicly callable and the
-- identifier argument could name anyone. Under this migration it is not
-- publicly callable, so the argument is trustworthy again — and the JWT check
-- would now *break* the one legitimate caller, because a service-role caller
-- carries no `email` claim and would therefore clear nothing. A customer who
-- mistyped several times and then signed in correctly would stay throttled
-- until the window aged out.
--
-- That looks like a rollback of a security fix and is not. The authority moved
-- from what the caller can prove about its arguments to whether it may call at
-- all, which is the stronger boundary; keeping both would mean keeping a check
-- that can only ever refuse the one caller that is allowed.

create or replace function public.record_auth_attempt(
  p_identifier_hash text,
  -- Null means "report the state and record nothing". The caller asks that
  -- before spending a password check, so a throttled account is refused
  -- *without* the attempt reaching the auth provider — a throttle that only
  -- reports afterwards bounds nothing.
  p_succeeded boolean
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.auth_attempt_windows%rowtype;
  now_ts timestamptz := pg_catalog.now();
  max_failures constant integer := 8;
  window_seconds constant integer := 900;
begin
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'record_auth_attempt requires a sha-256 hex identifier';
  end if;

  if p_succeeded is null then
    select * into row from public.auth_attempt_windows
      where identifier_hash = p_identifier_hash;

    if found and row.blocked_until is not null and row.blocked_until > now_ts then
      return query select
        false,
        ceil(extract(epoch from (row.blocked_until - now_ts)))::integer;
      return;
    end if;

    return query select true, 0;
    return;
  end if;

  if p_succeeded then
    -- The account demonstrably belongs to whoever just signed in, and holding a
    -- grudge against a customer who mistyped twice is a support ticket rather
    -- than a security control.
    delete from public.auth_attempt_windows where identifier_hash = p_identifier_hash;
    return query select true, 0;
    return;
  end if;

  insert into public.auth_attempt_windows (identifier_hash, failures, window_started_at, updated_at)
  values (p_identifier_hash, 1, now_ts, now_ts)
  on conflict (identifier_hash) do update
    set
      -- A window that has aged out starts again rather than accumulating
      -- forever; otherwise one failure a week would eventually lock an account.
      failures = case
        when public.auth_attempt_windows.window_started_at < now_ts - make_interval(secs => window_seconds)
          then 1
        else public.auth_attempt_windows.failures + 1
      end,
      window_started_at = case
        when public.auth_attempt_windows.window_started_at < now_ts - make_interval(secs => window_seconds)
          then now_ts
        else public.auth_attempt_windows.window_started_at
      end,
      updated_at = now_ts
  returning * into row;

  if row.failures >= max_failures then
    update public.auth_attempt_windows
      set blocked_until = row.window_started_at + make_interval(secs => window_seconds)
      where identifier_hash = p_identifier_hash
      returning * into row;
  end if;

  if row.blocked_until is not null and row.blocked_until > now_ts then
    return query select
      false,
      ceil(extract(epoch from (row.blocked_until - now_ts)))::integer;
    return;
  end if;

  return query select true, 0;
end;
$$;

comment on function public.record_auth_attempt(text, boolean) is
  'VB-010/VB-053 — records a sign-in outcome and answers whether the next attempt is allowed. Reachable only by service_role. Refuses; authorizes nothing.';

-- The whole decision, in two statements. `service_role` needs no grant: it
-- holds the platform default and bypasses RLS, which is exactly why obtaining
-- that client is itself the reviewed act (ADR 0060, rule 53).
revoke all on function public.record_auth_attempt(text, boolean) from public;
revoke execute on function public.record_auth_attempt(text, boolean) from anon, authenticated;
