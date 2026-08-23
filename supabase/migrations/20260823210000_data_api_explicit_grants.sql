-- EXPLICIT DATA API GRANTS — the repository states its own PostgREST rights.
-- See docs/decisions/0043-data-api-privilege-model.md.
--
-- ## What this migration changes about the deployed database: nothing
--
-- Every privilege granted here is one the deployed project already holds,
-- because Supabase's platform default granted `arwdDxtm` on `public` tables
-- to `anon`, `authenticated`, `service_role` and `postgres` at create time.
-- `grant` only ever adds, so stating a *narrower* set cannot take anything
-- away: effective permissions after this migration are byte-for-byte what
-- they were before it. That is deliberate — this migration's whole job is to
-- move the *statement* of those rights out of a platform default and into
-- versioned repository configuration (rule 34), without changing behaviour
-- on a database currently serving real traffic.
--
-- The tightening — revoking the surplus, above all `anon`'s `insert`,
-- `update`, `delete` and `truncate` on all 49 tables — is deliberately NOT
-- here. It is the only genuinely dangerous step, and it belongs in its own
-- reviewed migration with an empirical reachability check in front of it.
--
-- ## Where the numbers come from
--
-- The grant set per table is derived from that table's own RLS policies,
-- read off the deployed database rather than transcribed from a summary:
-- `authenticated` is granted exactly the commands for which a policy exists,
-- and nothing else. A table with no policy for a command cannot use the
-- privilege anyway — RLS default-denies — so granting it would be surplus by
-- construction.
--
-- `anon` is granted NOTHING, on any table. Every one of this repository's
-- policies resolves `auth.uid()`, which is NULL for an unauthenticated
-- request, so `anon` can satisfy no policy on any table. Login runs through
-- GoTrue against the `auth` schema, not through PostgREST on `public`.
--
-- `billing_stripe_events` appears only in the `service_role` list. It has no
-- policies at all, deliberately — it is Vibe's operational record of its
-- payment provider's traffic, belongs to no customer, and no customer needs
-- to read it.
--
-- ## service_role
--
-- Full CRUD on every table: it is the only writer for all ten billing
-- tables and the only path durable workflow steps have (ADR 0013, rule 53).
-- It bypasses RLS, which is why the grants above it are the boundary that
-- matters for everyone else.

grant select, insert, update, delete on table public.action_plan_steps to service_role;
grant select, insert, update, delete on table public.action_plans to service_role;
grant select, insert, update, delete on table public.agent_activity_events to service_role;
grant select, insert, update, delete on table public.agent_execution_events to service_role;
grant select, insert, update, delete on table public.agent_execution_runs to service_role;
grant select, insert, update, delete on table public.agent_tool_events to service_role;
grant select, insert, update, delete on table public.ai_usage_events to service_role;
grant select, insert, update, delete on table public.audit_events to service_role;
grant select, insert, update, delete on table public.authenticated_browser_sessions to service_role;
grant select, insert, update, delete on table public.authenticated_product_intelligence_snapshots to service_role;
grant select, insert, update, delete on table public.billing_credit_accounts to service_role;
grant select, insert, update, delete on table public.billing_credit_allocations to service_role;
grant select, insert, update, delete on table public.billing_credit_grants to service_role;
grant select, insert, update, delete on table public.billing_credit_ledger to service_role;
grant select, insert, update, delete on table public.billing_credit_quotes to service_role;
grant select, insert, update, delete on table public.billing_credit_reservations to service_role;
grant select, insert, update, delete on table public.billing_stripe_customers to service_role;
grant select, insert, update, delete on table public.billing_stripe_events to service_role;
grant select, insert, update, delete on table public.billing_subscriptions to service_role;
grant select, insert, update, delete on table public.billing_usage_events to service_role;
grant select, insert, update, delete on table public.business_opportunities to service_role;
grant select, insert, update, delete on table public.business_outcome_measurements to service_role;
grant select, insert, update, delete on table public.business_readiness_audits to service_role;
grant select, insert, update, delete on table public.change_approvals to service_role;
grant select, insert, update, delete on table public.change_merges to service_role;
grant select, insert, update, delete on table public.change_outcome_verifications to service_role;
grant select, insert, update, delete on table public.deep_scan_provider_usage to service_role;
grant select, insert, update, delete on table public.execution_interrupts to service_role;
grant select, insert, update, delete on table public.execution_specs to service_role;
grant select, insert, update, delete on table public.free_audit_grants to service_role;
grant select, insert, update, delete on table public.github_connections to service_role;
grant select, insert, update, delete on table public.github_installations to service_role;
grant select, insert, update, delete on table public.live_product_intelligence_snapshots to service_role;
grant select, insert, update, delete on table public.measurement_plans to service_role;
grant select, insert, update, delete on table public.operation_runs to service_role;
grant select, insert, update, delete on table public.opportunity_sets to service_role;
grant select, insert, update, delete on table public.prepared_changes to service_role;
grant select, insert, update, delete on table public.preview_sessions to service_role;
grant select, insert, update, delete on table public.product_profile_corrections to service_role;
grant select, insert, update, delete on table public.product_profiles to service_role;
grant select, insert, update, delete on table public.project_founder_intent to service_role;
grant select, insert, update, delete on table public.project_onboarding to service_role;
grant select, insert, update, delete on table public.projects to service_role;
grant select, insert, update, delete on table public.repository_connections to service_role;
grant select, insert, update, delete on table public.repository_intelligence_snapshots to service_role;
grant select, insert, update, delete on table public.review_artifacts to service_role;
grant select, insert, update, delete on table public.review_browser_usage to service_role;
grant select, insert, update, delete on table public.sandbox_usage_events to service_role;
grant select, insert, update, delete on table public.validation_runs to service_role;

