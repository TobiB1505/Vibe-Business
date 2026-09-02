import type { DeepScanAccessMode } from "./entitlement";

/**
 * Browser-provider usage measurement (Sprint 5 §11).
 *
 * The first Deep Scan is free to the **user**, not to Vibe. A remote browser
 * bills wall-clock seconds, so the point of this record is to answer, later and
 * from real data: *what does an included Deep Scan actually cost us, and what
 * would a credit-funded one cost?*
 *
 * Two deliberate separations:
 *
 *  1. **Not merged into the token ledger.** `ai_usage_events` measures
 *     inference: input/output tokens against effective-dated per-token prices.
 *     A browser session has no tokens and no per-token price. Forcing both into
 *     one table would make every future cost question ambiguous.
 *  2. **Cost is never fabricated.** The browser provider does not return a price with
 *     the session, so `providerCostUsd` stays null and duration is persisted
 *     instead. A cost computed from a rate we invented would look like
 *     measurement while being a guess — the same discipline the AI pricing
 *     module follows.
 */

export type DeepScanUsageStatus = "completed" | "failed" | "cancelled" | "expired";

export type DeepScanProviderUsage = {
  provider: string;
  operation: "authenticated_product_analysis";
  projectId: string;
  /** Vibe's own session id, never the provider's (Sprint 5 §6, §12). */
  sessionId: string;
  /** Which entitlement funded the run, so cost can be split by mode later. */
  accessMode: DeepScanAccessMode;
  startedAt: Date;
  endedAt: Date;
  /** Wall-clock the remote browser was billable for. */
  durationMs: number;
  status: DeepScanUsageStatus;
  /** Known only for a completed analysis. */
  pagesInspected: number | null;
  /**
   * Null unless the provider reports a real figure synchronously. Deriving one
   * from an assumed rate would be a guess dressed as a measurement.
   */
  providerCostUsd: null;
};

export function buildDeepScanUsage(input: {
  provider: string;
  projectId: string;
  sessionId: string;
  accessMode: DeepScanAccessMode;
  startedAt: Date;
  endedAt: Date;
  status: DeepScanUsageStatus;
  pagesInspected?: number | null;
}): DeepScanProviderUsage {
  const durationMs = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime());

  return {
    provider: input.provider,
    operation: "authenticated_product_analysis",
    projectId: input.projectId,
    sessionId: input.sessionId,
    accessMode: input.accessMode,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs,
    status: input.status,
    pagesInspected: input.pagesInspected ?? null,
    providerCostUsd: null,
  };
}
