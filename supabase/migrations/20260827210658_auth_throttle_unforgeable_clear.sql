-- VB-010, repaired — the sign-in throttle stops taking the client's word for it.
--
-- `record_auth_attempt` is `SECURITY DEFINER` and granted to `anon`, because
-- sign-in happens before there is a session and `anon` holds no privilege on
-- any table. That part is right and stays. What was wrong is that everything
-- the function acted on came from its **arguments**, and the arguments arrive
-- over `/rest/v1/rpc/record_auth_attempt` with the publishable key — which is
-- published, by design, in every browser bundle.
--
-- Measured against the deployed database before this migration, with nothing
-- but that key:
--
--   * eight POSTs carrying `sha256(lower(victim@example.com))` and
--     `p_succeeded: false` → the pre-check answers `allowed: false,
--     retry_after_seconds: 884` for that account. Repeatable indefinitely.
--   * one POST carrying `p_succeeded: true` → the window is deleted and the
--     account is unthrottled again.
--
-- The second is the one this migration closes completely. A caller asserting
-- "the sign-in succeeded" was asserting it about an account it had shown no
-- connection to, which made the whole control opt-out: an attacker guessing
-- passwords clears the counter between guesses and the allowance never runs
-- down.
--
-- ## The identity now comes from the session, never from the argument
--
-- A success clears the window for the address in the **caller's own verified
-- JWT** and no other. The legitimate caller is the sign-in action immediately
-- after the credentials were accepted, so it holds exactly that session; an
-- anonymous caller holds none and clears nothing. There is no argument that
-- can be crafted into being someone else, which is the property worth having
-- — not a stricter check on the argument, but an argument that no longer
-- decides anything.
--
-- ## The thresholds stop being caller-supplied
--
-- `p_max_failures` and `p_window_seconds` were `default 8` / `default 900` and
-- the application never passed either — but a client could, and a client that
-- can choose the allowance on the control that bounds it is a control with an
-- opt-out. They are constants now, so the signature narrows to the two
-- arguments that were ever really inputs.
--
-- ## What this does NOT fix, deliberately
--
-- An anonymous caller can still spend a *victim's* allowance and hold their
-- account out of password sign-in for fifteen minutes at a time. Closing that
-- needs the counter to be unwritable by the public, and there are only two
-- shapes for it — a secret the server holds and the browser does not, or a
-- privileged client (which CLAUDE.md rule 53 confines to durable execution).
-- Both are decisions above a repair, so this migration does not invent one.
-- Tracked as VB-053.

drop function if exists public.record_auth_attempt(text, boolean, integer, integer);

create function public.record_auth_attempt(
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
  caller_email text;
  caller_hash text;
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
    -- Same shape as `auth.uid()`: PostgREST populates the claims as JSON, and
    -- the flattened per-claim setting is the older form some deployments still
    -- carry. Neither is settable by anything but the token.
    caller_email := coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.email', true), ''),
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
    );

    if caller_email is null then
      -- Nobody is signed in, so there is no account whose success this could
      -- be. Nothing is cleared, and the answer says nothing about whether a
      -- window existed — an unauthenticated caller learns the same thing here
      -- whether or not it guessed a real address.
      return query select true, 0;
      return;
    end if;

    caller_hash := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(caller_email)), 'utf8')),
      'hex'
    );

    -- The argument is not consulted. Passing someone else's hash clears their
    -- window only if you are them, in which case the argument was redundant.
    delete from public.auth_attempt_windows where identifier_hash = caller_hash;
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
  'VB-010 — records a sign-in outcome and answers whether the next attempt is allowed. A success clears only the caller''s own session identity. Refuses; authorizes nothing.';

revoke all on function public.record_auth_attempt(text, boolean) from public;
grant execute on function public.record_auth_attempt(text, boolean) to anon, authenticated;
