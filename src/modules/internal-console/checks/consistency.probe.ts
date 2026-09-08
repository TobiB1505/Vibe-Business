import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { RETAIL_PRICE_POLICIES } from "@/modules/credits/retail";
import { LEDGER_STAMP_COLUMNS, OPERATION_RUN_COLUMNS, selection } from "../columns";
import { FEED_LIMIT, SAMPLE_LIMIT } from "../schema";
import type { OperationRunRow } from "../shape";
import { ACKNOWLEDGED, type ConsistencyFinding } from "./schema";
import { buildConsistencyReport, buildStalledOperations, buildUnknownRateCards } from "./shape";
import type { LedgerStampRow } from "./shape";

/**
 * The consistency checks, as a command (`pnpm consistency:check`).
 *
 * ```
 * NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm consistency:check
 * ```
 *
 * **Dev/operator only. Not part of the test suite.** The file is `*.probe.ts`
 * and `vitest.config.mts` includes only `*.test.ts`, so CI cannot reach a
 * database through it.
 *
 * ## Why this exists when the console shows the same findings
 *
 * Because it exits non-zero. The panel at `/app/internal` is for a person
 * looking; this is for a person who wants an answer without looking, before a
 * deploy or after a migration, and an exit code is the one thing a screen
 * cannot give. The checks themselves are not duplicated — both callers run
 * `checks/shape.ts`, so the command and the panel can never disagree about what
 * a contradiction is.
 *
 * ## It writes nothing and cannot spend anything
 *
 * Two reads, both bounded, both column-named. It imports no provider client and
 * no operation starter, so there is no path from this file to a paid call.
 *
 * ## Why the staleness predicate is inlined rather than imported
 *
 * `operations/staleness.ts` is `server-only` and opens a service-role client at
 * module load. A command-line probe is not a server, so the deadline question
 * is asked the only way it can be here: `startedAt` against the same generous
 * ceiling the queued check uses. That makes this half of the command **weaker
 * than the panel**, which asks the product's real predicate — and it is said
 * out loud rather than left for somebody to discover, because a check that
 * quietly means less than it looks like is the thing this whole module is for.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && serviceKey);

/** The coarse deadline this command can apply without a server. See the header. */
const COARSE_RUNNING_CEILING_MS = 60 * 60 * 1000;

function report(title: string, rows: readonly ConsistencyFinding[]): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
  if (rows.length === 0) {
    console.log("  nothing");
    return;
  }
  for (const row of rows) {
    console.log(
      `  ${row.check.padEnd(20)} ${row.subject.padEnd(32)} ${String(row.count).padStart(5)}` +
        (row.detail ? `  · ${row.detail}` : ""),
    );
  }
}

describe.skipIf(!configured)("consistency against the live database", () => {
  it("finds no contradiction nobody has explained", async () => {
    const supabase = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [stamps, unfinished] = await Promise.all([
      supabase
        .from("billing_credit_ledger")
        .select(selection(LEDGER_STAMP_COLUMNS))
        .eq("kind", "charge")
        .order("created_at", { ascending: false })
        .limit(SAMPLE_LIMIT),
      supabase
        .from("operation_runs")
        .select(selection(OPERATION_RUN_COLUMNS))
        .in("status", ["queued", "running", "needs_user"])
        .order("created_at", { ascending: true })
        .limit(FEED_LIMIT),
    ]);

    expect(stamps.error, `ledger read failed: ${stamps.error?.message}`).toBeNull();
    expect(unfinished.error, `operation read failed: ${unfinished.error?.message}`).toBeNull();

    const stampRows = (stamps.data ?? []) as unknown as LedgerStampRow[];
    const runRows = (unfinished.data ?? []) as unknown as OperationRunRow[];
    const now = Date.now();

    const result = buildConsistencyReport(
      [
        ...buildUnknownRateCards(
          stampRows,
          RETAIL_PRICE_POLICIES.map((policy) => policy.version),
        ),
        ...buildStalledOperations(runRows, now, (row) => {
          if (row.status !== "running" || !row.startedAt) return false;
          const startedAt = Date.parse(row.startedAt);
          return Number.isFinite(startedAt) && now - startedAt >= COARSE_RUNNING_CEILING_MS;
        }),
      ],
      stampRows.length >= SAMPLE_LIMIT,
    );

    console.log("");
    console.log(`Charges read: ${stampRows.length}   Unfinished operations: ${runRows.length}`);
    if (result.truncated) {
      console.log("A read reached its bound — every count below is a floor, not a total.");
    }
    report("Contradictions nobody has explained", result.findings);
    report("Known and explained", result.acknowledged);
    console.log("");
    for (const entry of ACKNOWLEDGED) {
      console.log(`  ${entry.check} · ${entry.subject}`);
      console.log(`    ${entry.why}`);
    }
    console.log("");

    expect(
      result.findings.map((row) => `${row.check}:${row.subject} (${row.count})`),
      "Each of these is a place two parts of the system disagree. Fix it, or add it " +
        "to ACKNOWLEDGED in checks/schema.ts with the reason it is correct.",
    ).toEqual([]);
  }, 60_000);
});

describe("the command refuses to pass by doing nothing", () => {
  it("says so when it has no database to check", () => {
    // A probe that silently skips is a probe that reports success for an
    // environment it never reached — the failure `read-bounds.test.ts` guards
    // against in its own walk, and the reason this assertion is not skipped.
    expect(
      configured,
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — this " +
        "command checks the live database and cannot answer without one.",
    ).toBe(true);
  });
});
