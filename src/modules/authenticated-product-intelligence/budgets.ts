/**
 * Central budgets for authenticated analysis (Sprint 5 §20).
 *
 * Deliberately *smaller* than the public crawler's. The goal is a product's
 * authenticated **shape** — dashboard, onboarding, settings, billing — not a
 * copy of a SaaS app, and a browser rendering someone's logged-in application
 * can put real customer data on a screen.
 *
 * Reaching a budget is never an error. It downgrades the snapshot to `partial`
 * with a machine-readable reason, and whatever was learned is still returned.
 *
 * ## Why `maxPages` moved, and what it is sized against now
 *
 * It was 8, and the sentence justifying it said a real browser "is expensive in
 * provider seconds". That was true of Browserbase. Since
 * [ADR 0076](../../../docs/decisions/0076-the-browser-we-own.md) the browser is
 * a Vercel sandbox at 2 vCPU, and the first real scan measured what that costs:
 * a 128-second session — 112 of them a person typing a password — for
 * **$0.0121** against $0.441 of revenue.
 *
 * But cost is not the argument for the new number, because cost was the wrong
 * argument for the old one. **The list of surfaces this analysis exists to find
 * is ten long** (`AuthenticatedSurfaceId`), and a budget of eight pages cannot
 * describe ten surfaces — not even if every page visited were a different one,
 * none of them the landing page, and no surface ever needed two pages to
 * recognise. The number was never sized against the job.
 *
 * Twenty-five is: roughly two pages per surface, because a settings area is a
 * list and a detail, plus the landing page, plus room for pages that turn out
 * to be none of them. The first real scan found **72 candidates and inspected
 * 8**, reaching depth 1 of an allowed 2 — it ran out of pages before it ran out
 * of product.
 *
 * What that costs, at the same 2.0 seconds per page that scan measured: about
 * $0.0153 typically and $0.0248 if a slow login is followed by a full
 * analysis — **96.5% and 94.4% margin**. Even the 10-minute session ceiling,
 * which no analysis approaches, is 87%.
 *
 * `maxCandidates` moves for a different reason: 50 truncated a list of 72
 * *before prioritisation*, so it did not merely shorten the crawl, it changed
 * which pages were eligible to be chosen. Candidates are URLs held in memory
 * and cost nothing to consider.
 *
 * `maxDepth`, `maxLinksPerPage` and `navigationTimeoutMs` are unchanged. Depth
 * is the guard against wandering out of the product, and the scan that
 * prompted this never reached its limit.
 */
export type AuthenticatedCrawlBudgets = {
  /** Authenticated pages actually inspected. */
  maxPages: number;
  /**
   * Pages inspected per route template (`/app/projects/:id/settings`).
   *
   * The budget exists to describe a product's *shape*, and a screen holding
   * different rows is the same screen. The first run that read pages properly
   * spent 25 pages on 8 screens — four copies each of a project workspace's
   * seven tabs — and reported `integrations` and `onboarding` as absent
   * because it never reached them.
   */
  maxPagesPerRouteShape: number;
  /** Route candidates considered before origin filtering and prioritisation. */
  maxCandidates: number;
  /** Link depth from the landing page (landing page is depth 0). */
  maxDepth: number;
  /** Same-origin links harvested from one page. */
  maxLinksPerPage: number;
  /** Per-navigation ceiling. */
  navigationTimeoutMs: number;
  /**
   * How long a page must hold still before it counts as settled.
   *
   * A single-page application answers `goto` when the document exists and then
   * keeps routing on its own — an auth check, a redirect to a canonical path,
   * a shell that replaces the URL once its data arrives. Reading during that
   * gets "Execution context was destroyed"; navigating during it aborts the
   * next page. Both were happening: one scan inspected **one** page of
   * sixteen and every failure named the page before it.
   */
  settleQuietMs: number;
  /** The longest Vibe waits for a page to hold still before reading it anyway. */
  settleTimeoutMs: number;
  /** Wall-clock ceiling for the whole analysis, checked between navigations. */
  maxDurationMs: number;
  /** Longest single extracted label retained. */
  maxLabelLength: number;
  /** Labels retained per list on one page. */
  maxLabelsPerList: number;
};

