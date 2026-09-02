-- ADR 0076: the Deep Scan browser provider becomes Vibe's own sandbox.
-- See docs/sprints/0130-the-browser-we-own.md.
--
-- Two CHECK constraints admitted exactly one provider name. Widening them is
-- what lets a session recorded by the new provider be stored at all — without
-- this, the first real scan after the swap fails on an insert, several seconds
-- after a person has already been shown a browser.
--
-- ## Both names stay admissible, and the old rows are untouched
--
-- `authenticated_browser_sessions` holds 5 rows and `deep_scan_provider_usage`
-- holds 7, all recorded against Browserbase between 2026-08-11 and 2026-08-27.
-- They say what was true when they were written and are not rewritten: a
-- migration that relabelled them would be claiming Vibe's own sandbox produced
-- measurements it did not.
--
-- The constraint is kept as an enumeration rather than dropped. A free-text
-- provider column would accept a typo silently, and a provider name is what
-- every cost figure is grouped by.

alter table public.authenticated_browser_sessions
  drop constraint authenticated_browser_sessions_provider_check;

alter table public.authenticated_browser_sessions
  add constraint authenticated_browser_sessions_provider_check
  check (provider in ('browserbase', 'vercel_sandbox_browser'));

alter table public.deep_scan_provider_usage
  drop constraint deep_scan_provider_usage_provider_check;

alter table public.deep_scan_provider_usage
  add constraint deep_scan_provider_usage_provider_check
  check (provider in ('browserbase', 'vercel_sandbox_browser'));

comment on column public.deep_scan_provider_usage.provider is
  'Which browser a scan ran in. ''browserbase'' on rows written before ADR 0076; ''vercel_sandbox_browser'' after. Never relabelled — a cost figure belongs to the provider that produced it.';
