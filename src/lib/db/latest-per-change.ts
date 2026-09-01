import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency, PER_CHANGE_CONCURRENCY } from "@/lib/async/concurrency";

/**
 * The newest row per prepared change, for a whole list, in one query (VB-023).
 *
 * ## The shape this replaces
 *
 * Six tables in this product answer the same question — validation, preview,
 * review, approval, merge, outcome — and all six answered it the same way:
 *
 * ```
 * .eq("project_id", …).eq("prepared_change_id", …)
 * .order("created_at", { ascending: false }).limit(1).maybeSingle()
 * ```
 *
 * Correct for one change, and a round trip per change per table for a list.
 * The Agent screen assembles up to twenty cards, and the measured cost was
 * thirteen reads per change — 261 round trips for one render, most of them
 * asking again for a row the render already held.
 *
 * ## Why not `distinct on`
 *
 * PostgREST has no `distinct on`, so "latest per group" has to be assembled
 * client-side from an ordered read. That is fine, and it is what this does —
 * but the read has to stay bounded, because a table with no ceiling on rows
 * per change would otherwise turn one query into an unbounded transfer
 * (CLAUDE.md rule 27).
 *
 * ## Why the result is exact rather than "exact if history is short"
 *
 * The budget could truncate. What makes truncation safe is the ordering: rows
 * come back newest-first *globally*, so for any change that appears at all,
 * the first row of that change is its latest. Truncation therefore cannot
 * produce a **wrong** answer — only a **missing** one, and only for changes
 * whose every row fell past the budget.
 *
 * So: any id not seen while the budget was exhausted is re-read individually,
 * which is the query this replaced. The batch is a fast path, the fallback is
 * the old path, and the contract is the same either way — no caller has to
 * know which one ran, and no assumption about how often a change is validated
 * is load-bearing.
 *
 * ## What it does not decide
 *
 * Ownership. `project_id` is part of the query, exactly as it was in the six
 * per-change reads, so a row for another tenant cannot enter the result and
 * then be filtered out later. That ordering — the scope in the query, never in
 * a check afterwards — is the whole reason RLS has something to agree with.
 */

/**
 * Rows one batched read may transfer.
 *
 * Twenty prepared changes is the list cap (`listPreparedChangesForProject`),
 * so this is ten rows of history per change before the fallback engages —
 * comfortably above what any of these tables accumulates, and small enough
 * that the worst case is still one small response.
 */
export const LATEST_PER_CHANGE_ROW_BUDGET = 200;

type Row = Record<string, unknown>;

export type LatestPerGroupQuery = {
  table: string;
  columns: string;
  /** The column the rows are grouped by — `prepared_change_id`, `project_id`. */
  groupColumn: string;
  groupIds: readonly string[];
  /** Equality filters every row must satisfy, e.g. `{ status: "completed" }`. */
  filters?: Readonly<Record<string, string>>;
  /** Overridable so the truncation path is reachable in a test. */
  rowBudget?: number;
};

/**
 * `Map` from group id to that group's newest row. Ids with no row are absent
 * rather than present-and-null, so `.get(id) ?? null` reads the same as the
 * `maybeSingle()` it replaces.
 *
 * Ties on `created_at` resolve arbitrarily — as they always did, because the
 * per-group query this replaces had exactly the same ambiguity.
 */
export async function readLatestPerGroup(
  supabase: SupabaseClient,
  query: LatestPerGroupQuery,
): Promise<Map<string, Row>> {
  const ids = [...new Set(query.groupIds)];
  const latest = new Map<string, Row>();

  // No ids is not an empty query — it is no query. PostgREST would happily run
  // `in.()` and return nothing, at the cost of a round trip for an answer we
  // already have.
  if (ids.length === 0) return latest;

  const budget = query.rowBudget ?? LATEST_PER_CHANGE_ROW_BUDGET;
  const filters = Object.entries(query.filters ?? {});

  const scoped = () => {
    let builder = supabase.from(query.table).select(query.columns);
    for (const [column, value] of filters) builder = builder.eq(column, value);
    return builder;
  };

  const { data, error } = await scoped()
    .in(query.groupColumn, ids)
    .order("created_at", { ascending: false })
    .limit(budget);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  for (const row of rows) {
    const groupId = String(row[query.groupColumn] ?? "");
    // Newest-first, so the first row seen for a group is that group's latest.
    if (groupId && !latest.has(groupId)) latest.set(groupId, row);
  }

  // Short of the budget means every matching row was seen, so an id with no
  // row genuinely has none. Only a full response leaves that open.
  if (rows.length < budget) return latest;

  const unresolved = ids.filter((id) => !latest.has(id));

  const recovered = await mapWithConcurrency(unresolved, PER_CHANGE_CONCURRENCY, async (id) => {
    const single = await scoped()
      .eq(query.groupColumn, id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (single.error) throw single.error;
    return [id, (single.data ?? null) as unknown as Row | null] as const;
  });

  for (const [id, row] of recovered) if (row) latest.set(id, row);

  return latest;
}

/**
 * The prepared-change case, which is where this shape started (VB-023).
 *
 * Kept as its own name because six stores read it that way and the extra
 * argument would say nothing at those call sites: a store that only ever asks
 * about one project's prepared changes should not have to name both columns
 * every time.
 */
export async function readLatestPerPreparedChange(
  supabase: SupabaseClient,
  query: {
    table: string;
    columns: string;
    projectId: string;
    preparedChangeIds: readonly string[];
    rowBudget?: number;
  },
): Promise<Map<string, Row>> {
  return readLatestPerGroup(supabase, {
    table: query.table,
    columns: query.columns,
    groupColumn: "prepared_change_id",
    groupIds: query.preparedChangeIds,
    filters: { project_id: query.projectId },
    rowBudget: query.rowBudget,
  });
}

/**
 * A prefetched row belongs to the change it is being used for (VB-023).
 *
 * ## Why this is a check rather than a comment
 *
 * Because passing already-read rows into a card builder moves the ownership
 * scope out of the query and into the caller's bookkeeping, and bookkeeping
 * is what goes wrong silently. The batched read filters on `project_id` and
 * keys on `prepared_change_id`, so a mismatch here means a caller shuffled a
 * map — not that a tenant boundary leaked — but a card that renders another
 * change's approval state is a defect either way, and this is where it stops.
 *
 * Throws rather than falling back to a read: a wrong row is a programming
 * error, and quietly re-reading would hide it behind the cost this exists to
 * remove.
 */
export function assertPrefetchedFor<T extends { projectId: string; preparedChangeId: string }>(
  row: T | null,
  scope: { projectId: string; preparedChangeId: string },
  what: string,
): T | null {
  if (row && (row.projectId !== scope.projectId || row.preparedChangeId !== scope.preparedChangeId)) {
    throw new Error(`prefetched ${what} does not belong to this prepared change`);
  }
  return row;
}

/**
 * The prepared change itself, checked the same way (VB-023).
 *
 * Separate from `assertPrefetchedFor` because a prepared change is identified
 * by `id` rather than by a `preparedChangeId` column — it *is* the change, it
 * does not point at one.
 */
export function assertPreparedChangeIs<T extends { id: string; projectId: string }>(
  row: T | null,
  scope: { projectId: string; preparedChangeId: string },
): T | null {
  if (row && (row.projectId !== scope.projectId || row.id !== scope.preparedChangeId)) {
    throw new Error("prefetched prepared change does not belong to this prepared change");
  }
  return row;
}
