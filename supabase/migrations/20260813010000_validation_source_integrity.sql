-- Sprint 10A post-dogfood: say what source verification actually proves.
--
-- The brief asked for the checked-out commit to be independently re-observed
-- with `git rev-parse` and compared to the prepared commit. Five real runs
-- established that this is not possible on this provider: Vercel materializes a
-- git source as a filesystem, not a git checkout, so the sandbox contains no
-- `.git` to interrogate.
--
-- The alternative — cloning inside the sandbox ourselves — would carry a GitHub
-- installation token into a VM that later runs untrusted code. That trades a
-- real secret lifecycle for a weaker proof, so it was rejected.
--
-- The claim is therefore narrowed to what is genuinely established, and
-- recorded per run so a stored pass cannot later be read as more than it was:
--
--   source_revision_pinned             immutable SHA passed to the provider
--   prepared_change_files_verified     hashed in the sandbox, before any repo code
--   build_identity_files_verified      where GitHub resolves them cheaply
--   git_commit_independently_observed  NOT established on this provider

alter table public.validation_runs
  add column source_integrity jsonb;

comment on column public.validation_runs.source_integrity is
  'What was actually established about the validated source: the pinned revision, how it was pinned, and which files were hash-verified before any repository-controlled command ran. Deliberately does not claim independent Git observation — the provider materializes a filesystem, not a checkout.';
