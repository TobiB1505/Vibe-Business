import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { MEASURED_USAGE_ROW_LIMIT, listMeasuredRunObservations } from "./measured-runs-store";

/**
 * Reading Vibe's own completed runs back, for the estimator that had been
 * answering from a constant.
 *
 * The assertion this file exists for is the read count. The obvious shape —
 * walk the runs and fetch each one's usage — is three round trips per run, and
 * this read happens on every render of the Agent screen. A version that grew
 * with how much a founder had used the product would pass every test about
 * *what* it returns.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

/** One succeeded run, with the rows a real one leaves behind. */
function seedRun(index: number) {
  const runId = `run_${index}`;
  const specId = `spec_${index}`;
  const preparedId = `prepared_${index}`;
  const validationId = `validation_${index}`;

  db.seed("execution_specs", {
    id: specId,
    risk_class: "moderate",
    action_plan_id: PLAN,
    step_key: `step_${index}`,
  });
  db.seed("action_plan_steps", {
    action_plan_id: PLAN,
    step_key: `step_${index}`,
    title: `Step ${index}`,
    change_kind: "product_change",
    evidence_ids: ["live.seo.sitemap_missing"],
  });
  db.seed("agent_execution_runs", {
    id: runId,
    project_id: PROJECT,
    status: "succeeded",
    created_at: `2026-09-0${index}T10:00:00.000Z`,
    prepared_change_id: preparedId,
    duration_ms: 300_000,
    execution_spec_id: specId,
    // The fake resolves no embed, so the joined shape is seeded the way
    // PostgREST would return it.
    execution_specs: { risk_class: "moderate", action_plan_id: PLAN, step_key: `step_${index}` },
  });
  db.seed("ai_usage_events", { job_id: runId, provider_cost_usd: "0.12" });
  db.seed("validation_runs", { id: validationId, prepared_change_id: preparedId });
  db.seed("sandbox_usage_events", {
    validation_run_id: runId,
    operation: "agent_execution",
    sandbox_duration_ms: 240_000,
    active_cpu_ms: null,
    network_egress_bytes: null,
  });
  // The validation's own sandbox, addressed by the validation run rather than
  // the agent run. Both purposes live in this table under one column, which is
  // why one read covers them and why the read has to name both id sets.
  db.seed("sandbox_usage_events", {
    validation_run_id: validationId,
    operation: "change_validation",
    sandbox_duration_ms: 90_000,
    active_cpu_ms: 40_000,
    network_egress_bytes: null,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
});

describe("reading completed runs", () => {
  it("returns nothing, and reads nothing further, when there are none", async () => {
    expect(await listMeasuredRunObservations(client())).toEqual([]);

    // The early return matters: a project that has never run the agent must
    // not pay four reads to be told so on every render.
    expect(readsOf(recorder, "ai_usage_events")).toBe(0);
    expect(readsOf(recorder, "sandbox_usage_events")).toBe(0);
    expect(readsOf(recorder, "action_plan_steps")).toBe(0);
  });

  it("projects a run into what its own rows say about it", async () => {
    seedRun(1);

    const [observation] = await listMeasuredRunObservations(client());

    expect(observation).toMatchObject({
      id: "run_1",
      createdAt: "2026-09-01T10:00:00.000Z",
      riskClass: "moderate",
      changeKind: "product_change",
      evidenceIds: ["live.seo.sitemap_missing"],
      validationAttempted: true,
      durationMs: 300_000,
    });
    // Exact integer nanodollars, parsed from the stored numeric rather than
    // through a float, so it reconciles against the ledger.
    expect(observation.providerCostNanoUsd).toBe(120_000_000);
    expect(observation.agentSandbox?.wallMs).toBe(240_000);
    expect(observation.validationSandbox?.wallMs).toBe(90_000);
  });

  it("does not grow its read count with the number of runs", async () => {
    for (const index of [1, 2, 3, 4, 5]) seedRun(index);

    const observations = await listMeasuredRunObservations(client());

    expect(observations).toHaveLength(5);

    /*
     * Coverage as well as count. Reading once is only correct if that one read
     * covers every run — a version that fetched usage for the first run alone
     * would keep the read count at one and quietly report four runs as
     * unpriced, which the projection then drops. Asserted per run so the
     * cheaper wrong shape cannot pass.
     */
    for (const observation of observations) {
      expect({ id: observation.id, cost: observation.providerCostNanoUsd }).toEqual({
        id: observation.id,
        cost: 120_000_000,
      });
      expect(observation.agentSandbox?.wallMs).toBe(240_000);
      expect(observation.validationSandbox?.wallMs).toBe(90_000);
      expect(observation.validationAttempted).toBe(true);
    }

    for (const table of [
      "agent_execution_runs",
      "ai_usage_events",
      "validation_runs",
      "action_plan_steps",
      "sandbox_usage_events",
    ]) {
      expect({ table, reads: readsOf(recorder, table) }).toEqual({ table, reads: 1 });
    }
  });

  it("leaves out a run whose plan step no longer resolves", async () => {
    /*
     * Six of this account's thirteen succeeded runs are in exactly this state:
     * the plan was regenerated and the step key no longer matches anything. A
     * run Vibe cannot classify is not a run at some default classification —
     * similarity is computed from `changeKind`, `riskClass` and evidence, and
     * inventing any of them would put a made-up neighbour in the sample.
     */
    seedRun(1);
    db.rows("action_plan_steps").length = 0;

    expect(await listMeasuredRunObservations(client())).toEqual([]);
  });

  it("reports no model spend rather than zero when nothing was priced", async () => {
    // An unmetered run is not a free one. Null travels, and the projection
    // drops it rather than averaging a zero into the expectation (rule 44).
    seedRun(1);
    db.rows("ai_usage_events")[0].provider_cost_usd = null;

    const [observation] = await listMeasuredRunObservations(client());

    expect(observation.providerCostNanoUsd).toBeNull();
  });

  it("reads only succeeded runs", async () => {
    /*
     * A failed run cost real money, and what it cost is not what a comparable
     * run costs — it is what stopping early costs. Averaging the two predicts
     * neither.
     */
    seedRun(1);
    db.rows("agent_execution_runs")[0].status = "failed";

    expect(await listMeasuredRunObservations(client())).toEqual([]);
  });

  it("answers nothing when a usage read may have been cut short", async () => {
    /*
     * A truncated usage read does not make runs cheap, it makes their cost
     * unknown — and an unknown read as a total would bias every forecast
     * downward for as long as the account kept running the agent. Falling back
     * to Vibe's published measured runs is the honest smaller answer.
     */
    seedRun(1);
    for (let index = 0; index < MEASURED_USAGE_ROW_LIMIT; index += 1) {
      db.seed("ai_usage_events", { job_id: "run_1", provider_cost_usd: "0.01" });
    }

    expect(await listMeasuredRunObservations(client())).toEqual([]);
  });
});
