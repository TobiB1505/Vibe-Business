import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No read of a growing table returns whatever PostgREST feels like returning
 * (PERF-018).
 *
 * ## The failure, and why it has no error attached
 *
 * `max_rows = 1000` is a fixed property of this project's Data API — confirmed
 * 2026-09-02, and **no longer settable in the Supabase dashboard**, so it can
 * never be raised out of the way. Past a thousand rows PostgREST returns the
 * first thousand, `206 Partial Content`, and no error the client surfaces. A
 * read that assumed completeness gets a **well-formed wrong answer**: a sum
 * that is too low, an existence check that says no, a cost roll-up that is
 * confidently short.
 *
 * `agent_execution_events` passed a thousand rows on 2026-08-31, at a single
 * operator's usage. This is not a scaling concern.
 *
 * [ADR 0068](../../../docs/decisions/0068-retention-periods.md) §1 separates
 * this from retention and is worth restating, because the two look alike and
 * only one of them is fixed by deleting rows: **retention moves the date a
 * truncating read starts being wrong. It does not make it right.** Every read
 * that depends on completeness has to aggregate in the database or paginate
 * explicitly, whatever the retention period is.
 *
 * ## Why an allowlist with arguments rather than a rule
 *
 * Because most of these reads are fine, and for reasons a checker cannot see.
 * `.in("id", ids)` is bounded by the caller's own list; a scan event carries a
 * `sequence` a CHECK confines to 1–24; a lot's allocations are bounded by the
 * lots it spans. None of those needs a `limit`, and adding one would suggest a
 * risk that is not there.
 *
 * What the list rules out is the read nobody thought about. Each entry names
 * **why the set is bounded**, and it is bounded by *construction* — never by
 * "it is small today". `operation_runs` was small until it was not.
 *
 * Adding a line here is the review. Removing a read is expected to fail this
 * test, which is the point: a stale entry is a claim nobody is checking.
 */

/**
 * Tables whose row count grows with use rather than with a person's own data.
 *
 * The distinction that matters: `projects` grows when a founder adds a project
 * and stops when they stop, so a thousand of them is a different product. These
 * grow because the system ran — events per operation, usage per inference, a
 * ledger entry per movement — and nobody chooses how many.
 */
const GROWTH_TABLES = [
  "agent_activity_events",
  "agent_execution_events",
  "agent_execution_runs",
  "agent_tool_events",
  "ai_usage_events",
  "assistant_messages",
  "audit_events",
  "billing_credit_allocations",
  "billing_credit_ledger",
  "billing_credit_reservations",
  "billing_usage_events",
  "deep_scan_provider_usage",
  "execution_interrupts",
  "operation_runs",
  "product_scan_events",
  "review_browser_usage",
  "sandbox_usage_events",
] as const;

/** What makes a read bounded without needing an argument below. */
const BOUNDS = [".limit(", ".range(", ".single()", ".maybeSingle()", 'count: "exact"'] as const;

/** A statement that writes is not a read, whatever it selects back. */
const WRITES = [".insert(", ".update(", ".upsert(", ".delete("] as const;

/**
 * Unbounded reads that are bounded by something the checker cannot see.
 *
 * `why` is the review. It must say what confines the set — a caller's id list,
 * a CHECK constraint, a live status that empties — and not how many rows there
 * happen to be today.
 */
const BOUNDED_BY_CONSTRUCTION: readonly { site: string; why: string }[] = [
  {
    site: "modules/action-plans/completion-store.ts",
    why: "Filtered to one plan's execution specs, then to `type = 'change_verified'` — one event per run, and a plan has a handful of steps.",
  },
  {
    site: "modules/credits/lot-store.ts",
    why: "One reservation's allocations (one per lot it spans), and the live-hold set for one account. Measured 2026-09-02: zero held allocations — every one of 43 reached a terminal state, so the set empties rather than accumulating. Truncation would need a thousand simultaneous holds on one account, which is a different incident.",
  },
  {
    site: "modules/credits/store.ts",
    why: "A caller's own reservation ids; the active-reservation set for one account, which empties the same way (measured 2026-09-02: zero active, 262 terminal); and one operation's usage events.",
  },
  {
    site: "modules/credits/service.ts",
    why: "The ledger entries belonging to one refund — a refund posts a bounded, small number of them.",
  },
  {
    site: "modules/operations/store.ts",
    why: "A caller's own operation ids. The two start-window reads are `count: \"exact\", head: true` and transfer no rows; their thresholds are at most 120 per day, so a count capped at a thousand still exceeds every limit and the gate decides identically either way.",
  },
  {
    site: "modules/operations/agent-execution/steps/observe.ts",
    why: "One agent run's usage events. A run is admitted at most 260 provider requests, and the ceiling itself is summed by `sum_agent_run_usage` in the database rather than here.",
  },
  {
    site: "modules/product-scan/store.ts",
    why: "One scan's events, whose `sequence` a CHECK constrains to 1–24.",
  },
];

