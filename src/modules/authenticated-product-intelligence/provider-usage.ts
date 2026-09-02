import { estimateSandboxCost } from "@/modules/economy/sandbox-usage-estimate";
import type { BrowserSessionUsage } from "./provider";
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
  /**
   * Vibe's own derivation from the dimensions the provider *did* report
   * (ADR 0076).
   *
   * Kept apart from `providerCostUsd` in different fields and a different
   * `cost_status`, because folding a computed figure into a column that means
   * "the provider charged this" everywhere else is how an assumption gets
   * summed as a measurement — the thing `economy/cost.ts` exists to prevent.
   *
   * Null when the session reported nothing measurable, which is every session
   * that never came up and every one recorded before this existed.
   */
  activeCpuMs: number | null;
  outboundBytes: number | null;
  estimatedCostNanoUsd: number | null;
  costPricingVersion: string | null;
  vcpus: number | null;
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
  /** What termination reported, or null when it reported nothing. */
  usage?: BrowserSessionUsage | null;
}): DeepScanProviderUsage {
  const durationMs = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime());
  const usage = input.usage ?? null;

  /*
   * The estimate, derived only when there is something to derive it from.
   *
   * `estimateSandboxCost` owns the arithmetic — it is the one place a
   * sandbox row's cost is computed, and adding a second would be the mistake
   * its own header describes. The wall clock passed to it is Vibe's own
   * measurement of the session rather than the provider's, because the
   * provider does not report one and this is the same interval it billed
   * memory for.
   */
  const estimate = usage
    ? estimateSandboxCost({
        purpose: "deep_scan_browser",
        sandboxDurationMs: durationMs,
        activeCpuMs: usage.activeCpuMs,
        outboundBytes: usage.outboundBytes,
        vcpus: usage.vcpus,
      })
    : null;

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
    activeCpuMs: usage?.activeCpuMs ?? null,
    outboundBytes: usage?.outboundBytes ?? null,
    estimatedCostNanoUsd: estimate?.estimatedCostNanoUsd ?? null,
    // Both carried only when a figure was actually produced: the database
    // constraint refuses an estimate without them, because an estimate whose
    // rate and allocation are unknown is a number rather than an estimate.
    costPricingVersion: estimate?.estimatedCostNanoUsd == null ? null : estimate.pricingVersion,
    vcpus: estimate?.estimatedCostNanoUsd == null ? null : estimate.vcpus,
  };
}
