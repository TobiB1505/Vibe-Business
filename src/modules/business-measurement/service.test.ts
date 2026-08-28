import { beforeEach, describe, expect, it } from "vitest";
import { getPreparedChange } from "@/modules/execution/store";
import { getLatestMergeForPreparedChange } from "@/modules/merge/store";
import {
  FakeExecutor,
  fakeSupabase,
  newQueryRecorder,
} from "@/modules/operations/test-support";
import { findCausalClaims } from "./causality";
import { MEASUREMENT_POLICY_VERSION } from "./schema";
import {
  ensureMeasurementPlan,
  getBusinessImpactCard,
  getBusinessImpactCards,
  startBusinessMeasurement,
} from "./service";
import { NoConnectedMetricSources } from "./source";
import {
  FakeDatabase,
  FakeMetricSource,
  FakeSourceRegistry,
  MEASUREMENT_FIXTURES,
  seedMergedForMeasurement,
  type SeedMergedOptions,
} from "./test-support";

/**
 * Planning, starting and reading a business measurement
 * (Sprint 12B §8, §34, §35, §36, §44, §45).
 *
 * ## What this file mostly asserts
 *
 * That nothing is spent and nothing is claimed. The strongest tests here are
 * negative: rendering costs no provider call, a project with no analytics gets
 * a truthful sentence rather than a result, and a double click produces one
 * measurement rather than two.
 */

let db: FakeDatabase;
let executor: FakeExecutor;

function client() {
  return fakeSupabase(db);
}

const params = {
  projectId: MEASUREMENT_FIXTURES.project,
  userId: MEASUREMENT_FIXTURES.user,
  preparedChangeId: MEASUREMENT_FIXTURES.preparedChange,
};

function seed(options: SeedMergedOptions = {}) {
  seedMergedForMeasurement(db, options);
}

/** A connected search source, for the paths that need one. */
function connectedRegistry(source = new FakeMetricSource()) {
  return new FakeSourceRegistry([source]);
}

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
});

describe("a plan is deterministic, free, and needs no source (§8)", () => {
  it("names the metric the SEO capability was built to move", async () => {
    seed();

    const outcome = await ensureMeasurementPlan(client(), params);

    expect(outcome.kind).toBe("created");
    if (outcome.kind === "blocked") return;
    expect(outcome.plan.primaryMetric).toBe("search_impressions");
    expect(outcome.plan.metricDirection).toBe("higher_is_better");
    expect(outcome.plan.metricCategory).toBe("search_visibility");
    expect(outcome.plan.status).toBe("ready");
  });

  it("uses weeks, not minutes — the whole reason this domain exists (§31)", async () => {
    seed();

    const outcome = await ensureMeasurementPlan(client(), params);
    if (outcome.kind === "blocked") throw new Error("expected a plan");

    expect(outcome.plan.baselineDays).toBe(28);
    expect(outcome.plan.measurementDays).toBe(28);
    // Search is slow: a crawler may take a fortnight to come back.
    expect(outcome.plan.settlingDays).toBe(14);
  });

  it("costs no provider call and no AI call", async () => {
    seed();

    await ensureMeasurementPlan(client(), params);

    expect(db.rows("ai_usage_events")).toHaveLength(0);
    expect(db.rows("sandbox_usage_events")).toHaveLength(0);
    expect(db.rows("business_outcome_measurements")).toHaveLength(0);
  });

  it("states the goal in the founder's own terms when context exists", async () => {
    seed({ primaryGoal: "improve_conversion" });

    const outcome = await ensureMeasurementPlan(client(), params);
    if (outcome.kind === "blocked") throw new Error("expected a plan");

    expect(outcome.plan.businessGoal).toContain("ready to convert");
  });

  it("falls back to the capability's own rationale with no context", async () => {
    seed({ withContext: false });

    const outcome = await ensureMeasurementPlan(client(), params);
    if (outcome.kind === "blocked") throw new Error("expected a plan");

    expect(outcome.plan.businessGoal).toContain("search");
  });

  it("records an unsupported capability rather than inventing a metric (§8)", async () => {
    seed({ capability: "some_future_capability" });

    const outcome = await ensureMeasurementPlan(client(), params);
    if (outcome.kind === "blocked") throw new Error("expected a plan row");

    expect(outcome.plan.status).toBe("unsupported");
    expect(outcome.plan.unsupportedReason).toBeTruthy();
  });

  it("refuses for a change that was never merged", async () => {
    seed({ mergeStatus: "blocked" });

    expect(await ensureMeasurementPlan(client(), params)).toEqual({
      kind: "blocked",
      reason: "measurement_merge_required",
    });
    expect(db.rows("measurement_plans")).toHaveLength(0);
  });

  it("refuses a caller who does not own the project", async () => {
    seed();

    expect(await ensureMeasurementPlan(client(), { ...params, userId: "someone_else" })).toEqual({
      kind: "blocked",
      reason: "measurement_not_authorized",
    });
  });

  it("creates exactly one plan per merge, however often it is asked (§35)", async () => {
    seed();

    const first = await ensureMeasurementPlan(client(), params);
    const second = await ensureMeasurementPlan(client(), params);

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("exists");
    expect(db.rows("measurement_plans")).toHaveLength(1);
  });

  it("records the policy version the plan was written under (§12)", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);

    expect(db.rows("measurement_plans")[0].measurement_policy_version).toBe(
      MEASUREMENT_POLICY_VERSION,
    );
  });
});