/**
 * Probes and harnesses, which are operator tools rather than request paths.
 *
 * They are still listed, because a probe that silently reads a truncated
 * history reports a wrong number to a person making a pricing decision — and
 * rule 78 forbids a customer-facing Agent price without a measured cost behind
 * it. Being off the request path lowers the urgency, not the standard.
 */
const OPERATOR_TOOLS: readonly { site: string; why: string }[] = [
  {
    site: "modules/credits/concurrency/",
    why: "Drives a disposable local Supabase stack it starts itself, seeded per test to a known, small size.",
  },
  {
    site: "modules/coding-agent/dogfood/calibration.probe.ts",
    why: "One validation run's sandbox events and one job's usage events. The parent is a single run, so the set is bounded by what one execution can meter rather than by how many have happened.",
  },
  {
    site: "modules/credits/refund.operator.probe.ts",
    why: "The ledger entries belonging to one refund, the same shape `credits/service.ts` reads — a refund posts a bounded, small number of them.",
  },
];

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) return [];
    if (entry.includes(".test.")) return [];
    if (entry.includes("test-support")) return [];
    return [full];
  });
}

/**
 * The statement a `.from(...)` belongs to: forward to the first `;` outside any
 * bracket. A naive search for `;` stops inside an arrow function passed as an
 * argument, which is exactly where a `.limit()` tends to sit.
 */
function statementFrom(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === ";" && depth <= 0) return source.slice(start, i);
  }
  return source.slice(start);
}

type Read = { site: string; table: string; line: number };

function unboundedReads(): Read[] {
  const found: Read[] = [];
  const pattern = new RegExp(`\\.from\\("(${GROWTH_TABLES.join("|")})"\\)`, "g");

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      const statement = statementFrom(source, match.index);
      if (WRITES.some((w) => statement.includes(w))) continue;
      if (BOUNDS.some((b) => statement.includes(b))) continue;
      found.push({
        site: relative(SRC, file).replaceAll("\\", "/"),
        table: match[1],
        line: source.slice(0, match.index).split("\n").length,
      });
    }
  }

  return found;
}

const REVIEWED = [...BOUNDED_BY_CONSTRUCTION, ...OPERATOR_TOOLS];

describe("every unbounded read of a growing table has been argued for", () => {
  it("finds reads at all", () => {
    // An empty result would pass the assertion below while proving nothing —
    // a broken regex, a renamed directory, a changed client API. This
    // repository has been caught by an empty-set pass before (Sprint 0119).
    const anyRead = readFileSync(join(SRC, "modules/credits/store.ts"), "utf8");
    expect(anyRead).toContain('.from("billing_credit_reservations")');
    expect(GROWTH_TABLES.length).toBeGreaterThan(10);
  });

  it("leaves no unbounded read unreviewed", () => {
    const unreviewed = unboundedReads().filter(
      (read) => !REVIEWED.some((entry) => read.site.startsWith(entry.site)),
    );

    // Named with table and line, so the failure is the work item rather than a
    // prompt to re-run the query by hand.
    expect(unreviewed.map((r) => `${r.site}:${r.line} reads ${r.table}`)).toEqual([]);
  });

  it("keeps no entry for a site that no longer has one", () => {
    // A stale entry is a claim nobody is checking, and it silently widens the
    // allowlist for whatever is written at that path next.
    const live = new Set(unboundedReads().map((read) => read.site));
    const stale = REVIEWED.filter(
      (entry) => ![...live].some((site) => site.startsWith(entry.site)),
    );

    expect(stale.map((entry) => entry.site)).toEqual([]);
  });

  it("gives every entry a reason about structure, not about size", () => {
    for (const entry of REVIEWED) {
      expect(entry.why.length, entry.site).toBeGreaterThan(60);
      // "It is small today" is the argument this list exists to refuse.
      expect(entry.why, entry.site).not.toMatch(/\b(only a few rows|small enough|not many)\b/i);
    }
  });
});
