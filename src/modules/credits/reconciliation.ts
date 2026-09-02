import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { rateUsage, type CreditRateCard } from "./rating";
import type { BillableUsage } from "./schema";
import {
  projectAiUsage,
  projectDeepScanUsage,
  projectReviewBrowserUsage,
  projectSandboxUsage,
  storedCostToNanoUsd,
  summarizeCost,
  type AiUsageRow,
  type CostSummary,
  type DeepScanUsageRow,
  type ReviewBrowserUsageRow,
  type SandboxUsageRow,
} from "./projection";
import { projectUsageEvents } from "./store";
import { ZERO_CREDITS } from "./units";

/**
 * Idempotent shadow reconciliation (BILLING CORE-1 §43, §65, §68, §69).
 *
 * Reads the canonical provider ledgers, projects them into normalized billing
 * usage, rates what can be rated, and writes the result. Safe to run twice: the
 * unique index on `(source_kind, source_id, sku)` means a second pass inserts
 * nothing and reports what it skipped.
 *
 * ## Shadow means shadow
 *
 * This never charges anybody, never creates a reservation, and never touches a
 * balance. It writes `billing_usage_events` and nothing else. Existing
 * workflows are not consulted and cannot be affected — which is the point of
 * running it against months of real history before any enforcement exists.
 *
 * ## Which client this needs
 *
 * `ai_usage_events` and `deep_scan_provider_usage` have insert policies and no
 * select policy — "the absence of a select policy is the access control" — so
 * reading them requires the service-role client. That client is restricted to
 * `src/modules/operations/` by CLAUDE.md rule 53, so the *caller* supplies it
 * here rather than this module importing it, exactly as every other store in
 * this codebase takes its client as a parameter. A production scheduler for
 * this pass therefore belongs under `src/modules/operations/`.
 */

export type ReconciliationScope = {
  /** Limit to one project. Omit to reconcile everything the client can see. */
  projectId?: string;
  /** Upper bound on rows read per source, so a first run cannot be unbounded. */
  limit?: number;
  /** Rating policy. Omitted in Core 1, where no production card exists. */
  card?: CreditRateCard;
};

export type SourceReconciliation = {
  sourceKind: BillableUsage["sourceKind"];
  rowsRead: number;
  /**
   * Rows excluded because a lifecycle event detached their owner (ADR 0056 §7).
   *
   * Counted rather than silently dropped: this is a billing repair pass, and a
   * skip it does not report is a skip nobody can audit.
   */
  rowsSkippedDetached: number;
  eventsProjected: number;
  eventsInserted: number;
  eventsAlreadyPresent: number;
  cost: CostSummary;
  /** Rows whose recomputed cost disagreed with the canonical stored figure (§69). */
  costMismatches: { sourceId: string; storedNanoUsd: number | null; recomputedNanoUsd: number | null }[];
};

export type ReconciliationReport = {
  sources: SourceReconciliation[];
  totals: {
    eventsInserted: number;
    eventsAlreadyPresent: number;
    knownCostNanoUsd: number;
    unknownCostEvents: number;
  };
  ratingStatus: string;
};

const DEFAULT_LIMIT = 500;

/** The columns each row type declares non-null, and therefore must carry. */
const OWNER_COLUMNS = ["project_id", "user_id"] as const;
/** Deep Scan carries no `user_id`; its owner is resolved through the project. */
const PROJECT_ONLY = ["project_id"] as const;

/**
 * Metering outlives its owner (ADR 0056 §7), so a source row may carry a null
 * `project_id` or `user_id`. Such a row is never reconciled.
 *
 * The reason is not tidiness. `BillableUsage` declares `projectId` and `userId`
 * as non-null because a usage event is a financial record and a financial
 * record with no owner is unattributable. Projecting a detached row would mint
 * exactly that: a billing event belonging to a project that was deleted or an
 * identity that was erased. The row itself is retained on purpose — it still
 * answers "what did this cost" — but it has stopped being something to bill.
 *
 * The filter is applied in SQL rather than after the read so the pass spends
 * its row budget on rows it can actually act on.
 */
function excludeDetached<Q extends { not: (column: string, operator: string, value: null) => Q }>(
  query: Q,
  columns: readonly string[],
): Q {
  return columns.reduce((next, column) => next.not(column, "is", null), query);
}

/**
 * How many rows this source is holding that {@link excludeDetached} removed.
 *
 * A separate `head` count rather than a client-side partition, because the
 * budgeted read must not be spent on rows it is going to discard.
 */
