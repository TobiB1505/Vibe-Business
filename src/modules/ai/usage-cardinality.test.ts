import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { recordAIUsage, type RecordUsageParams } from "./usage";

/**
 * How many usage rows one job may have — the defect the first real agent run
 * found, and the guarantee it must not cost.
 *
 * ## What happened
 *
 * The run reached Anthropic 27 times in five minutes. The first call recorded a
 * row; every one after it failed with
 *
 * ```
 * duplicate key value violates unique constraint "ai_usage_events_job_idx"
 * ```
 *
 * That was worse than lost accounting. `readAgentRunGatewayState` reads this
 * ledger back on every gateway request to decide whether a run has spent its
 * authorization, so with one row that could ever exist it saw
 * `forwardedRequests = 1` and `spentOutputTokens = 0` forever. The gateway's
 * containment ceilings could not bind.
 *
 * ## Why the constraint was right, and still is
 *
 * Every other operation makes exactly one structured-generation call per job. A
 * second row for one of those job ids means a durable step was entered twice
 * and a customer was charged twice. Lifting uniqueness globally to make the
 * agent work would have paid for the agent with the audit's protection.
 *
 * So both halves are asserted here, in one file, deliberately: the thing that
 * changed and the thing that must not have.
 */

const AGENT_RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AUDIT_JOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function usage(overrides: Partial<RecordUsageParams> = {}): RecordUsageParams {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    operation: "agentic_execution",
    provider: "anthropic",
    model: "claude-sonnet-5",
    jobId: AGENT_RUN,
    status: "succeeded",
    usage: { inputTokens: 1_200, outputTokens: 340, thinkingTokens: 0 },
    estimatedInputTokens: null,
    latencyMs: 2_884,
    failureCode: null,
    ...overrides,
  };
}

describe("one agent execution, many sampling calls", () => {
  /** The exact shape of the real failure: 27 calls, one run. */
  it("persists a row for every forwarded request", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    for (let call = 0; call < 27; call += 1) {
      await recordAIUsage(supabase, usage());
    }

    const rows = db.rows("ai_usage_events");
    expect(rows).toHaveLength(27);
    expect(rows.every((row) => row.job_id === AGENT_RUN)).toBe(true);
  });

  /**
   * The number the gateway's ceiling is measured against. Before the fix this
   * summed one row; a run could not outspend an authorization it could not see.
   */
  it("accumulates the tokens a ceiling is measured against", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    for (const outputTokens of [340, 512, 890]) {
      await recordAIUsage(
        supabase,
        usage({ usage: { inputTokens: 1_000, outputTokens, thinkingTokens: 0 } }),
      );
    }

    const spent = db
      .rows("ai_usage_events")
      .filter((row) => row.status === "succeeded")
      .reduce((total, row) => total + ((row.output_tokens as number) ?? 0), 0);

    expect(spent).toBe(340 + 512 + 890);
  });

  /** A failed call is still a forwarded request, and still counts toward the request ceiling. */
  it("records failed calls alongside successful ones", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    await recordAIUsage(supabase, usage());
    await recordAIUsage(
      supabase,
      usage({ status: "failed", usage: undefined, failureCode: "upstream_529" }),
    );

    expect(db.rows("ai_usage_events")).toHaveLength(2);
  });
});

describe("single-call jobs keep the protection they always had", () => {
  /**
   * The regression this migration could most easily have caused. A step entered
   * twice must still be refused by the database, not merely by an `if`.
   */
  it.each([
    "business_readiness_audit",
    "opportunity_generation",
    "product_understanding",
    "action_planning",
  ] as const)("refuses a second usage row for one %s job", async (operation) => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    await recordAIUsage(supabase, usage({ operation, jobId: AUDIT_JOB }));
    await recordAIUsage(supabase, usage({ operation, jobId: AUDIT_JOB }));

    // `recordAIUsage` never throws — a ledger write must not fail work the
    // customer already paid for — so the proof is that the row did not land.
    expect(db.rows("ai_usage_events")).toHaveLength(1);
  });

  /**
   * The two worlds do not contaminate each other. An agent run's many rows must
   * not make an audit's job id look already-taken, and an audit's row must not
   * occupy an agent run's.
   */
  it("keeps the two exclusions independent", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    await recordAIUsage(supabase, usage({ jobId: AGENT_RUN }));
    await recordAIUsage(supabase, usage({ jobId: AGENT_RUN }));
    await recordAIUsage(
      supabase,
      usage({ operation: "business_readiness_audit", jobId: AGENT_RUN }),
    );

    // Two agent rows, plus one audit row that happens to share the id.
    expect(db.rows("ai_usage_events")).toHaveLength(3);

    // And the audit's own uniqueness still binds on that id.
    await recordAIUsage(
      supabase,
      usage({ operation: "business_readiness_audit", jobId: AGENT_RUN }),
    );
    expect(db.rows("ai_usage_events")).toHaveLength(3);
  });

  /** Rows with no job reference were never constrained and still are not. */
  it("leaves job-less rows unconstrained", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    await recordAIUsage(supabase, usage({ operation: "business_readiness_audit", jobId: null }));
    await recordAIUsage(supabase, usage({ operation: "business_readiness_audit", jobId: null }));

    expect(db.rows("ai_usage_events")).toHaveLength(2);
  });
});