grant select, insert, delete on table public.action_plan_steps to authenticated;
grant select, insert, update, delete on table public.action_plans to authenticated;
grant select on table public.agent_activity_events to authenticated;
grant select on table public.agent_execution_events to authenticated;
grant select on table public.agent_execution_runs to authenticated;
grant select on table public.agent_tool_events to authenticated;
grant insert on table public.ai_usage_events to authenticated;
grant select, insert on table public.audit_events to authenticated;
grant select, insert, update on table public.authenticated_browser_sessions to authenticated;
grant select, insert, update on table public.authenticated_product_intelligence_snapshots to authenticated;
grant select on table public.billing_credit_accounts to authenticated;
grant select on table public.billing_credit_allocations to authenticated;
grant select on table public.billing_credit_grants to authenticated;
grant select on table public.billing_credit_ledger to authenticated;
grant select on table public.billing_credit_quotes to authenticated;
grant select on table public.billing_credit_reservations to authenticated;
grant select on table public.billing_stripe_customers to authenticated;
grant select on table public.billing_subscriptions to authenticated;
grant select on table public.billing_usage_events to authenticated;
grant select, insert, delete on table public.business_opportunities to authenticated;
grant select, insert on table public.business_outcome_measurements to authenticated;
grant select, insert, update, delete on table public.business_readiness_audits to authenticated;
grant select, insert, update on table public.change_approvals to authenticated;
grant select, insert on table public.change_merges to authenticated;
grant select, insert on table public.change_outcome_verifications to authenticated;
grant insert on table public.deep_scan_provider_usage to authenticated;
grant select, update on table public.execution_interrupts to authenticated;
grant select on table public.execution_specs to authenticated;
grant select on table public.free_audit_grants to authenticated;
grant select, insert, update, delete on table public.github_connections to authenticated;
grant select, insert, update, delete on table public.github_installations to authenticated;
grant select, insert, update, delete on table public.live_product_intelligence_snapshots to authenticated;
grant select, insert on table public.measurement_plans to authenticated;
grant select, insert, update, delete on table public.operation_runs to authenticated;
grant select, insert, update, delete on table public.opportunity_sets to authenticated;
grant select, insert, update, delete on table public.prepared_changes to authenticated;
grant select, insert, update, delete on table public.preview_sessions to authenticated;
grant select, insert, update, delete on table public.product_profile_corrections to authenticated;
grant select, insert, update, delete on table public.product_profiles to authenticated;
grant select, insert, update, delete on table public.project_founder_intent to authenticated;
grant select, insert, update on table public.project_onboarding to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.repository_connections to authenticated;
grant select, insert, update, delete on table public.repository_intelligence_snapshots to authenticated;
grant select, insert, update, delete on table public.review_artifacts to authenticated;
grant select on table public.review_browser_usage to authenticated;
grant select on table public.sandbox_usage_events to authenticated;
grant select, insert, update, delete on table public.validation_runs to authenticated;
