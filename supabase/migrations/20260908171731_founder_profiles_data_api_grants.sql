-- ---------------------------------------------------------------------
-- founder_profiles: revoke the three grants default privileges does not cover
--
-- `20260823220000_data_api_default_privileges.sql` makes a new table opt-in
-- rather than auto-exposed — but it revokes `select, insert, update, delete`
-- and nothing else, because those are the four the Data API reads through.
-- `TRUNCATE`, `REFERENCES` and `TRIGGER` are not in that list, so every table
-- created since still receives them from Supabase's platform default.
--
-- That is why `nova_voice_messages` opens with `revoke all ... from anon,
-- authenticated` before naming its grants, and `founder_profiles` did not.
-- The consequence is the one VB-015 exists for: row-level security does not
-- govern `TRUNCATE`, so a role holding it empties the table regardless of the
-- four policies on it.
--
-- The table's own migration is left as it was written. It has already been
-- applied, so editing it would produce a file the database never runs — the
-- convergence rule (CLAUDE.md rule 34) works in one direction only.
--
-- The authenticated grants are restated rather than assumed: `revoke all`
-- takes them too, and the founder still owns every write to their own name.
-- `service_role` is untouched, and keeps `select` alone.
-- ---------------------------------------------------------------------

revoke all on table public.founder_profiles from anon, authenticated;

grant select, insert, update, delete on table public.founder_profiles to authenticated;
