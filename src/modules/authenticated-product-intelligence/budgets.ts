/**
 * Central budgets for authenticated analysis (Sprint 5 §20).
 *
 * Deliberately *smaller* than the public crawler's. A real browser rendering a
 * logged-in application is expensive in provider seconds and can contain real
 * customer data, so the goal is a product's authenticated *shape* — dashboard,
 * onboarding, settings, billing — not a copy of a SaaS app.
 *
 * Reaching a budget is never an error. It downgrades the snapshot to `partial`
 * with a machine-readable reason, and whatever was learned is still returned.
 */
export type AuthenticatedCrawlBudgets = {
  /** Authenticated pages actually inspected. */
  maxPages: number;
  /** Route candidates considered before origin filtering and prioritisation. */
  maxCandidates: number;
  /** Link depth from the landing page (landing page is depth 0). */
  maxDepth: number;
  /** Same-origin links harvested from one page. */
  maxLinksPerPage: number;
  /** Per-navigation ceiling. */
  navigationTimeoutMs: number;
  /** Wall-clock ceiling for the whole analysis, checked between navigations. */
  maxDurationMs: number;
  /** Longest single extracted label retained. */
  maxLabelLength: number;
  /** Labels retained per list on one page. */
  maxLabelsPerList: number;
};

export const DEFAULT_AUTHENTICATED_BUDGETS: AuthenticatedCrawlBudgets = {
  maxPages: 8,
  maxCandidates: 50,
  maxDepth: 2,
  maxLinksPerPage: 60,
  navigationTimeoutMs: 15_000,
  maxDurationMs: 90_000,
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
