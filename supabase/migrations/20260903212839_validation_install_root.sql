-- Stufe 8 — an application inside a workspace installs from the workspace root.
--
-- ADR 0078 admitted exactly one shape: a lockfile in the same directory as the
-- manifest that declares `build`. A workspace monorepo — one lockfile at the
-- root, applications in `apps/*` — had zero installable targets and was
-- refused. Lifting that refusal means install and build no longer happen in
-- the same directory, so "where it ran" stops being one value.
--
-- The column is not bookkeeping. A pass that does not say where it installed
-- does not say what it checked: the same application installed from its own
-- directory and installed from a workspace root above it are two different
-- dependency trees, and one must not answer for the other. It joins
-- `workspace_root` in the validation identity for that reason.
--
-- The default is the truth for every existing row rather than a placeholder:
-- under the single-directory contract, install ran where the build ran.
alter table public.validation_runs
  add column if not exists install_root text not null default '.';

-- Same shape rule as `workspace_root`, and for the same reason: this value
-- becomes a sandbox working directory. `..` is excluded explicitly because the
-- character class above it matches two dots quite happily.
alter table public.validation_runs
  drop constraint if exists validation_runs_install_root_shape;

alter table public.validation_runs
  add constraint validation_runs_install_root_shape
    check (
      install_root = '.'
      or (
        install_root ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
        and install_root !~ '(^|/)\.\.(/|$)'
      )
    );

comment on column public.validation_runs.install_root is
  'Repository-relative directory the install ran in. Equal to workspace_root unless the application was installed from a workspace root above it. Part of the validation identity.';