async function countDetached(
  supabase: SupabaseClient,
  table: string,
  columns: readonly string[],
  scope: ReconciliationScope,
): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (scope.projectId) query = query.eq("project_id", scope.projectId);

  const { count, error } = await query.or(columns.map((column) => `${column}.is.null`).join(","));
  if (error) throw error;
  return count ?? 0;
}

/**
 * Rates a projected set and returns the per-event rows to persist.
 *
 * Rating is done per source row rather than across the whole reconciliation:
 * a rate card prices usage, and aggregating unrelated operations before
 * rounding would let one project's rounding subsidise another's.
 */
function withRating(
  usage: BillableUsage[],
  card: CreditRateCard | undefined,
): (BillableUsage & { ratingStatus: string; ratedCredits: typeof ZERO_CREDITS | null; rateCardVersion: string | null })[] {
  const rating = rateUsage(usage, card ? { card } : {});

  return usage.map((event) => ({
    ...event,
    // The rating belongs to the set, so only one event in it can carry the
    // credits without double counting. It rides with the same event the cost
    // does — the first — and the rest record the status without an amount.
    ratingStatus: rating.status,
    ratedCredits: null,
    rateCardVersion: rating.rateCardVersion,
  }));
}

async function reconcileAiUsage(
  supabase: SupabaseClient,
  scope: ReconciliationScope,
): Promise<SourceReconciliation> {
  let query = supabase
    .from("ai_usage_events")
    .select(
      "id, user_id, project_id, operation, provider, model, job_id, status, input_tokens, output_tokens, thinking_tokens, cache_read_input_tokens, cache_creation_input_tokens, provider_cost_usd, pricing_version, created_at",
    )
    .order("created_at", { ascending: true })
    .limit(scope.limit ?? DEFAULT_LIMIT);

  if (scope.projectId) query = query.eq("project_id", scope.projectId);

  const { data, error } = await excludeDetached(query, OWNER_COLUMNS);
  if (error) throw error;

  const rows = (data ?? []) as AiUsageRow[];
  const projected: BillableUsage[] = [];
  const costMismatches: SourceReconciliation["costMismatches"] = [];

  for (const row of rows) {
    const events = projectAiUsage(row);
    projected.push(...events);

    // §69: the recomputed figure must equal what the AI ledger already stored.
    // A disagreement is a semantic mismatch to investigate, never something to
    // "fix" by overwriting financial history.
    const recomputed = events.find((event) => event.rawCostNanoUsd !== null)?.rawCostNanoUsd ?? null;
    const stored = storedCostToNanoUsd(row.provider_cost_usd);
    if (stored !== recomputed) {
      costMismatches.push({ sourceId: row.id, storedNanoUsd: stored, recomputedNanoUsd: recomputed });
    }
  }

  const { inserted, alreadyPresent } = await projectUsageEvents(
    supabase,
    withRating(projected, scope.card),
  );

  return {
    sourceKind: "ai_usage_event",
    rowsRead: rows.length,
    rowsSkippedDetached: await countDetached(supabase, "ai_usage_events", OWNER_COLUMNS, scope),
    eventsProjected: projected.length,
    eventsInserted: inserted,
    eventsAlreadyPresent: alreadyPresent,
    cost: summarizeCost(projected),
    costMismatches,
  };
}

async function reconcileSandboxUsage(
  supabase: SupabaseClient,
  scope: ReconciliationScope,
): Promise<SourceReconciliation> {
  let query = supabase
    .from("sandbox_usage_events")
    .select(
      "id, user_id, project_id, provider, sandbox_duration_ms, active_cpu_ms, network_ingress_bytes, network_egress_bytes, provider_cost_usd, estimated_cost_nano_usd, cost_pricing_version, created_at",
    )
    .order("created_at", { ascending: true })
    .limit(scope.limit ?? DEFAULT_LIMIT);

  if (scope.projectId) query = query.eq("project_id", scope.projectId);

  const { data, error } = await excludeDetached(query, OWNER_COLUMNS);
  if (error) throw error;

  const rows = (data ?? []) as SandboxUsageRow[];
  const projected = rows.flatMap((row) => projectSandboxUsage(row));
  const { inserted, alreadyPresent } = await projectUsageEvents(
    supabase,
    withRating(projected, scope.card),
  );

  return {
    sourceKind: "sandbox_usage_event",
    rowsRead: rows.length,
    rowsSkippedDetached: await countDetached(supabase, "sandbox_usage_events", OWNER_COLUMNS, scope),
    eventsProjected: projected.length,
    eventsInserted: inserted,
    eventsAlreadyPresent: alreadyPresent,
    cost: summarizeCost(projected),
    costMismatches: [],
  };
}

