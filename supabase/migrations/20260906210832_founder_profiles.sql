-- ---------------------------------------------------------------------
-- founder_profiles: the one thing this product never stored about a person
--
-- `auth/identity-view.ts` has said so in its own docblock since CORE-6:
--
--   "Never invent a name. Nothing in this codebase stores one: no profile
--    table, no user_metadata, no display name, no avatar."
--
-- That was the honest answer while nothing asked for a name, and it is why
-- the account rail prints a GitHub login or a whole email address rather than
-- turning "tobivlog@outlook.de" into "Tobi" — a guess about a person, shown as
-- a fact about them.
--
-- Nova is what changes it. An assistant that opens with "Hallo" and no name is
-- not the assistant; the name is the difference between a dashboard that
-- reports and a colleague that greets. So the name is now **asked for and
-- stored**, which is the only way to have one without guessing.
--
-- ## Why a row means "a name was given"
--
-- No nullable name, and no "was asked" flag. A row exists exactly when the
-- founder chose a name; clearing it deletes the row and the rail falls back to
-- what it prints today. The distinction between "never asked" and "asked and
-- declined" is a real one, but nothing needs it yet — onboarding does not ask
-- yet — and inventing the column now would be inventing the semantics too.
--
-- ## Why the founder writes it and Vibe only reads it
--
-- Every other table here is written by the server on the customer's behalf.
-- This one is the opposite: it holds the customer's own statement about
-- themselves, so they own every write. `service_role` gets `select` and none
-- of the three row-modifying grants — the durable step that composes what Nova
-- says needs to read the name, and has no business changing it.
--
-- Read back after deploying, `service_role` holds SELECT plus REFERENCES,
-- TRIGGER and TRUNCATE. Those three are Supabase's platform default on every
-- table in `public` — `nova_voice_messages` carries them too despite naming
-- its grants explicitly — so this table is narrower than every other one here,
-- and the sentence above is about INSERT, UPDATE and DELETE rather than about
-- a grant list nothing in this repository controls.
--
-- ## The name reaches a model, so its shape is constrained here
--
-- 60 characters, no control characters, no line breaks. A name is one line.
-- The database is where that stops being a convention: text a founder typed
-- travels into a prompt, and the application will still fence it as data
-- rather than instruction (rule 42) — but a value that cannot contain a
-- newline cannot smuggle a second line into anything downstream, whatever a
-- future caller forgets.
-- ---------------------------------------------------------------------

create table public.founder_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- One line, trimmed, never empty. The check is on the trimmed value so
  -- "   " is refused rather than stored as a name made of spaces.
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 60)
    check (display_name !~ '[\r\n\t]')
    check (display_name = btrim(display_name)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.founder_profiles is
  'What a founder asked to be called. One row per account, written only by that account. A row exists exactly when a name was given; clearing it deletes the row.';

comment on column public.founder_profiles.display_name is
  'A single trimmed line, 1-60 characters, no control characters. Constrained here because the value travels into a model prompt as data.';

create trigger set_updated_at
  before update on public.founder_profiles
  for each row execute function public.set_updated_at();

alter table public.founder_profiles enable row level security;

create policy "select own founder_profile"
  on public.founder_profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "insert own founder_profile"
  on public.founder_profiles for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "update own founder_profile"
  on public.founder_profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "delete own founder_profile"
  on public.founder_profiles for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.founder_profiles to authenticated;

-- Read only. The step that composes Nova's message needs the name; nothing
-- server-side has a reason to write what a person calls themselves.
grant select on table public.founder_profiles to service_role;
