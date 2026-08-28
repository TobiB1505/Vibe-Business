import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { alertOperator } from "@/lib/observability/alert";
import { nanoUsdToUsdString } from "@/modules/ai/pricing";
import { storedCostToNanoUsd } from "./projection";

/**
 * Notices an account burning provider money, at the moment it burns it
 * (VB-033).
 *
 * ## Why not the scheduled reader the finding asks for
 *
 * The finding's remedy is "scheduled ledger read + thresholds". A scheduler is
 * a background technology this product has not decided to have, and
 * [rule 24](../../../CLAUDE.md) says adding one takes an ADR rather than an
 * import. That is the whole reason VB-033 sat blocked.
 *
 * It is also the wrong shape for the question. A periodic sweep learns about a
 * spike up to one interval late; this runs at the write that *causes* the
 * spend, which is both timelier and free of new infrastructure. It is the same
 * doctrine the staleness backstop and the drift repair already follow — act at
 * a moment somebody already caused.
 *
 * ## What it does not do
 *
 * **It does not refuse anything.** A per-user spend ceiling is a decision about
 * what a customer is allowed to do with money they have already paid for, and
 * that is a product decision, not an engineering one. This tells Vibe; it does
 * not tell the customer no. VB-008's start limits already bound how *often*
 * work can begin, which is the crude guard underneath.
 *
 * **It is per account, not platform-wide.** Summing every account's spend on
 * every paid call would put a growing aggregate on the hot path of the thing it
 * measures. The platform-wide view is the half that genuinely wants a scheduled
 * reader, and it stays open.
 */

/** The window a spend total is measured over. */
export const SPEND_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Where one account's provider cost in a day becomes worth a look.
 *
 * $25. Chosen rather than measured, and the honest reasoning is the ratio: a
 * Business Audit's real dogfood runs have cost around $0.20 and an agent
 * execution more, so this is two orders of magnitude above ordinary use and
 * comfortably below a bill anybody would be upset to discover. It is a notice
 * threshold, not a limit — nothing is refused when it is crossed.
 */
export const ACCOUNT_SPEND_NOTICE_NANO_USD = 25_000_000_000;

/**
 * How many usage rows one observation reads.
 *
 * A loop guard rather than a product limit. An account that produced more than
 * this in a day has already crossed every threshold there is, so a truncated
 * sum reaching the same conclusion is not a defect — but the truncation is
 * reported, because a total that says "at least" is a different claim from one
 * that says "exactly".
 */
export const SPEND_SAMPLE_LIMIT = 500;

export type SpendObservation = {
  totalNanoUsd: number;
  eventCount: number;
  /** True when the sample hit its cap, so the total is a lower bound. */
  truncated: boolean;
};

/** Sums stored provider costs in integers — never floating-point dollars. */
export function summarizeSpend(rows: readonly { provider_cost_usd: unknown }[]): SpendObservation {
  let totalNanoUsd = 0;

  for (const row of rows) {
    const nano = storedCostToNanoUsd(row.provider_cost_usd as string | number | null);
    if (nano !== null) totalNanoUsd += nano;
  }

  return {
    totalNanoUsd,
    eventCount: rows.length,
    truncated: rows.length >= SPEND_SAMPLE_LIMIT,
  };
}

export function crossesNotice(observation: SpendObservation): boolean {
  return observation.totalNanoUsd >= ACCOUNT_SPEND_NOTICE_NANO_USD;
}

/**
 * Reads one account's last day of provider cost and reports it if it is large.
 *
 * Never throws. It runs immediately after a usage event is written, and a
 * failure to *observe* spend must not fail the operation that spent it — the
 * same reasoning `recordAIUsage` itself is built on.
 *
 * Requires a client that can read `ai_usage_events`, which has an insert policy
 * and no select policy. Since VB-036 that is the service-role client only,
 * which is also the only client that can have written the row this follows.
 */
export async function observeAccountSpend(
  supabase: SupabaseClient,
  params: { userId: string; now?: Date },
): Promise<void> {
  try {
    const since = new Date((params.now?.getTime() ?? Date.now()) - SPEND_WINDOW_MS);

    const { data, error } = await supabase
      .from("ai_usage_events")
      .select("provider_cost_usd")
      .eq("user_id", params.userId)
      .gte("created_at", since.toISOString())
      .limit(SPEND_SAMPLE_LIMIT);

    if (error) return;

    const observation = summarizeSpend((data ?? []) as { provider_cost_usd: unknown }[]);
    if (!crossesNotice(observation)) return;

    await alertOperator(
      "[billing] one account's provider spend crossed the daily notice threshold",
      {
        userId: params.userId,
        spendUsd: nanoUsdToUsdString(observation.totalNanoUsd),
        eventCount: observation.eventCount,
        truncated: observation.truncated,
        windowHours: SPEND_WINDOW_MS / 3_600_000,
      },
      "warning",
    );
  } catch {
    // Observing spend must not be able to fail the work that spent it.
  }
}
