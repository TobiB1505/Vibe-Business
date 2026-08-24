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
  | "fetch_failed"
  /**
   * The one member that is not about the crawl stopping short (Sprint 0082).
   *
   * Every reason above means Vibe did not reach everything. This one means it
   * reached the page, fetched it successfully, and found a document that
   * renders in the browser — so there was nothing to read. It shares this type
   * because the consequence is identical and already respected everywhere:
   * absence in this snapshot must not be read as a fact about the product.
   * A second, parallel flag would have to be honoured by every consumer
   * separately, and the first one to forget would state a zero as the truth.
   */
  | "client_rendered";

export type CrawlCompleteness = "complete" | "partial";

/**
 * What each reason is called when a person or a model reads it.
 *
 * Published rather than kept private because two consumers interpolate the
 * reason list into a sentence — the evidence pack a model reads and the human
 * view a founder reads — and until Sprint 0082 both interpolated the raw enum.
 * `page_budget_reached` is not a phrase, and `client_rendered` arriving as an
 * enum member is exactly the failure this sprint exists to fix.
 */
export const CRAWL_COMPLETENESS_REASON_LABELS: Record<CrawlCompletenessReason, string> = {
  page_budget_reached: "the page limit was reached",
  byte_budget_reached: "the download limit was reached",
  crawl_depth_reached: "the crawl depth limit was reached",
  link_budget_reached: "a page had more links than could be followed",
  sitemap_budget_reached: "the sitemap was larger than could be read",
  timeout: "the check ran out of time",
  rate_limited: "the site rate-limited the check",
  robots_disallowed: "robots.txt disallowed part of the site",
  fetch_failed: "a page could not be fetched",
  client_rendered: "some pages build themselves in the browser, so Vibe could not read them",
};

/** Reads as a list of reasons, already in the words a person should see. */
export function describeCompletenessReasons(reasons: readonly CrawlCompletenessReason[]): string {
  return reasons.map((reason) => CRAWL_COMPLETENESS_REASON_LABELS[reason]).join("; ");
}

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