export const DEFAULT_AUTHENTICATED_BUDGETS: AuthenticatedCrawlBudgets = {
  /** Ten surfaces to find, about two pages each, plus the landing page. */
  maxPages: 25,
  /*
   * Two, not one.
   *
   * A second instance is worth a page because it is often a *different state*
   * of the same screen — the run that prompted this detected `empty_state`
   * from exactly that, one Action Plan with content and one without. A third
   * is the same lesson a third time.
   */
  maxPagesPerRouteShape: 2,
  /** Above what a real product offered, so prioritisation chooses from all of it. */
  maxCandidates: 150,
  maxDepth: 2,
  maxLinksPerPage: 60,
  navigationTimeoutMs: 15_000,
  /*
   * Half a second of stillness, waited up to five.
   *
   * Long enough to outlast a framework's own redirect, which is one paint, and
   * short enough that twenty-five settled pages still fit inside the
   * three-minute ceiling below with room to spare. Reaching the timeout is not
   * a failure: the page is read as it stands, because a page that never stops
   * moving is still worth describing.
   */
  settleQuietMs: 500,
  settleTimeoutMs: 5_000,
  /*
   * Three minutes, and it stays the thing that ends a scan.
   *
   * 25 pages at the measured 2.0 seconds each is 50; the rest is room for
   * pages that take the 15-second navigation ceiling rather than two. The
   * route's own `maxDuration` is set above this on purpose — see
   * `product/deep-scan/page.tsx` — so a scan ends because Vibe decided it had
   * seen enough, never because the platform killed the function.
   */
  maxDurationMs: 180_000,
  maxLabelLength: 120,
  maxLabelsPerList: 12,
};

export type AuthenticatedCompletenessReason =
  | "page_budget_reached"
  | "candidate_budget_reached"
  | "depth_reached"
  | "timeout"
  | "navigation_failed"
  | "mutation_blocked"
  | "external_navigation_blocked";

export type AuthenticatedCompleteness = "complete" | "partial";

/** Mutable budget state for one authenticated analysis. */
export class AuthenticatedBudgetTracker {
  private pagesInspected = 0;
  private candidatesConsidered = 0;
  private readonly startedAt: number;
  private readonly reasons = new Set<AuthenticatedCompletenessReason>();

  constructor(
    private readonly budgets: AuthenticatedCrawlBudgets = DEFAULT_AUTHENTICATED_BUDGETS,
    /** Injectable clock so tests can exercise expiry without waiting. */
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  get limits(): AuthenticatedCrawlBudgets {
    return this.budgets;
  }

  note(reason: AuthenticatedCompletenessReason): void {
    this.reasons.add(reason);
  }

  canInspectPage(): boolean {
    if (this.pagesInspected >= this.budgets.maxPages) {
      this.reasons.add("page_budget_reached");
      return false;
    }
    if (this.expired) {
      this.reasons.add("timeout");
      return false;
    }
    return true;
  }

  /** Records a candidate, returning false once the candidate budget is spent. */
  acceptCandidate(): boolean {
    if (this.candidatesConsidered >= this.budgets.maxCandidates) {
      this.reasons.add("candidate_budget_reached");
      return false;
    }
    this.candidatesConsidered += 1;
    return true;
  }

  get expired(): boolean {
    return this.now() - this.startedAt >= this.budgets.maxDurationMs;
  }

  /** Time left for one navigation, so a slow page cannot outlive the analysis. */
  get remainingNavigationTimeoutMs(): number {
    const remaining = this.budgets.maxDurationMs - (this.now() - this.startedAt);
    return Math.max(0, Math.min(this.budgets.navigationTimeoutMs, remaining));
  }

  recordPage(): void {
    this.pagesInspected += 1;
  }

  get stats(): { pagesInspected: number; candidatesConsidered: number; durationMs: number } {
    return {
      pagesInspected: this.pagesInspected,
      candidatesConsidered: this.candidatesConsidered,
      durationMs: this.now() - this.startedAt,
    };
  }

  get completenessReasons(): AuthenticatedCompletenessReason[] {
    return [...this.reasons];
  }

  get completeness(): AuthenticatedCompleteness {
    return this.reasons.size === 0 ? "complete" : "partial";
  }
}
