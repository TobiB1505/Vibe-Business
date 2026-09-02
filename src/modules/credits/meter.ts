import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRateCard } from "./rating";
import { rateUsage } from "./rating";
import { projectAiUsage, projectSandboxUsage, type AiUsageRow, type SandboxUsageRow } from "./projection";
import type { BillableUsage } from "./schema";
import { projectUsageEvents } from "./store";

/**
 * Projecting usage the moment it is measured (ADR 0073).
 *
 * ## Why this exists
 *
 * `billing_usage_events` is the ledger that makes margin knowable — it is the
 * table `credits/margin-guard.ts` reads and the one every price in
 * `retail.ts` was derived from. On 2026-09-02 its newest row was six days old.
 *
 * Not because anything was broken. `reconcileUsage` is correct, idempotent and
 * well tested, and it had **exactly one caller: a probe**. The ledger filled up
 * when an operator remembered to type `pnpm billing:dogfood`, which is a fine
 * design for a repair pass and no design at all for the primary path.
 *
 * So the projection happens where the measurement happens. `reconcileUsage`
 * keeps its job — finding what this missed — rather than being the only way
 * anything arrives.
 *
 * ## Why not a cron, a queue or a background sweep
 *
 * Because usage is created by an operation and can be projected by the same
 * operation, so nothing here needs a clock. [Rule 24](../../../CLAUDE.md)
 * requires an ADR before a second background technology, and "it needs no new
 * infrastructure" remains the argument to prefer — this is that argument, met.
 *
 * ## Why it can never fail its caller
 *
 * Every caller has already spent the provider's money. A ledger write failing
 * must not fail the run that earned it — the rule `recordAIUsage` and
 * `recordSandboxUsage` already follow, and the reason the repair pass exists.
 */

/**
 * Projects one sandbox usage row into the billing ledger.
 *
 * Idempotent through `billing_usage_events_source_sku_idx`, so a row projected
 * here and again by a later reconciliation produces one event per SKU either
 * way. That is what makes running both safe rather than merely tolerable.
 */
export async function meterSandboxUsage(
  supabase: SupabaseClient,
  row: SandboxUsageRow,
  now: Date = new Date(),
): Promise<void> {
  await meter(supabase, row.id, projectSandboxUsage(row), now);
}

/**
 * Projects one AI usage row into the billing ledger.
 *
 * The other half of the same ledger, and the half that carries the cost every
 * price in `retail.ts` was derived from. Metering the sandbox and not this
 * would leave a ledger that is current about infrastructure and six days stale
 * about the model — worse than either, because a sum over it would look whole.
 */
export async function meterAiUsage(
  supabase: SupabaseClient,
  row: AiUsageRow,
  now: Date = new Date(),
): Promise<void> {
  await meter(supabase, row.id, projectAiUsage(row), now);
}

async function meter(
  supabase: SupabaseClient,
  sourceId: string,
  usage: BillableUsage[],
  now: Date,
): Promise<void> {
  try {
    if (usage.length === 0) return;

    // The same rating the reconciliation applies, resolved per row rather than
    // across a batch: a rate card prices usage, and aggregating unrelated
    // operations before rounding would let one project's rounding subsidise
    // another's. `CREDIT_RATE_CARDS` is empty, so this resolves to
    // `rate_card_not_configured` — measured and costed, deliberately not rated.
    const card = resolveRateCard(now) ?? undefined;
    const rating = rateUsage(usage, card ? { card } : {});

    await projectUsageEvents(
      supabase,
      usage.map((event) => ({
        ...event,
        ratingStatus: rating.status,
        ratedCredits: null,
        rateCardVersion: rating.rateCardVersion,
      })),
    );
  } catch (error) {
    console.error("[billing] failed to meter usage", {
      sourceId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
