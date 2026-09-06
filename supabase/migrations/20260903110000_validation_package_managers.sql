-- Every package manager Vibe can install from a lockfile, exactly (Stufe 4).
--
-- pnpm and npm were the two whose "install exactly what the lockfile says" mode
-- Vibe was sure of. Yarn Berry and bun have one too — `yarn install --immutable
-- --mode=skip-build` and `bun install --frozen-lockfile --ignore-scripts` — and
-- there was never a reason beyond caution not to name them.
--
-- Yarn 1 is deliberately absent, and this is the decision rather than an
-- oversight. It shares `yarn.lock` with Berry and does not share
-- `--frozen-lockfile`'s meaning: it does not reliably fail when package.json has
-- gained a dependency the lockfile lacks, which is precisely the "validate a
-- dependency tree nobody committed" failure a locked install exists to prevent.
-- A Yarn 1 repository is refused by name, with copy pointing at the upgrade.
-- Berry is told apart by a `.yarnrc.yml` beside the lockfile — observed by its
-- existence, never read, because that file may carry an npm auth token.
--
-- `sandbox-policy-v6` accompanies this, for two reasons that are the same
-- reason: the set of authorized install commands grew, and Berry resolves from
-- `registry.yarnpkg.com`, which the install window did not previously allow. A
-- pass recorded under v5 was checked against a narrower set of installers than a
-- v6 pass is, so the version moves and prior results are not reused across it.

alter table public.validation_runs
  drop constraint if exists validation_runs_package_manager_check;

alter table public.validation_runs
  add constraint validation_runs_package_manager_check
    check (package_manager in ('pnpm', 'npm', 'yarn_berry', 'bun'));