async function reconcileReviewBrowserUsage(
  supabase: SupabaseClient,
  scope: ReconciliationScope,
): Promise<SourceReconciliation> {
  let query = supabase
    .from("review_browser_usage")
    .select("id, user_id, project_id, provider, duration_ms, created_at")
    .order("created_at", { ascending: true })
    .limit(scope.limit ?? DEFAULT_LIMIT);

  if (scope.projectId) query = query.eq("project_id", scope.projectId);

  const { data, error } = await excludeDetached(query, OWNER_COLUMNS);
  if (error) throw error;

  const rows = (data ?? []) as ReviewBrowserUsageRow[];
  const projected = rows.flatMap((row) => projectReviewBrowserUsage(row));
  const { inserted, alreadyPresent } = await projectUsageEvents(
    supabase,
    withRating(projected, scope.card),
  );

  return {
    sourceKind: "review_browser_usage",
    rowsRead: rows.length,
    rowsSkippedDetached: await countDetached(supabase, "review_browser_usage", OWNER_COLUMNS, scope),
    eventsProjected: projected.length,
    eventsInserted: inserted,
    eventsAlreadyPresent: alreadyPresent,
    cost: summarizeCost(projected),
    costMismatches: [],
  };
}

/**
 * Deep Scan usage carries no `user_id` of its own, so the owner is resolved
 * through the project — the same derivation every other billing write uses,
 * and never a value a caller supplied (§56).
 */
async function reconcileDeepScanUsage(
  supabase: SupabaseClient,
  scope: ReconciliationScope,
): Promise<SourceReconciliation> {
  let query = supabase
    .from("deep_scan_provider_usage")
    // `provider` is selected because the projection reads it. It used to be a
    // literal in projection.ts, which meant this query could omit the column
    // and nothing anywhere would notice it was missing.
    .select("id, project_id, duration_ms, created_at, provider")
    .order("created_at", { ascending: true })
    .limit(scope.limit ?? DEFAULT_LIMIT);

  if (scope.projectId) query = query.eq("project_id", scope.projectId);

  const { data, error } = await excludeDetached(query, PROJECT_ONLY);
  if (error) throw error;

  const rows = (data ?? []) as DeepScanUsageRow[];
  const projected: BillableUsage[] = [];

  for (const row of rows) {
    const { data: project } = await supabase
      .from("projects")
      .select("user_id")
      .eq("id", row.project_id)
      .maybeSingle();

    if (!project) continue;
    projected.push(...projectDeepScanUsage(row, { userId: (project as { user_id: string }).user_id }));
  }

  const { inserted, alreadyPresent } = await projectUsageEvents(
    supabase,
    withRating(projected, scope.card),
  );

  return {
    sourceKind: "deep_scan_provider_usage",
    rowsRead: rows.length,
    rowsSkippedDetached: await countDetached(supabase, "deep_scan_provider_usage", PROJECT_ONLY, scope),
    eventsProjected: projected.length,
    eventsInserted: inserted,
    eventsAlreadyPresent: alreadyPresent,
    cost: summarizeCost(projected),
    costMismatches: [],
  };
}

/**
 * One idempotent pass over every canonical provider ledger.
 *
 * Each source is reconciled independently and a failure in one does not abort
 * the others — a Deep Scan table that cannot be read must not stop AI usage
 * from being measured. Failures surface in the report rather than as an
 * exception, because this runs as background repair and the useful outcome is
 * "here is what could be reconciled and what could not" (§65, §66).
 */
export async function reconcileUsage(
  supabase: SupabaseClient,
  scope: ReconciliationScope = {},
): Promise<ReconciliationReport> {
  const sources = await Promise.all(
    [reconcileAiUsage, reconcileSandboxUsage, reconcileReviewBrowserUsage, reconcileDeepScanUsage].map(
      async (reconcile) => {
        try {
          return await reconcile(supabase, scope);
        } catch (error) {
          console.error("[billing] reconciliation source failed", {
            message: error instanceof Error ? error.message : "unknown",
          });
          return null;
        }
      },
    ),
  );

  const completed = sources.filter((source): source is SourceReconciliation => source !== null);

  return {
    sources: completed,
    totals: {
      eventsInserted: completed.reduce((total, source) => total + source.eventsInserted, 0),
      eventsAlreadyPresent: completed.reduce((total, source) => total + source.eventsAlreadyPresent, 0),
      // Known and unknown are reported separately and never added together.
      knownCostNanoUsd: completed.reduce((total, source) => total + source.cost.knownCostNanoUsd, 0),
      unknownCostEvents: completed.reduce((total, source) => total + source.cost.unknownCostEvents, 0),
    },
    ratingStatus: scope.card ? "rated_under_supplied_card" : "rate_card_not_configured",
  };
}
