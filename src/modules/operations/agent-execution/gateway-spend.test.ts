import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";

/**
 * VB-016 — the agent budget counts what was billed, not what succeeded.
 *
 * The ceiling summed `output_tokens` from rows whose status was `succeeded`.
 * That reasoning is half right and the half it misses costs money: a stream
 * that fails *after* the provider has emitted tokens is billed for them, and
 * its row is `failed`. Those tokens were excluded from the ceiling entirely,
 * so a loop whose calls all die late spent real money against a budget that
 * never noticed.
 *
 * `route.test.ts` mocks this read, so nothing exercised the arithmetic. This
 * does, against the ledger rows `recordAIUsage` actually writes.
 */

const db = { current: new FakeDatabase() };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(db.current),
}));

const { readAgentRunGatewayState } = await import("./gateway-state");

const RUN = "run_1";

function seedRun() {
  db.current.seed("agent_execution_runs", {
    id: RUN,
    status: "running",
    project_id: "project_1",
    user_id: "user_1",
    execution_spec_id: "spec_1",
  });
}

function seedUsage(status: string, outputTokens: number | null) {
  db.current.seed("ai_usage_events", {
    job_id: RUN,
    status,
    output_tokens: outputTokens,
  });
}

beforeEach(() => {
  db.current = new FakeDatabase();
  seedRun();
});

describe("what counts toward the ceiling", () => {
  it("counts a successful call's tokens", async () => {
    seedUsage("succeeded", 1_000);

    expect((await readAgentRunGatewayState({ runId: RUN }))?.spentOutputTokens).toBe(1_000);
  });

  /**
   * The defect, stated as the test that would have caught it. Before the fix
   * this returned 0 and the run kept its whole budget after spending 4,000
   * tokens of it.
   */
  it("counts tokens the provider billed on a stream that then failed", async () => {
    seedUsage("failed", 4_000);

    expect((await readAgentRunGatewayState({ runId: RUN }))?.spentOutputTokens).toBe(4_000);
  });

  /**
   * The original reasoning, preserved. A call that failed before the provider
   * billed anything must not consume budget, or a flaky network exhausts a
   * customer's authorization without producing a token of work. Summing tokens
   * gets this right without needing to know which kind of failure it was.
   */
  it("counts nothing for a failure that billed nothing", async () => {
    seedUsage("failed", 0);
    seedUsage("failed", null);

    expect((await readAgentRunGatewayState({ runId: RUN }))?.spentOutputTokens).toBe(0);
  });

  it("sums a realistic mix", async () => {
    seedUsage("succeeded", 900);
    seedUsage("failed", null);
    seedUsage("failed", 250);
    seedUsage("succeeded", 350);

    const state = await readAgentRunGatewayState({ runId: RUN });

    expect(state?.spentOutputTokens).toBe(1_500);
    // The request ceiling is unchanged and still counts attempts: a loop that
    // fails every call is still a loop.
    expect(state?.forwardedRequests).toBe(4);
  });
});

describe("scope", () => {
  it("counts only this run's ledger rows", async () => {
    seedUsage("succeeded", 500);
    db.current.seed("ai_usage_events", {
      job_id: "run_other",
      status: "succeeded",
      output_tokens: 90_000,
    });

    expect((await readAgentRunGatewayState({ runId: RUN }))?.spentOutputTokens).toBe(500);
  });
});
