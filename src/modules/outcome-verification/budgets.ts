/**
 * Central budgets for outcome observation (Sprint 12A §12, §15, §17).
 *
 * Every limit that bounds an outbound request or a parsed document lives here,
 * so no call site can quietly observe longer, larger, or more often than
 * agreed — the same discipline `live-product-intelligence/budgets.ts` applies to
 * the crawler, and required by CLAUDE.md rule 27 and rule 39.
 *
 * The numbers are much smaller than the crawler's, because this is a much
 * smaller act. **Outcome verification is not a crawl.** It requests the exact
 * paths its contract names, reads derived facts out of them, and follows
 * nothing.
 *
 * The worst case is the profile with the most resources. For the SEO profile it
 * is fourteen requests over fifteen minutes — two documents, seven attempts. For
 * the agentic profile it is `maxObservedRoutes` pages times the same seven
 * attempts, and only when nothing ever passes: an intact site answers on the
 * first attempt and the window closes there (§20).
 */
export type OutcomeBudgets = {
  /** Largest robots.txt accepted. */
  maxRobotsBytes: number;
  /**
   * Largest public page accepted, matched to the crawler's own per-page budget.
   *
   * Deliberately not smaller. A page probe only needs the status line, the
   * content type and the final URL — but `node-transport.ts` refuses a response
   * whose declared `content-length` exceeds the budget, so a budget sized to
   * what we *read* would reject most real pages before their status was ever
   * observed, and report a healthy site as unreachable.
   */
  maxRoutePageBytes: number;
  /** Largest sitemap accepted — a real defence, not a formality (§15). */
  maxSitemapBytes: number;
  /** `<loc>` values read from one sitemap before the scan stops. */
  maxSitemapUrls: number;
  /** Per-request ceiling, including connect and TLS handshake. */
  requestTimeoutMs: number;
  /** Redirect hops followed for one request, each independently revalidated. */
  maxRedirects: number;
  /** Wall-clock window in which the intended behaviour may still appear (§17). */
  observationWindowMs: number;
  /**
   * Offsets from the start of the window at which an observation is made.
   *
   * Front-loaded and then spaced out, because the interesting cases cluster at
   * both ends: a deployment that already finished answers on the first attempt
   * and the workflow exits immediately (§20), while a slow build is worth one
   * patient look near the deadline rather than sixty impatient ones.
   *
   * Seven attempts, so at most fourteen public GETs. That is politeness as much
   * as budget: this is somebody's production website.
   */
  attemptOffsetsMs: readonly number[];
  /**
   * Public pages one contract may probe.
   *
   * Small, and for politeness rather than cost: every one of these is a real
   * GET against somebody's production website, repeated on each attempt. A
   * change touching more pages than this is verified over the first
   * `maxObservedRoutes` in route order and marks the expectation `truncated`,
   * which is the same answer the SEO contract gives when its own lists run
   * over (CLAUDE.md rule 27).
   */
  maxObservedRoutes: number;
};

export const DEFAULT_OUTCOME_BUDGETS: OutcomeBudgets = {
  maxRobotsBytes: 64 * 1024,
  maxRoutePageBytes: 1024 * 1024,
  maxSitemapBytes: 512 * 1024,
  maxSitemapUrls: 500,
  requestTimeoutMs: 6_000,
  maxRedirects: 3,
  observationWindowMs: 15 * 60 * 1000,
  attemptOffsetsMs: [0, 30_000, 60_000, 120_000, 240_000, 480_000, 900_000],
  maxObservedRoutes: 4,
};

/**
 * The largest number of private prefixes one contract may assert the absence
 * of (§5).
 *
 * Bounded so a repository with hundreds of route segments cannot produce an
 * unbounded expectation snapshot. Reaching it marks the expectation `truncated`
 * rather than silently narrowing what was checked (CLAUDE.md rule 27).
 */
export const MAX_PRIVATE_PREFIX_CHECKS = 12;

/**
 * The largest number of public paths one contract may require the presence of.
 *
 * Same reasoning, and deliberately smaller: a sitemap missing one of forty
 * marketing pages is a weaker signal than a sitemap advertising a login form,
 * so the absence budget is the more generous of the two.
 */
export const MAX_PUBLIC_PATH_CHECKS = 8;
