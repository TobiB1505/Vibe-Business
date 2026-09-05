import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { readExecutionEconomics } from "./store";

/**
 * `ai_usage_events` is deliberately unreachable through the Data API (see
 * `service-boundary.test.ts`), so `readExecutionEconomics` reads it through
 * the service-role client via `list_ai_usage_events_for_run` rather than the
 * caller's session-scoped one. `FakeDatabase` has no RLS to bypass, so both
 * clients are the same fake here — this test is about the join's scoping, not
 * about who is allowed to run it.
 */

const db = { current: new FakeDatabase() };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(db.current),
}));

const supabase = () => fakeSupabase(db.current);

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const RUN = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  db.current = new FakeDatabase();
});

describe("readExecutionEconomics", () => {
  it("reads this run's ai_usage_events, scoped to both the run and the project", async () => {
    db.current.seed("ai_usage_events", {
      job_id: RUN,
      project_id: PROJECT,
      status: "succeeded",
      output_tokens: 50,
      provider_cost_usd: "0.01",
    });
    // A different run must never leak into this one's total.
    db.current.seed("ai_usage_events", {
      job_id: "some-other-run",
      project_id: PROJECT,
      status: "succeeded",
      output_tokens: 999,
      provider_cost_usd: "9.99",
    });
    // Same run id under a different project must be excluded too — the
    // function filters on both, not just job_id.
    db.current.seed("ai_usage_events", {
      job_id: RUN,
      project_id: OTHER_PROJECT,
      status: "succeeded",
      output_tokens: 999,
      provider_cost_usd: "9.99",
    });

    const economics = await readExecutionEconomics(supabase(), {
      runId: RUN,
      projectId: PROJECT,
    });

    expect(economics.provider.calls).toBe(1);
    expect(economics.provider.costUsd).toBeCloseTo(0.01, 9);
  });

  it("answers zero calls for a run with no usage events, rather than throwing", async () => {
    const economics = await readExecutionEconomics(supabase(), {
      runId: RUN,
      projectId: PROJECT,
    });

    expect(economics.provider.calls).toBe(0);
  });
});
