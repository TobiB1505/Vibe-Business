import type { OperationRunRow } from "../shape";
import {
  isAcknowledged,
  QUEUED_TOO_LONG_MS,
  type ConsistencyFinding,
  type ConsistencyReport,
} from "./schema";

/**
 * Rows into contradictions. Pure, clock-injected, predicate-injected.
 *
 * ## Why the staleness predicate arrives as an argument
 *
 * Because the product already owns the answer to "is this run stuck?".
 * `operations/staleness.ts` declares a deadline per operation type, derived
 * from that type's own timeout, and `expireStaleOperation` acts on it. A check
 * that re-derived "stuck" here would be a **second definition of the same
 * word**, and two definitions of one word disagreeing quietly is the exact
 * failure this whole panel exists to find. So the real predicate is passed in
 * by `service.ts`, and a test passes a fake.
 *
 * It also keeps this module pure. `staleness.ts` is `server-only` and opens a
 * service-role client; importing it here would drag both into a file whose
 * value is that it needs neither.
 */

/** Just enough of a ledger row to see the stamp. */
export type LedgerStampRow = {
  rate_card_version: string | null;
  created_at: string;
};

/** How a null stamp is named, so it can be counted and acknowledged like any other. */
export const NO_RATE_CARD = "(none)";

function finding(
  check: ConsistencyFinding["check"],
  subject: string,
  count: number,
  detail: string | null,
): ConsistencyFinding {
  return { check, subject, count, detail, acknowledged: isAcknowledged(check, subject) };
}

/**
 * Charges whose rate card no policy registry defines.
 *
 * The known versions come from the registry rather than a list here, so a
 * `launch-v2` is covered the day it exists — the same reason
 * `policy-version-literals.test.ts` imports rather than enumerates.
 *
 * Grouped in memory rather than in SQL because PostgREST does not group, and a
 * database function for it would be a migration and a grant for a panel that
 * reads 46 rows. When that stops being true the bound reports itself and the
 * count becomes a floor, which is the honest failure.
 */
export function buildUnknownRateCards(
  rows: readonly LedgerStampRow[],
  knownVersions: readonly string[],
): readonly ConsistencyFinding[] {
  const known = new Set(knownVersions);
  const counts = new Map<string, number>();

  for (const row of rows) {
    const stamp = row.rate_card_version ?? NO_RATE_CARD;
    if (row.rate_card_version !== null && known.has(row.rate_card_version)) continue;
    counts.set(stamp, (counts.get(stamp) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stamp, count]) =>
      finding(
        "unknown_rate_card",
        stamp,
        count,
        stamp === NO_RATE_CARD ? "no version recorded" : "not in any price policy",
      ),
    );
}

/**
 * Operations nothing is carrying any more, in the two ways that happens.
 *
 * **Stalled** is the product's own predicate: a `running` operation past the
 * deadline its type declares. The sweep should have failed it, and a finding
 * here means the sweep did not run or could not.
 *
 * **Queued too long** is the failure the sweep deliberately does not touch,
 * because failing a `queued` row would race a run about to start. Nothing else
 * watches it either — which is where a second account erasure sat for eight
 * days, holding the account-level active index, so its owner could never ask to
 * delete their account again.
 *
 * `needs_user` is excluded from both. Waiting on a person is not being stuck,
 * and a founder's lunch break must never render as an incident.
 */
export function buildStalledOperations(
  rows: readonly OperationRunRow[],
  now: number,
  isPastDeadline: (row: {
    status: string;
    startedAt: string | null;
    operationType: string;
  }) => boolean,
): readonly ConsistencyFinding[] {
  const stalled = new Map<string, number>();
  const queued = new Map<string, number>();

  for (const row of rows) {
    if (row.status === "needs_user") continue;

    if (
      row.status === "running" &&
      isPastDeadline({
        status: row.status,
        startedAt: row.started_at,
        operationType: row.operation_type,
      })
    ) {
      stalled.set(row.operation_type, (stalled.get(row.operation_type) ?? 0) + 1);
      continue;
    }

    if (row.status !== "queued") continue;
    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt) || now - createdAt < QUEUED_TOO_LONG_MS) continue;
    queued.set(row.operation_type, (queued.get(row.operation_type) ?? 0) + 1);
  }

  return [
    ...[...stalled.entries()].map(([type, count]) =>
      finding("stalled_operation", type, count, "running past its own deadline"),
    ),
    ...[...queued.entries()].map(([type, count]) =>
      finding("queued_too_long", type, count, "queued and never started"),
    ),
  ].sort((a, b) => a.subject.localeCompare(b.subject));
}

/**
 * One report from a set of findings, with the explained ones set apart.
 *
 * The split is the whole design. A panel that showed sixteen historical rows
 * beside one new contradiction would be red every day, and a panel that is red
 * every day is a panel nobody reads.
 */
export function buildConsistencyReport(
  findings: readonly ConsistencyFinding[],
  truncated: boolean,
): ConsistencyReport {
  return {
    findings: findings.filter((entry) => !entry.acknowledged),
    acknowledged: findings.filter((entry) => entry.acknowledged),
    truncated,
  };
}
