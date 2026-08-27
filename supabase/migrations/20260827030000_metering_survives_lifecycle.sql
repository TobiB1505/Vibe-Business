-- VB-002 M2 — metering outlives the project and the account (ADR 0056 §7).
--
-- The five metering tables carry their owner columns as `not null … on delete
-- cascade`, so deleting a project — or erasing an account — destroys the
-- measurement that priced the charge while the charge itself survives in the
-- ledger. "Why was this account charged N credits" becomes permanently
-- unanswerable, which is a defect against rules 7 and 47 quite apart from
-- anything erasure needs.
--
-- After this migration the rows survive both lifecycle events, detached,
-- holding exactly what they should: tokens, milliseconds, bytes, provider,
-- model version, cost. None of those is a personal field, so a detached row
-- needs no scrub — RETAIN, in ADR 0056 §2's vocabulary.
--
-- Measured before writing this, on a cluster carrying every migration:
--   * all five `project_id` columns are `not null` and `on delete cascade`;
--   * four `user_id` columns are the same (`deep_scan_provider_usage` has none
--     and resolves its owner through the project);
--   * no unique index on any of the five involves an owner column, so nulling
--     one cannot violate a uniqueness invariant — in particular
--     `billing_usage_events_source_sku_idx` is `(source_kind, source_id, sku)`,
--     which keeps usage-event projection idempotent for detached rows too;
--   * `operation_run_id`, `validation_run_id`, `preview_session_id` and
--     `review_artifact_id` carry no foreign key at all, so there is no second
--     cascade path that would delete a row this migration has just detached.
--
-- The RLS policies are deliberately left alone. Each is an `exists` against
-- `projects` on `project_id`, so a detached row is visible to no authenticated
-- caller — which is the correct reading of a row that belongs to no live
-- project. Reaching it stays a service-role act.

-- ai_usage_events ------------------------------------------------------------

alter table public.ai_usage_events
  alter column project_id drop not null,
  alter column user_id drop not null;

alter table public.ai_usage_events
  drop constraint ai_usage_events_project_id_fkey,
  add constraint ai_usage_events_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete set null;

alter table public.ai_usage_events
  drop constraint ai_usage_events_user_id_fkey,
  add constraint ai_usage_events_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

-- billing_usage_events -------------------------------------------------------

alter table public.billing_usage_events
  alter column project_id drop not null,
  alter column user_id drop not null;

alter table public.billing_usage_events
  drop constraint billing_usage_events_project_id_fkey,
  add constraint billing_usage_events_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete set null;

alter table public.billing_usage_events
  drop constraint billing_usage_events_user_id_fkey,
  add constraint billing_usage_events_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

-- deep_scan_provider_usage ---------------------------------------------------

alter table public.deep_scan_provider_usage
  alter column project_id drop not null;

alter table public.deep_scan_provider_usage
  drop constraint deep_scan_provider_usage_project_id_fkey,
  add constraint deep_scan_provider_usage_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete set null;

-- review_browser_usage -------------------------------------------------------

alter table public.review_browser_usage
  alter column project_id drop not null,
  alter column user_id drop not null;

alter table public.review_browser_usage
  drop constraint review_browser_usage_project_id_fkey,
  add constraint review_browser_usage_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete set null;

alter table public.review_browser_usage
  drop constraint review_browser_usage_user_id_fkey,
  add constraint review_browser_usage_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

-- sandbox_usage_events -------------------------------------------------------

alter table public.sandbox_usage_events
  alter column project_id drop not null,
  alter column user_id drop not null;

alter table public.sandbox_usage_events
  drop constraint sandbox_usage_events_project_id_fkey,
  add constraint sandbox_usage_events_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete set null;

alter table public.sandbox_usage_events
  drop constraint sandbox_usage_events_user_id_fkey,
  add constraint sandbox_usage_events_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;
