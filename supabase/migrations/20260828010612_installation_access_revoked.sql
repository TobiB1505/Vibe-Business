-- VB-041 — a revoked GitHub installation stops looking verified.
--
-- `github_installations`' own comment says the rows are installations
-- "verified as accessible to a user", and nothing ever re-verified one. A
-- customer who removes the Vibe App on GitHub — the ordinary way to withdraw
-- access — leaves a row that still says accessible, forever.
--
-- ## What that did to them
--
-- The connect route reuses a verified installation and redirects straight to
-- the repository picker. So clicking "Connect GitHub" after uninstalling sent
-- them to a picker that could list nothing, with a generic failure and no route
-- back: the only way to actually reinstall was `?new=1`, which nothing links to.
-- The product read as broken rather than as disconnected.
--
-- ## Marked, not deleted
--
-- `repository_connections.github_installation_id` references this table with
-- `ON DELETE RESTRICT`, so a row belonging to a connected project cannot be
-- removed — and should not be. It is the record of how that project was
-- connected, and a customer who reinstalls the App is meant to get their
-- project back, not a stranger's.
--
-- Nullable, and null keeps its ordinary meaning: nothing observed, believed
-- accessible. The column records an observation Vibe made, so it is cleared
-- again the moment a later call succeeds.

alter table public.github_installations
  add column if not exists access_revoked_at timestamptz;

comment on column public.github_installations.access_revoked_at is
  'VB-041 — when GitHub last answered that this installation no longer exists. Null means no such observation; cleared when access is seen working again.';

-- Only the revoked ones are ever filtered on, and they are the rare case.
create index if not exists github_installations_revoked_idx
  on public.github_installations (user_id)
  where access_revoked_at is not null;
