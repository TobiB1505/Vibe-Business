-- Widen the outcome profile enumeration for the agentic path (ADR 0071).
--
-- `agentic_execution_v1` mapped to `null` in `execution/outcome-contract.ts`,
-- so every change the coding agent produced resolved to
-- `outcome_not_supported` and no row was ever written for one. It now resolves
-- to `agentic_public_routes_outcome_v1`, whose expectations are the public
-- routes the change touched — the intersection of the paths Vibe verified as
-- changed with the analyzer's route table for the pinned commit.
--
-- The profile stays enumerated here, unlike the version strings beside it: it
-- is a closed set of code paths rather than a value that gets bumped, and
-- `schema.test.ts` pins this list against `OUTCOME_PROFILES`. Adding one is
-- meant to be a deliberate migration.
--
-- Widening only. Every stored row carries the SEO profile and keeps meaning
-- exactly what it was checked against; nothing is rewritten.

alter table public.change_outcome_verifications
  drop constraint if exists change_outcome_verifications_outcome_profile_check;

alter table public.change_outcome_verifications
  add constraint change_outcome_verifications_outcome_profile_check
  check (
    outcome_profile in (
      'nextjs_seo_foundations_outcome_v1',
      'agentic_public_routes_outcome_v1'
    )
  );
