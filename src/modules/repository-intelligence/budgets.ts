/**
 * Central resource budgets for repository analysis (Sprint 2 §7).
 *
 * These exist to make the cost of inspecting a repository bounded and
 * predictable — both in GitHub API calls and in wall-clock time inside a
 * synchronous request. Values are deliberately conservative: the
 * detectors depend on a small set of high-value manifests, not on
 * reading a repository exhaustively, so a low file budget costs very
 * little detection quality while capping worst-case cost on a large
 * monorepo.
 *
 * Reaching a budget is never an error — it downgrades the snapshot's
 * completeness to `partial` with a machine-readable reason.
 */
export type AnalysisBudgets = {
  /** Tree entries considered when selecting candidates. */
  maxTreeEntries: number;
  /** Upper bound on individual file-content fetches (≈ GitHub API calls). */
  maxFileFetches: number;
  /** Largest single file we will download and parse. */
  maxBytesPerFile: number;
  /** Cumulative downloaded bytes across all fetched files. */
  maxTotalBytes: number;
  /** Wall-clock ceiling; checked between fetches, not enforced mid-request. */
  maxDurationMs: number;
  /** Path segments deep we still consider for route/candidate detection. */
  maxPathDepth: number;
};

export const DEFAULT_ANALYSIS_BUDGETS: AnalysisBudgets = {
  maxTreeEntries: 20_000,
  maxFileFetches: 40,
  maxBytesPerFile: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxDurationMs: 20_000,
  maxPathDepth: 12,
};

/** Machine-readable reasons a snapshot is `partial` rather than `complete`. */
export type CompletenessReason =
  | "tree_truncated"
  | "tree_entry_budget_reached"
  | "file_budget_reached"
  | "byte_budget_reached"
  | "duration_budget_reached"
  | "unsupported_structure";

export type AnalysisCompleteness = "complete" | "partial";

/**
 * Mutable budget tracker for one analysis run. Keeps every budget check
 * in one place so no call site can accidentally fetch outside the limits.
 */
export class BudgetTracker {
  private filesFetched = 0;
  private bytesFetched = 0;
  private readonly startedAt = Date.now();
  private readonly reasons = new Set<CompletenessReason>();

  constructor(private readonly budgets: AnalysisBudgets = DEFAULT_ANALYSIS_BUDGETS) {}

  get limits(): AnalysisBudgets {
    return this.budgets;
  }

  /** Records a reason without itself implying the run must stop. */
  note(reason: CompletenessReason): void {
    this.reasons.add(reason);
  }

  /** True when another file of at most `maxBytesPerFile` may still be fetched. */
  canFetchFile(): boolean {
    if (this.filesFetched >= this.budgets.maxFileFetches) {
      this.reasons.add("file_budget_reached");
      return false;
    }
    if (this.bytesFetched >= this.budgets.maxTotalBytes) {
      this.reasons.add("byte_budget_reached");
      return false;
    }
    if (Date.now() - this.startedAt >= this.budgets.maxDurationMs) {
      this.reasons.add("duration_budget_reached");
      return false;
    }
    return true;
  }

  recordFetch(bytes: number): void {
    this.filesFetched += 1;
    this.bytesFetched += bytes;
  }

  get stats(): { filesFetched: number; bytesFetched: number; durationMs: number } {
    return {
      filesFetched: this.filesFetched,
      bytesFetched: this.bytesFetched,
      durationMs: Date.now() - this.startedAt,
    };
  }

  get completenessReasons(): CompletenessReason[] {
    return [...this.reasons];
  }

  get completeness(): AnalysisCompleteness {
    return this.reasons.size === 0 ? "complete" : "partial";
  }
}