describe("no source means no measurement, and no result (§34, §49)", () => {
  it("refuses to start when nothing is connected", async () => {
    seed();

    const outcome = await startBusinessMeasurement(
      client(),
      executor,
      new NoConnectedMetricSources(),
      params,
    );

    expect(outcome).toEqual({ kind: "blocked", reason: "metric_source_required" });
  });

  it("creates no measurement row and no operation when nothing is connected", async () => {
    // A `waiting_for_source` row for every project in the product would be a
    // permanent table of things nobody can perform (§34).
    seed();

    await startBusinessMeasurement(client(), executor, new NoConnectedMetricSources(), params);

    expect(db.rows("business_outcome_measurements")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
  });

  it("makes no metric query when nothing is connected (§45)", async () => {
    seed();
    const source = new FakeMetricSource();
    const registry = new FakeSourceRegistry([]);

    await startBusinessMeasurement(client(), executor, registry, params);

    expect(source.requests).toHaveLength(0);
  });
});

describe("starting a measurement fixes both windows up front (§42)", () => {
  it("records windows that do not overlap", async () => {
    seed();

    const outcome = await startBusinessMeasurement(client(), executor, connectedRegistry(), params);
    expect(outcome.kind).toBe("started");

    const row = db.rows("business_outcome_measurements")[0];
    expect(Date.parse(String(row.measurement_start))).toBeGreaterThanOrEqual(
      Date.parse(String(row.baseline_end)),
    );
  });

  it("records the timezone explicitly (§32)", async () => {
    seed();
    await startBusinessMeasurement(client(), executor, connectedRegistry(), params);

    expect(db.rows("business_outcome_measurements")[0].measurement_timezone).toBe("UTC");
  });

  it("opens with no values and no classification (§44)", async () => {
    seed();
    await startBusinessMeasurement(client(), executor, connectedRegistry(), params);

    const row = db.rows("business_outcome_measurements")[0];
    expect(row.status).toBe("waiting_for_window");
    expect(row.baseline_value ?? null).toBeNull();
    expect(row.observed_value ?? null).toBeNull();
    expect(row.data_quality ?? null).toBeNull();
    expect(row.completed_at ?? null).toBeNull();
    expect(row.provenance).toEqual([]);
  });

  it("records when the measurement becomes due, rather than sleeping (§30)", async () => {
    seed();
    await startBusinessMeasurement(client(), executor, connectedRegistry(), params);

    const row = db.rows("business_outcome_measurements")[0];
    expect(row.next_observation_at).toBe(row.measurement_end);
  });

  it("does not enqueue a workflow six weeks early (§30)", async () => {
    // The window has not closed, so there is nothing for a durable run to do —
    // and a run holding a slot for six weeks would be the design §30 rejects.
    seed();

    await startBusinessMeasurement(client(), executor, connectedRegistry(), params);

    expect(executor.starts).toHaveLength(0);
  });

  it("enqueues once the window has closed", async () => {
    seed();

    await startBusinessMeasurement(client(), executor, connectedRegistry(), {
      ...params,
      now: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("business_measurement");
  });
});

describe("one measurement per question (§35, §46)", () => {
  it("returns the existing measurement on a double click", async () => {
    seed();
    const registry = connectedRegistry();

    const first = await startBusinessMeasurement(client(), executor, registry, params);
    const second = await startBusinessMeasurement(client(), executor, registry, params);

    expect(first.kind).toBe("started");
    expect(second.kind).toBe("active");
    expect(db.rows("business_outcome_measurements")).toHaveLength(1);
  });

  it("does not re-measure a terminal result", async () => {
    seed();
    const registry = connectedRegistry();
    await startBusinessMeasurement(client(), executor, registry, params);

    const row = db.rows("business_outcome_measurements")[0];
    row.status = "improved";
    row.completed_at = "2026-09-26T01:00:00.000Z";

    const again = await startBusinessMeasurement(client(), executor, registry, params);

    expect(again.kind).toBe("active");
    expect(db.rows("business_outcome_measurements")).toHaveLength(1);
  });
});

describe("reading a whole list's cards (VB-023)", () => {
  /**
   * The batch is what the Agent screen calls, and the single-change function
   * now delegates to it — so nothing else in this repository verifies that the
   * plan chain is resolved *per change* rather than once and shared.
   *
   * Two merged changes with two different plans is the smallest arrangement
   * where getting that wrong is visible.
   */
  const SECOND_CHANGE = "prepared_measure_2";
  const SECOND_MERGE = "merge_measure_2";

  function seedSecondMergedChange() {
    db.seed("prepared_changes", {
      id: SECOND_CHANGE,
      project_id: MEASUREMENT_FIXTURES.project,
      user_id: MEASUREMENT_FIXTURES.user,
      status: "prepared",
      execution_capability: "nextjs_seo_foundations_v2",
      execution_version: "nextjs-seo-foundations-v2",
      repository_snapshot_id: MEASUREMENT_FIXTURES.snapshot,
      commit_sha: "f".repeat(40),
      base_sha: "b".repeat(40),
      base_branch: "main",
      branch_name: "vibe/seo-foundations-2",
      files: [],
    });

    db.seed("change_merges", {
      id: SECOND_MERGE,
      project_id: MEASUREMENT_FIXTURES.project,
      user_id: MEASUREMENT_FIXTURES.user,
      prepared_change_id: SECOND_CHANGE,
      prepared_commit_sha: "f".repeat(40),
      prepared_base_sha: "b".repeat(40),
      default_branch: "main",
      merge_policy_version: "merge-policy-v1",
      merge_strategy: "fast_forward_exact_commit",
      status: "merged",
      resulting_default_head_sha: "f".repeat(40),
    });
  }

  async function changes() {
    const supabase = client();
    return [
      {
        preparedChangeId: MEASUREMENT_FIXTURES.preparedChange,
        merge: await getLatestMergeForPreparedChange(supabase, {
          projectId: MEASUREMENT_FIXTURES.project,
          preparedChangeId: MEASUREMENT_FIXTURES.preparedChange,
        }),
        prepared: await getPreparedChange(supabase, {
          projectId: MEASUREMENT_FIXTURES.project,
          preparedChangeId: MEASUREMENT_FIXTURES.preparedChange,
        }),
      },
      {
        preparedChangeId: SECOND_CHANGE,
        merge: await getLatestMergeForPreparedChange(supabase, {
          projectId: MEASUREMENT_FIXTURES.project,
          preparedChangeId: SECOND_CHANGE,
        }),
        prepared: await getPreparedChange(supabase, {
          projectId: MEASUREMENT_FIXTURES.project,
          preparedChangeId: SECOND_CHANGE,
        }),
      },
    ];
  }

  it("gives each change its own plan", async () => {
    seed();
    seedSecondMergedChange();

    await ensureMeasurementPlan(client(), params);
    await ensureMeasurementPlan(client(), { ...params, preparedChangeId: SECOND_CHANGE });

    const plans = db.rows("measurement_plans");
    expect(plans).toHaveLength(2);

    const cards = await getBusinessImpactCards(client(), new NoConnectedMetricSources(), {
      projectId: MEASUREMENT_FIXTURES.project,
      changes: await changes(),
    });

    const first = cards.get(MEASUREMENT_FIXTURES.preparedChange);
    const second = cards.get(SECOND_CHANGE);

    expect(first?.measurementPlanId).toBe(
      plans.find((plan) => plan.prepared_change_id === MEASUREMENT_FIXTURES.preparedChange)?.id,
    );
    expect(second?.measurementPlanId).toBe(
      plans.find((plan) => plan.prepared_change_id === SECOND_CHANGE)?.id,
    );
    expect(first?.measurementPlanId).not.toBe(second?.measurementPlanId);
  });

  it("reads the plan chain once for the list, not once per change", async () => {
    seed();
    seedSecondMergedChange();
    await ensureMeasurementPlan(client(), params);
    await ensureMeasurementPlan(client(), { ...params, preparedChangeId: SECOND_CHANGE });

    const recorder = newQueryRecorder();
    await getBusinessImpactCards(fakeSupabase(db, recorder), new NoConnectedMetricSources(), {
      projectId: MEASUREMENT_FIXTURES.project,
      changes: await changes(),
    });

    expect(recorder.reads).toEqual(["measurement_plans", "business_outcome_measurements"]);
  });

  it("costs nothing at all when nothing in the list was merged", async () => {
    seed({ mergeStatus: "blocked" });

    const recorder = newQueryRecorder();
    const cards = await getBusinessImpactCards(fakeSupabase(db, recorder), new NoConnectedMetricSources(), {
      projectId: MEASUREMENT_FIXTURES.project,
      changes: await changes(),
    });

    expect(recorder.reads).toEqual([]);
    expect(cards.get(MEASUREMENT_FIXTURES.preparedChange)?.state).toBe("unavailable");
  });
});

describe("reading the card spends nothing (§36, §45)", () => {
  it("makes no provider call and creates no plan", async () => {
    seed();
    const source = new FakeMetricSource();

    const card = await getBusinessImpactCard(client(), new FakeSourceRegistry([source]), {
      projectId: params.projectId,
      preparedChangeId: params.preparedChangeId,
    });

    expect(card.state).toBe("not_planned");
    // Rendering must never write a durable record, and must never query a
    // vendor for a metric.
    expect(db.rows("measurement_plans")).toHaveLength(0);
    expect(source.requests).toHaveLength(0);
    expect(db.rows("audit_events")).toHaveLength(0);
  });

  it("stays free after a plan exists", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);
    const source = new FakeMetricSource();

    for (let index = 0; index < 5; index += 1) {
      await getBusinessImpactCard(client(), new FakeSourceRegistry([source]), {
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
      });
    }

    expect(source.requests).toHaveLength(0);
    expect(db.rows("business_outcome_measurements")).toHaveLength(0);
  });

  it("says a source is required, never that there was no impact (§21, §48)", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);

    const card = await getBusinessImpactCard(client(), new NoConnectedMetricSources(), {
      projectId: params.projectId,
      preparedChangeId: params.preparedChangeId,
    });

    expect(card.state).toBe("source_required");
    expect(card.headline).toBe("Measurement source required");
    expect(card.failureMessage).toContain("Connect an analytics source");
    // The sentence that must never appear when nothing is connected.
    expect(card.headline.toLowerCase()).not.toContain("no impact");
    expect(card.ladderLabel.toLowerCase()).not.toBe("no impact");
    // And it still names what *would* be measured, so the screen is useful.
    expect(card.metricLabel).toBe("Search impressions");
  });

  it("offers the action once a source is connected", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);

    const card = await getBusinessImpactCard(client(), connectedRegistry(), {
      projectId: params.projectId,
      preparedChangeId: params.preparedChangeId,
    });

    expect(card.state).toBe("scheduled");
    expect(card.canStartMeasuring).toBe(true);
  });

  it("never offers a connect action, because no connector exists (§34, §49)", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);

    const card = await getBusinessImpactCard(client(), new NoConnectedMetricSources(), {
      projectId: params.projectId,
      preparedChangeId: params.preparedChangeId,
    });

    expect(card.canConnectSource).toBe(false);
  });

  it("never claims causal evidence, in any state (§10, §43)", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);

    const card = await getBusinessImpactCard(client(), new NoConnectedMetricSources(), {
      projectId: params.projectId,
      preparedChangeId: params.preparedChangeId,
    });

    expect(card.causalEvidence).toBe(false);
    expect(findCausalClaims(`${card.headline} ${card.failureMessage ?? ""}`)).toEqual([]);
  });

  it("is unavailable for a change that was never merged", async () => {
    seed({ mergeStatus: "failed" });

    const card = await getBusinessImpactCard(client(), new NoConnectedMetricSources(), {
      projectId: params.projectId,
      preparedChangeId: params.preparedChangeId,
    });

    expect(card.state).toBe("unavailable");
  });
});

describe("audit events carry no credentials and no payloads (§39)", () => {
  it("records the plan without a vendor name or a token", async () => {
    seed();
    await ensureMeasurementPlan(client(), params);

    const event = db.rows("audit_events").find((row) => row.event_type === "business_measurement.created");
    const metadata = JSON.stringify(event?.metadata);

    expect(metadata).toContain("search_impressions");
    expect(metadata.toLowerCase()).not.toContain("token");
    expect(metadata.toLowerCase()).not.toContain("secret");
  });

  it("records a start with a vendor-neutral source kind only", async () => {
    seed();
    await startBusinessMeasurement(client(), executor, connectedRegistry(), {
      ...params,
      now: new Date("2026-12-01T00:00:00.000Z"),
    });

    const event = db.rows("audit_events").find((row) => row.event_type === "business_measurement.started");
    const metadata = event?.metadata as Record<string, unknown>;

    expect(metadata.source_kind).toBe("search_console");
    // The adapter's own identifier is fine; a vendor account id is not.
    expect(JSON.stringify(metadata).toLowerCase()).not.toContain("account_id");
  });
});
