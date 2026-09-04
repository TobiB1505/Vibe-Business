/**
 * Turning rows into what the console shows. Pure, and therefore testable.
 *
 * Every function here takes plain rows and a clock and returns a view. No
 * database, no environment, no `Date.now()` — the last one because "is this
 * operation stuck?" is a question about elapsed time, and a test that cannot
 * choose the time cannot ask it.
 */

import {
  FEED_LIMIT,
  WINDOW_MS,
  type ConsoleWindow,
  type FailureRow,
  type FeedLevel,
  type FeedLine,
  type FunnelRow,
  type InFlight,
  type MicroUsd,
  type OutcomeRow,
  type SpendRow,
  type SpendSource,
  type ToolRow,
} from "./schema";

/** The subset of `operation_runs` the console reads. */
export type OperationRunRow = {
  id: string;
  project_id: string | null;
  operation_type: string;
  status: string;
  stage: string;
  failure_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

/** A usage row from any of the three provider ledgers. */
export type UsageRow = {
  created_at: string;
  status: string;
  provider_cost_usd: number | null;
  /** Absent on `ai_usage_events`, which has a real provider price. */
  estimated_cost_nano_usd?: number | null;
};

export type OnboardingRow = { state: string; completed_at: string | null };

export type ToolEventRow = {
  tool: string;
  decision: string;
  success: boolean | null;
};

/**
 * Eight characters of a UUID.
 *
 * Enough to tell two projects apart while reading a feed, and not the
 * identifier itself. The console answers what is happening, not to whom.
 */
export function projectRef(projectId: string | null): string | null {
  if (!projectId) return null;
  return projectId.slice(0, 8);
}

/** Derived from the row, never stored. */
export function feedLevel(status: string): FeedLevel {
  if (status === "failed") return "bad";
  if (status === "needs_user") return "waiting";
  if (status === "running" || status === "queued") return "active";
  return "ok";
}

function millisBetween(from: string | null, to: number): number | null {
  if (!from) return null;
  const started = Date.parse(from);
  if (Number.isNaN(started)) return null;
  const elapsed = to - started;
  return elapsed >= 0 ? elapsed : null;
}

/**
 * The most recent thing that happened to an operation.
 *
 * Not `created_at`: an operation that was queued an hour ago and failed a
 * minute ago belongs at the top of the feed, because the failure is the news.
 */
function lastEventAt(row: OperationRunRow): string {
  return row.completed_at ?? row.started_at ?? row.created_at;
}

export function buildFeed(rows: readonly OperationRunRow[], now: number): readonly FeedLine[] {
  return rows
    .map((row) => {
      const at = lastEventAt(row);
      const end = row.completed_at ? Date.parse(row.completed_at) : now;
      return {
        id: row.id,
        at,
        level: feedLevel(row.status),
        operationType: row.operation_type,
        status: row.status,
        stage: row.stage,
        failureCode: row.failure_code,
        projectRef: projectRef(row.project_id),
        durationMs: millisBetween(row.started_at, Number.isNaN(end) ? now : end),
      };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, FEED_LIMIT);
}

export function buildInFlight(rows: readonly OperationRunRow[], now: number): InFlight {
  let queued = 0;
  let running = 0;
  let needsUser = 0;
  let oldest: InFlight["oldest"] = null;

  for (const row of rows) {
    if (row.status === "queued") queued += 1;
    else if (row.status === "running") running += 1;
    else if (row.status === "needs_user") needsUser += 1;
    else continue;

    // `needs_user` is waiting on a person, so it is never "stuck" — counting it
    // as the oldest would report a founder's lunch break as an incident.
    if (row.status === "needs_user") continue;

    const ageMs = millisBetween(row.started_at ?? row.created_at, now);
    if (ageMs === null) continue;
    if (!oldest || ageMs > oldest.ageMs) {
      oldest = { operationType: row.operation_type, stage: row.stage, ageMs };
    }
  }

  return { queued, running, needsUser, oldest };
}

export function buildOutcomes(rows: readonly OperationRunRow[]): readonly OutcomeRow[] {
  const byType = new Map<string, OutcomeRow>();

  for (const row of rows) {
    const entry = byType.get(row.operation_type) ?? {
      operationType: row.operation_type,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    if (row.status === "completed") entry.completed += 1;
    else if (row.status === "failed") entry.failed += 1;
    else if (row.status === "cancelled") entry.cancelled += 1;
    byType.set(row.operation_type, entry);
  }

  return [...byType.values()]
    .filter((row) => row.completed + row.failed + row.cancelled > 0)
    .sort((a, b) => b.failed - a.failed || b.completed - a.completed);
}

export function buildFailures(rows: readonly OperationRunRow[]): readonly FailureRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "failed") continue;
    // A failed operation with no code is itself worth seeing: it means
    // something failed in a way nothing classified.
    const code = row.failure_code ?? "(unclassified)";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([failureCode, count]) => ({ failureCode, count }))
    .sort((a, b) => b.count - a.count || a.failureCode.localeCompare(b.failureCode));
}

/**
 * Decimal USD to integer micro-USD.
 *
 * Rounded once, at the boundary, so a sum of a thousand rows carries no float
 * drift. A negative or non-finite cost is treated as absent rather than
 * subtracted: a provider ledger should not contain one, and a total that
 * silently shrinks is worse than a total that ignores a bad row.
 */
export function toMicroUsd(usd: number | null | undefined): MicroUsd {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return 0;
  return Math.round(usd * 1_000_000);
}

/** Nano-USD to micro-USD. Integers throughout; a bad row contributes nothing. */
export function nanoToMicroUsd(nano: number | null | undefined): MicroUsd {
  if (typeof nano !== "number" || !Number.isFinite(nano) || nano < 0) return 0;
  return Math.round(nano / 1_000);
}

export function buildSpend(
  sources: readonly { source: SpendSource; rows: readonly UsageRow[] }[],
): readonly SpendRow[] {
  return sources.map(({ source, rows }) => ({
    source,
    events: rows.length,
    measuredMicroUsd: rows.reduce((total, row) => total + toMicroUsd(row.provider_cost_usd), 0),
    estimatedMicroUsd: rows.reduce(
      (total, row) => total + nanoToMicroUsd(row.estimated_cost_nano_usd),
      0,
    ),
  }));
}

/** Micro-USD as a fixed-point string. Never a float in, never a float out. */
export function formatMicroUsd(micro: MicroUsd): string {
  const cents = Math.round(micro / 10_000);
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildFunnel(rows: readonly OnboardingRow[]): readonly FunnelRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const state = row.completed_at ? "completed" : row.state;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
}

export function buildTools(rows: readonly ToolEventRow[]): readonly ToolRow[] {
  const byTool = new Map<string, ToolRow>();

  for (const row of rows) {
    const entry = byTool.get(row.tool) ?? { tool: row.tool, allowed: 0, denied: 0, failed: 0 };
    if (row.decision === "denied") entry.denied += 1;
    else {
      entry.allowed += 1;
      // `success: null` means the gateway recorded no outcome — not a failure.
      if (row.success === false) entry.failed += 1;
    }
    byTool.set(row.tool, entry);
  }

  return [...byTool.values()].sort(
    (a, b) => b.denied - a.denied || b.allowed - a.allowed || a.tool.localeCompare(b.tool),
  );
}

/** The ISO instant a window starts at, for the query's `gte`. */
export function windowStart(window: ConsoleWindow, now: number): string {
  return new Date(now - WINDOW_MS[window]).toISOString();
}
