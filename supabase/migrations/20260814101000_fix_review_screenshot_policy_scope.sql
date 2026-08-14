-- Sprint 11A dogfood fix, second attempt — qualify the object path.
--
-- `20260814100000` added the SELECT policy that lets an owner sign their own
-- review screenshot, and it matched nothing. The predicate was:
--
--   exists (select 1 from public.projects p
--           where p.id::text = (storage.foldername(name))[1] ...)
--
-- Inside that subquery, `name` resolves against the *inner* FROM first — and
-- `public.projects` has a `name` column. So the policy asked whether a project's
-- own display name, split on "/", had a first segment equal to the project's id.
-- It never does. The policy existed, was syntactically valid, applied to the
-- right bucket, and denied every row.
--
-- Verified as the owning user before and after: `auth.uid()` resolved,
-- `projects` returned 2 rows, `storage.objects` for this bucket returned 0.
--
-- The same lesson as the contract-test helper that matched a column name
-- anywhere in the migration history: **an unqualified column name is a guess
-- about scope.** In a policy that guess is silent — there is no error, only a
-- row that never matches.
drop policy if exists "select own review screenshots" on storage.objects;

create policy "select own review screenshots"
  on storage.objects
  for select using (
    bucket_id = 'review-screenshots'
    and exists (
      select 1
      from public.projects p
      -- Qualified deliberately. `storage.objects.name` is the object path;
      -- bare `name` would bind to `p.name` and match nothing.
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and p.user_id = auth.uid()
    )
  );
