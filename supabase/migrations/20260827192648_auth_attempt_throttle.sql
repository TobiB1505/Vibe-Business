-- VB-010 — per-account sign-in throttling.
--
-- Supabase Auth rate-limits by IP. Vibe runs on Vercel, so every request
-- arrives from a shared egress pool and one attacker's attempts are diluted
-- among every other customer's traffic. The limit still exists; it just no
-- longer means "this account is under attack", which is the question worth
-- answering.
--
-- ## Why a function and not a table write
--
-- Sign-in happens before there is a session, so the caller is `anon` — and as
-- of `20260827190821` `anon` holds no privilege on any table at all. That is
-- deliberate and this design works with it rather than around it: one
-- `SECURITY DEFINER` function is the entire surface, so the throttle can be
-- written by a caller who cannot read it, cannot clear it, and cannot see
-- anyone else's.
--
-- ## Why the identifier is hashed
--
-- The obvious column is the e-mail address, and it would turn this table into
-- a list of addresses that failed to sign in — a register of both Vibe's
-- customers and people who are not, useful to anyone who obtained it and
-- useful to nobody else. A SHA-256 of the lowercased address answers the only
-- question the throttle asks ("is this the same account as last time?") and
-- answers no others.
--
-- It is not a secret: an attacker who guesses an address can compute the hash.
-- That is fine. The hash exists so the *stored row* carries no address, not to
-- make the address unguessable.
--
-- ## What this is not
--
-- Not a replacement for Supabase's own limits, and not a defence against a
-- distributed attempt spread across many accounts. It bounds how fast one
-- account can be guessed at, which is the gap the finding names.

create table public.auth_attempt_windows (
  -- SHA-256 of the lowercased identifier, hex. Never the identifier.
  identifier_hash text primary key check (identifier_hash ~ '^[0-9a-f]{64}$'),

  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  -- Set once the window's allowance is spent. Null means "not throttled".
  blocked_until timestamptz,

  updated_at timestamptz not null default now()
);

comment on table public.auth_attempt_windows is
  'VB-010 per-account sign-in throttle. Holds a hash, never an address, and is reachable only through record_auth_attempt().';

create index auth_attempt_windows_blocked_idx
  on public.auth_attempt_windows (blocked_until)
  where blocked_until is not null;

alter table public.auth_attempt_windows enable row level security;

-- No policies, deliberately. Append-only by omission is not enough here — the
-- table must be unreachable through the Data API entirely, and RLS with no
-- policy denies every command to every non-bypassing role.

revoke all on public.auth_attempt_windows from anon, authenticated;

-- The one entry point ---------------------------------------------------------
--
-- Records an outcome and answers whether the next attempt is allowed, in one
-- statement, so a caller cannot read the state and act on it after it changed.
--
-- A success clears the row: the account demonstrably belongs to whoever just
-- signed in, and holding a grudge against a customer who mistyped twice is a
-- support ticket rather than a security control.

create or replace function public.record_auth_attempt(
  p_identifier_hash text,
  -- Null means "report the state and record nothing". The caller asks that
  -- before spending a password check, so a throttled account is refused
  -- *without* the attempt reaching the auth provider — a throttle that only
  -- reports afterwards bounds nothing.
  p_succeeded boolean,
  p_max_failures integer default 8,
  p_window_seconds integer default 900
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.auth_attempt_windows%rowtype;
  now_ts timestamptz := pg_catalog.now();
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
        when public.auth_attempt_windows.window_started_at < now_ts - make_interval(secs => p_window_seconds)
          then 1
        else public.auth_attempt_windows.failures + 1
      end,
      window_started_at = case
        when public.auth_attempt_windows.window_started_at < now_ts - make_interval(secs => p_window_seconds)
          then now_ts
        else public.auth_attempt_windows.window_started_at
      end,
      updated_at = now_ts
  returning * into row;

  if row.failures >= p_max_failures then
    update public.auth_attempt_windows
      set blocked_until = row.window_started_at + make_interval(secs => p_window_seconds)
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

comment on function public.record_auth_attempt(text, boolean, integer, integer) is
  'VB-010 — records a sign-in outcome and answers whether the next attempt is allowed. Refuses; authorizes nothing.';

revoke all on function public.record_auth_attempt(text, boolean, integer, integer) from public;
grant execute on function public.record_auth_attempt(text, boolean, integer, integer) to anon, authenticated;
