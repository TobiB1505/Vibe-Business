import { describe, expect, it } from "vitest";
import { FEED_LIMIT } from "./schema";
import {
  buildFailures,
  buildFeed,
  buildFunnel,
  buildInFlight,
  buildOutcomes,
  buildSpend,
  buildTools,
  formatMicroUsd,
  nanoToMicroUsd,
  projectRef,
  toMicroUsd,
  windowStart,
  type OperationRunRow,
} from "./shape";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function run(overrides: Partial<OperationRunRow> = {}): OperationRunRow {
  return {
    id: "run-1",
    project_id: "11112222-3333-4444-5555-666677778888",
    operation_type: "business_audit",
    status: "completed",
    stage: "completed",
    failure_code: null,
    created_at: ago(60_000),
    started_at: ago(50_000),
    completed_at: ago(10_000),
    ...overrides,
  };
}

describe("identifiers are truncated", () => {
  it("shows eight characters, never the id", () => {
    expect(projectRef("11112222-3333-4444-5555-666677778888")).toBe("11112222");
    expect(projectRef(null)).toBeNull();
  });
});

describe("the feed", () => {
  it("orders by the most recent thing that happened, not by creation", () => {
    const old = run({ id: "old", created_at: ago(10_000), started_at: null, completed_at: null });
    const failedLater = run({
      id: "failed-later",
      status: "failed",
      created_at: ago(3_600_000),
      started_at: ago(3_500_000),
      completed_at: ago(1_000),
    });

    // Created an hour earlier, but the failure is the news.
    expect(buildFeed([old, failedLater], NOW).map((line) => line.id)).toEqual([
      "failed-later",
      "old",
    ]);
  });

  it("measures a running operation against now, and a finished one against its end", () => {
    const [running] = buildFeed(
      [run({ status: "running", started_at: ago(5_000), completed_at: null })],
      NOW,
    );
    const [done] = buildFeed([run({ started_at: ago(50_000), completed_at: ago(10_000) })], NOW);

    expect(running.durationMs).toBe(5_000);
    expect(done.durationMs).toBe(40_000);
  });

  it("reports no duration for an operation that never started", () => {
    const [line] = buildFeed([run({ started_at: null, completed_at: null })], NOW);
    expect(line.durationMs).toBeNull();
  });

  it("derives severity from status", () => {
    const levels = buildFeed(
      [
        run({ id: "a", status: "failed" }),
        run({ id: "b", status: "needs_user" }),
        run({ id: "c", status: "running" }),
        run({ id: "d", status: "completed" }),
      ],
      NOW,
    ).map((line) => `${line.status}:${line.level}`);

    expect(levels.sort()).toEqual([
      "completed:ok",
      "failed:bad",
      "needs_user:waiting",
      "running:active",
    ]);
  });

  it("is bounded", () => {
    const rows = Array.from({ length: FEED_LIMIT + 25 }, (_, i) =>
      run({ id: `run-${i}`, completed_at: ago(i * 1_000) }),
    );
    expect(buildFeed(rows, NOW)).toHaveLength(FEED_LIMIT);
  });
});

describe("what is in flight", () => {
  it("counts the three unfinished statuses", () => {
    const flight = buildInFlight(
      [
        run({ status: "queued", started_at: null, completed_at: null }),
        run({ status: "running", completed_at: null }),
        run({ status: "running", completed_at: null }),
        run({ status: "needs_user", completed_at: null }),
        run({ status: "completed" }),
      ],
      NOW,
    );

    expect(flight).toMatchObject({ queued: 1, running: 2, needsUser: 1 });
  });

  it("never reports a needs_user operation as the oldest", () => {
    // Waiting on a person is not being stuck. A founder's lunch break must not
    // render as an incident.
    const flight = buildInFlight(
      [
        run({ status: "needs_user", started_at: ago(86_400_000), completed_at: null }),
        run({ status: "running", started_at: ago(5_000), completed_at: null }),
      ],
      NOW,
    );

    expect(flight.oldest).toEqual({
      operationType: "business_audit",
      stage: "completed",
      ageMs: 5_000,
    });
  });

  it("falls back to creation time for something that never started", () => {
    const flight = buildInFlight(
      [run({ status: "queued", created_at: ago(9_000), started_at: null, completed_at: null })],
      NOW,
    );
    expect(flight.oldest?.ageMs).toBe(9_000);
  });

  it("reports nothing as oldest when nothing is unfinished", () => {
    expect(buildInFlight([run()], NOW).oldest).toBeNull();
  });
});

describe("outcomes and failures", () => {
  it("groups by operation type and puts failures first", () => {
    const outcomes = buildOutcomes([
      run({ operation_type: "business_audit", status: "completed" }),
      run({ operation_type: "business_audit", status: "completed" }),
      run({ operation_type: "agent_execution", status: "failed" }),
      run({ operation_type: "agent_execution", status: "cancelled" }),
    ]);

    expect(outcomes).toEqual([
      { operationType: "agent_execution", completed: 0, failed: 1, cancelled: 1 },
      { operationType: "business_audit", completed: 2, failed: 0, cancelled: 0 },
    ]);
  });

  it("omits a type whose rows are all still running", () => {
    expect(buildOutcomes([run({ status: "running", completed_at: null })])).toEqual([]);
  });

  it("counts an unclassified failure rather than dropping it", () => {
    // A failure nothing classified is the one most worth seeing.
    expect(buildFailures([run({ status: "failed", failure_code: null })])).toEqual([
      { failureCode: "(unclassified)", count: 1 },
    ]);
  });

  it("ranks failure codes by frequency", () => {
    const failures = buildFailures([
      run({ status: "failed", failure_code: "provider_unavailable" }),
      run({ status: "failed", failure_code: "provider_unavailable" }),
      run({ status: "failed", failure_code: "sandbox_start_failed" }),
      run({ status: "completed", failure_code: null }),
    ]);

    expect(failures).toEqual([
      { failureCode: "provider_unavailable", count: 2 },
      { failureCode: "sandbox_start_failed", count: 1 },
    ]);
  });
});

