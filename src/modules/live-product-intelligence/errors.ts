/**
 * Typed domain errors for live product inspection (Sprint 3 §32).
 *
 * Same discipline as the GitHub module: callers switch on `code` and
 * render their own copy. A raw socket error, TLS message, or upstream
 * response body must never reach the browser — those describe internal
 * network topology and upstream infrastructure, which is exactly what an
 * SSRF probe would be fishing for.
 */

export type LiveProductErrorCode =
  | "invalid_production_url"
  | "unsafe_destination"
  | "dns_resolution_failed"
  | "homepage_unreachable"
  | "tls_error"
  | "too_many_redirects"
  | "unsupported_content_type"
  | "page_too_large"
  | "crawl_budget_reached"
  | "site_rate_limited"
  | "site_forbidden"
  | "analysis_failed";

export class LiveProductDomainError extends Error {
  constructor(
    public readonly code: LiveProductErrorCode,
    /** Safe technical detail for server logs only — never rendered to users. */
    public readonly status?: number,
  ) {
    super(code);
    this.name = "LiveProductDomainError";
  }
}
