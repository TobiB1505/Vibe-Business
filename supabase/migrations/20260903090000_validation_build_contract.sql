-- The validation profile becomes a build contract (Stufe 4).
--
-- `nextjs_node_v1` promised its commands to repositories that declared `next`.
-- That turned out to decorate rather than describe: `planValidationSteps` takes
-- no profile, and the commands it plans are the repository's own `typecheck`,
-- `test` and `build` scripts. The framework check narrowed who could be checked
-- without sharpening what the check claimed.
--
-- `node_build_v1` is keyed on what those commands actually need: one manifest
-- declaring a `build` script, and a lockfile in its own directory that Vibe can
-- install from exactly.
--
-- Two things this migration does not do:
--
--   * It does not remove `nextjs_node_v1`. Sixteen rows carry it, and a record
--     is not rewritten to match the present. Nothing resolves it any more.
--   * It does not alias the two. A stored pass under the old profile was
--     checked under the old rules, and reading it as though it had been checked
--     under today's is exactly what the version exists to prevent.

alter table public.validation_runs
  drop constraint if exists validation_runs_validation_profile_check;

alter table public.validation_runs
  add constraint validation_runs_validation_profile_check
    check (validation_profile in ('nextjs_node_v1', 'node_build_v1'));

-- Which directory was validated.
--
-- Part of the validation identity, not decoration. Once a repository can hold
-- more than one application, the same commit is a legitimate question at
-- `apps/a` and at `apps/b` — and without this a pass recorded for one would be
-- reused to answer the other. "This commit validated" was never the claim.
--
-- The default is the truth for every existing row rather than a placeholder:
-- each of them validated a single-application repository at its root.
alter table public.validation_runs
  add column if not exists workspace_root text not null default '.';

-- This value becomes a sandbox working directory, so the shape is a constraint
-- rather than a convention. `..` is excluded explicitly because the character
-- class above it matches it: `[A-Za-z0-9._-]+` accepts two dots quite happily,
-- and a path that escapes its repository is the one thing this column must
-- never hold.
alter table public.validation_runs
  drop constraint if exists validation_runs_workspace_root_shape;

alter table public.validation_runs
  add constraint validation_runs_workspace_root_shape
    check (
      workspace_root = '.'
      or (
        workspace_root ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
        and workspace_root !~ '(^|/)\.\.(/|$)'
      )
    );

comment on column public.validation_runs.workspace_root is
  'Repository-relative directory the profile''s commands ran in. Part of the validation identity: a pass says what passed, and where.';
