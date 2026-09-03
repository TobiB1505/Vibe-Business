-- Vite gets a development server row (Stufe 4, continued).
--
-- `20260903100000` left `vite_dev_v1` out, and the reason was right: Vite
-- >= 5.4.12 refuses requests whose Host is not in `server.allowedHosts`, the
-- health probe reached the server over loopback so it *passed*, and the
-- customer's own URL answered "Blocked request." A row recording `running` for
-- a page nobody can open is worse than no row.
--
-- What was wrong was the plan for settling it — dogfood a Vite preview and
-- decide — because there was no Vite preview to dogfood without the row. So it
-- was settled by reading Vite's own source instead, and both halves are closed:
--
--   * the server is told its hostname through Vite's own
--     `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, so no repository file is touched
--     to make Vibe's preview work;
--   * the probe now carries that hostname, so a server that still refuses fails
--     as `preview_host_rejected` instead of passing.
--
-- The same defect was live for `astro_dev_v1`, which shipped in that migration:
-- Astro, Nuxt and SvelteKit are all Vite servers and all inherit the gate. This
-- migration widens the CHECK; the repair is in the code the CHECK admits.
--
-- Every historical value stays legal. Rows written under the two retired names
-- are history and still say what they meant (rule 83).

alter table public.preview_sessions
  drop constraint if exists preview_sessions_preview_profile_check;

alter table public.preview_sessions
  add constraint preview_sessions_preview_profile_check
    check (preview_profile in (
      'nextjs_preview_v1',
      'nextjs_dev_preview_v1',
      'next_dev_v1',
      'nuxt_dev_v1',
      'astro_dev_v1',
      'vite_dev_v1'
    ));
