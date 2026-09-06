-- One preview profile per development server (Stufe 4).
--
-- A preview profile used to follow from a validation profile, which was exactly
-- right while both were Next.js-only: one profile meant one framework meant one
-- server command. The build contract broke that identity. A validation profile
-- now says *how a change is checked* — a locked install and the repository's own
-- scripts, which are the same commands whatever the framework — and says nothing
-- about what to start.
--
-- So the server command is chosen from a table keyed on the frameworks the
-- chosen application's own manifest declares, and each row gets its own profile
-- name. An application whose framework has no row gets no preview: checking and
-- merging still work, and there is nothing to look at. That is a better answer
-- than a guessed start command, which would put a public URL behind something
-- nobody chose.
--
-- The two `*_v1` names stay legal. No new session reaches either — the first
-- started a production server on a restored artifact, the second was the single
-- dev server before there was a table — but sessions that ran under them are
-- history and their rows still say so (rule 83).
--
-- Deliberately absent: `vite_dev_v1`. Vite >= 5.4.12 and Astro 5 refuse requests
-- whose Host is not in `server.allowedHosts`, and the sandbox serves on a public
-- hostname while the health probe reaches the server over loopback — so the
-- probe passes and the customer's URL answers "Blocked request." Astro ships
-- because a real preview against a real project settles both; Vite waits for
-- that answer rather than for an argument.

alter table public.preview_sessions
  drop constraint if exists preview_sessions_preview_profile_check;

alter table public.preview_sessions
  add constraint preview_sessions_preview_profile_check
    check (preview_profile in (
      'nextjs_preview_v1',
      'nextjs_dev_preview_v1',
      'next_dev_v1',
      'nuxt_dev_v1',
      'astro_dev_v1'
    ));