describe("money is integer micro-USD", () => {
  it("rounds once, at the boundary", () => {
    expect(toMicroUsd(0.1234565)).toBe(123_457);
    expect(toMicroUsd(null)).toBe(0);
    expect(toMicroUsd(undefined)).toBe(0);
  });

  it("ignores a negative or non-finite cost rather than subtracting it", () => {
    expect(toMicroUsd(-1)).toBe(0);
    expect(toMicroUsd(Number.NaN)).toBe(0);
    expect(toMicroUsd(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("sums without float drift", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; three hundred of them is worse.
    const rows = Array.from({ length: 300 }, () => ({
      created_at: ago(1_000),
      status: "succeeded",
      provider_cost_usd: 0.1,
    }));

    const [spend] = buildSpend([{ source: "inference", rows }]);
    expect(spend.measuredMicroUsd).toBe(30_000_000);
    expect(formatMicroUsd(spend.measuredMicroUsd)).toBe("$30.00");
  });

  it("reports each source separately, including an empty one", () => {
    expect(
      buildSpend([
        {
          source: "inference",
          rows: [{ created_at: ago(1), status: "succeeded", provider_cost_usd: 1.5 }],
        },
        { source: "sandbox", rows: [] },
      ]),
    ).toEqual([
      { source: "inference", events: 1, measuredMicroUsd: 1_500_000, estimatedMicroUsd: 0 },
      { source: "sandbox", events: 0, measuredMicroUsd: 0, estimatedMicroUsd: 0 },
    ]);
  });

  /*
   * The defect this pins, found on the console's first look at production.
   *
   * `sandbox_usage_events.provider_cost_usd` is null in every row ever written
   * — Vercel reports no per-sandbox figure — so a panel summing only that
   * column showed "sandbox · 4 events · $0.00" and called it what the provider
   * billed. A confident zero is worse than no number.
   */
  it("keeps a provider's estimate apart from a provider's measurement", () => {
    const [sandbox] = buildSpend([
      {
        source: "sandbox",
        rows: [
          {
            created_at: ago(1),
            status: "succeeded",
            provider_cost_usd: null,
            estimated_cost_nano_usd: 1_400_000_000,
          },
          {
            created_at: ago(2),
            status: "succeeded",
            provider_cost_usd: null,
            estimated_cost_nano_usd: 600_000_000,
          },
        ],
      },
    ]);

    // Two rows the provider priced at nothing, and Vibe derived $2.00 for.
    expect(sandbox.measuredMicroUsd).toBe(0);
    expect(sandbox.estimatedMicroUsd).toBe(2_000_000);
    expect(formatMicroUsd(sandbox.estimatedMicroUsd)).toBe("$2.00");
    expect(sandbox).not.toHaveProperty("microUsd");
  });

  it("ignores a negative or non-finite estimate", () => {
    expect(nanoToMicroUsd(-1)).toBe(0);
    expect(nanoToMicroUsd(Number.NaN)).toBe(0);
    expect(nanoToMicroUsd(null)).toBe(0);
    expect(nanoToMicroUsd(undefined)).toBe(0);
    expect(nanoToMicroUsd(1_500)).toBe(2);
  });
});

describe("the funnel", () => {
  it("counts a completed project as completed whatever its state says", () => {
    expect(
      buildFunnel([
        { state: "audit", completed_at: "2026-09-01T00:00:00.000Z" },
        { state: "audit", completed_at: null },
        { state: "product", completed_at: null },
      ]),
    ).toEqual([
      { state: "audit", count: 1 },
      { state: "completed", count: 1 },
      { state: "product", count: 1 },
    ]);
  });
});

describe("agent tool usage", () => {
  it("separates denial from failure, and ranks denials first", () => {
    const tools = buildTools([
      { tool: "Bash", decision: "allowed", success: true },
      { tool: "Bash", decision: "allowed", success: false },
      { tool: "WebFetch", decision: "denied", success: null },
      { tool: "Read", decision: "allowed", success: null },
    ]);

    expect(tools).toEqual([
      { tool: "WebFetch", allowed: 0, denied: 1, failed: 0 },
      { tool: "Bash", allowed: 2, denied: 0, failed: 1 },
      { tool: "Read", allowed: 1, denied: 0, failed: 0 },
    ]);
  });

  it("treats an unrecorded outcome as not a failure", () => {
    expect(buildTools([{ tool: "Read", decision: "allowed", success: null }])[0].failed).toBe(0);
  });
});

describe("window bounds", () => {
  it("computes the start of each window from the given clock", () => {
    expect(windowStart("24h", NOW)).toBe("2026-09-03T12:00:00.000Z");
    expect(windowStart("7d", NOW)).toBe("2026-08-28T12:00:00.000Z");
  });
});
