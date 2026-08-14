-- Sprint 11A dogfood fix — let the owner's session sign a review screenshot.
--
-- The first real comparison captured both sides, stored both PNGs and reached
-- `ready` — and the panel showed "Loading comparison…" forever, because no
-- signed URL could be produced.
--
-- `20260814090000` created the bucket with **no** `storage.objects` policy, on
-- the reasoning that the application authorizes the caller and then mints a
-- signed URL, so RLS had nothing left to decide. That reasoning was wrong about
-- the mechanism: `createSignedUrl` is itself an RLS-checked read of the object,
-- performed with the caller's own token. With no policy the owner could not see
-- their own screenshots, so signing failed and the failure was reported as
-- "there is no URL" — indistinguishable from "not captured yet".
--
-- Verified against the live database before writing this file: as the owning
-- user, `select count(*) from storage.objects where bucket_id =
-- 'review-screenshots'` returned 0.
--
-- This is the mirror image of the Sprint 10B ledger bug (ADR 0016 §14). There,
-- a write the application had authorized was refused by RLS and the error was
-- swallowed. Here, a read the application had authorized was refused by RLS and
-- the absence was rendered as a loading state. Same false premise both times:
-- *the application checked, so the database does not need to.* The database is
-- not downstream of the application's authorization — it is a second gate, and
-- a gate that is closed to everyone is closed to the owner too.
--
-- What this grants, and nothing more:
--
--   * SELECT only. There is still no INSERT, UPDATE or DELETE policy, so writes
--     and deletions remain service-role-only from durable execution.
--   * This bucket only.
--   * Objects under a project the caller owns — the first path segment of
--     `{projectId}/{artifactId}/{side}.png`, checked against `projects.user_id`.
--
-- The application still authorizes before it signs, and the signed URL is still
-- short-lived and never persisted. This policy does not replace that check; it
-- stops it from being the only one, in the direction that was silently failing.
create policy "select own review screenshots"
  on storage.objects
  for select using (
    bucket_id = 'review-screenshots'
    and exists (
      select 1
      from public.projects p
      -- Compare as text: a path segment is not guaranteed to be a valid uuid,
      -- and casting it would raise rather than simply not match.
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = auth.uid()
    )
  );
