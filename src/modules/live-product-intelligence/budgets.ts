/**
 * Central crawl budgets (Sprint 3 §8).
 *
 * Every limit that bounds an outbound request lives here, so no call site
 * can quietly crawl further, longer, or larger than agreed. Values are
 * deliberately small: the detectors need a product's *shape* — homepage,
 * pricing, login, contact — not an exhaustive copy of the site, so a
 * dozen pages buys nearly all the signal a hundred would.
 *
 * Reaching a budget is never an error. It downgrades the snapshot to
 * `partial` with a machine-readable reason, and whatever was already
 * learned is still returned (Sprint 3 §8).
 */
export type CrawlBudgets = {
  /** Pages fetched and parsed, homepage included. */
  maxPages: number;
  /** Links considered from a single page, before same-origin filtering. */
  maxLinksPerPage: number;
  /** Largest single response body accepted. */
  maxBytesPerPage: number;
  /** Cumulative bytes across the whole crawl. */
  maxTotalBytes: number;
  /** Redirect hops followed for one request, each independently revalidated. */
  maxRedirects: number;
  /** Link depth from the homepage (homepage is depth 0). */
  maxDepth: number;
  /** Per-request ceiling, including connect and TLS handshake. */
  requestTimeoutMs: number;
  /** Wall-clock ceiling for the whole analysis; checked between requests. */
  maxDurationMs: number;
  /** Requests in flight at once — politeness, not throughput. */
  maxConcurrency: number;
  /** URLs taken from sitemaps as discovery hints. */
  maxSitemapUrls: number;
  maxSitemapBytes: number;
  maxRobotsBytes: number;
};

export const DEFAULT_CRAWL_BUDGETS: CrawlBudgets = {
  maxPages: 12,
  maxLinksPerPage: 80,
  maxBytesPerPage: 1024 * 1024,
  maxTotalBytes: 6 * 1024 * 1024,
  maxRedirects: 3,
  maxDepth: 2,
  requestTimeoutMs: 6_000,
  maxDurationMs: 20_000,
  maxConcurrency: 2,
  maxSitemapUrls: 100,
  maxSitemapBytes: 512 * 1024,
  maxRobotsBytes: 64 * 1024,
};

/** Machine-readable reasons a snapshot is `partial` rather than `complete`. */
export type CrawlCompletenessReason =
  | "page_budget_reached"
  | "byte_budget_reached"
  | "crawl_depth_reached"
  | "link_budget_reached"
  | "sitemap_budget_reached"
  | "timeout"
  | "rate_limited"
  | "robots_disallowed"
  | "fetch_failed";

export type CrawlCompleteness = "complete" | "partial";

/**
 * Mutable budget state for one crawl. Holds every limit check in one
 * place so the crawler asks "may I?" rather than each call site
 * re-deriving the arithmetic.
 */
export class CrawlBudgetTracker {
  private pagesFetched = 0;
  private bytesFetched = 0;
  private requestCount = 0;
  private readonly startedAt = Date.now();
  private readonly reasons = new Set<CrawlCompletenessReason>();

  constructor(private readonly budgets: CrawlBudgets = DEFAULT_CRAWL_BUDGETS) {}

  get limits(): CrawlBudgets {
    return this.budgets;
  }

  note(reason: CrawlCompletenessReason): void {
    this.reasons.add(reason);
  }

  /** True when another page may still be fetched under every budget. */
  canFetchPage(): boolean {
    if (this.pagesFetched >= this.budgets.maxPages) {
      this.reasons.add("page_budget_reached");
      return false;
    }
    if (this.bytesFetched >= this.budgets.maxTotalBytes) {
      this.reasons.add("byte_budget_reached");
      return false;
    }
    if (this.expired) {
      this.reasons.add("timeout");
      return false;
    }
    return true;
  }

  get expired(): boolean {
    return Date.now() - this.startedAt >= this.budgets.maxDurationMs;
  }

  /** Time left for one request, so a slow page cannot outlive the whole budget. */
  get remainingRequestTimeoutMs(): number {
    const remaining = this.budgets.maxDurationMs - (Date.now() - this.startedAt);
    return Math.max(0, Math.min(this.budgets.requestTimeoutMs, remaining));
  }

  /** Bytes still allowed for a single response. */
  get remainingBytesPerPage(): number {
    const remainingTotal = this.budgets.maxTotalBytes - this.bytesFetched;
    return Math.max(0, Math.min(this.budgets.maxBytesPerPage, remainingTotal));
  }

  recordRequest(bytes: number): void {
    this.requestCount += 1;
    this.bytesFetched += bytes;
  }

  recordPage(): void {
    this.pagesFetched += 1;
  }

  get stats(): {
    pagesFetched: number;
    bytesFetched: number;
    requestCount: number;
    durationMs: number;
  } {
    return {
      pagesFetched: this.pagesFetched,
      bytesFetched: this.bytesFetched,
      requestCount: this.requestCount,
      durationMs: Date.now() - this.startedAt,
    };
  }

  get completenessReasons(): CrawlCompletenessReason[] {
    return [...this.reasons];
  }

  get completeness(): CrawlCompleteness {
    return this.reasons.size === 0 ? "complete" : "partial";
  }
}
