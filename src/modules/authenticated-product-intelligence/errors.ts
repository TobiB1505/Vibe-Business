/**
 * Typed failures for authenticated product analysis (Sprint 5 §28).
 *
 * Every failure a caller can observe is one of these codes. A raw provider
 * error — a sandbox provider exception, a CDP transport error, a Playwright
 * timeout — never escapes the adapter, so nothing provider-shaped reaches a log line,
 * an audit event, a database column, or a browser (same discipline as
 * ADR 0010 and ADR 0011).
 */
export type AuthenticatedAnalysisFailure =
  /** No browser-sandbox secret configured — the feature is simply unavailable. */
  | "browser_provider_not_configured"
  | "browser_session_create_failed"
  | "browser_session_expired"
  | "browser_session_not_found"
  | "browser_connection_failed"
  /** Connected, but no page is on the project's configured origin. */
  | "authenticated_origin_not_reached"
  /** The user confirmed login but the session shows no signed-in surface. */
  | "authentication_not_confirmed"
  | "unsafe_navigation"
  | "external_navigation_blocked"
  | "download_blocked"
  | "mutation_blocked"
  | "navigation_timeout"
  | "page_unreachable"
  | "analysis_budget_reached"
  | "browser_provider_unavailable"
  | "analysis_failed";

/**
 * Non-fatal observations recorded on a snapshot.
 *
 * `non_get_request_blocked` and `application_requires_mutating_method_for_render`
 * exist because blocking mutations can legitimately break a page that hydrates
 * over POST (Sprint 5 §18). When that happens the analysis is reported as
 * degraded rather than silently presented as complete — safety wins, and the
 * user is told.
 */
export type AuthenticatedWarningCode =
  | "non_get_request_blocked"
  | "application_requires_mutating_method_for_render"
  | "download_blocked"
  | "external_navigation_blocked"
  | "navigation_timeout"
  | "page_unreachable"
  | "origin_mismatch_skipped"
  | "extra_tab_ignored"
  | "budget_reached";
