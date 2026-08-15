import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { metricDefinition } from "@/modules/business-measurement/metrics";
import { MEASUREMENT_POLICY_VERSION, MEASUREMENT_EVIDENCE_SCHEMA_VERSION } from "@/modules/business-measurement/schema";
import { createMeasurement } from "@/modules/business-measurement/store";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import {
  FakeDatabase,
  FakeMetricSource,
  FakeSourceRegistry,
  MEASUREMENT_FIXTURES,
  flatSeries,
  seedMergedForMeasurement,
} from "@/modules/business-measurement/test-support";
import { planWindows } from "@/modules/business-measurement/windows";
import { fakeSupabase } from "../test-support";
import {
  abortMeasurementStep,
  completeMeasurementOperationStep,
  measureBusinessOutcomeStep,
  type MeasurementDeps,
} from "./execution";

/**
 * The durable measurement (Sprint 12B §33, §38, §41, §45, §46).
 *
 * ## The failure class this is written against
 *
 * Sprint 10B's preview usage ledger: the external work succeeded, RLS silently
 * refused the persistence, and every test stayed green because none of them
 * asked whether the row arrived. So the assertions here check the **row**, not
 * the return value.
 *
 * ## And the distinction it must never lose
 *
 * A source failing is not the customer's metric falling. Every source failure
 * has its own code and none of them may become `degraded` (§33, mutation 10).
 */

let db: FakeDatabase;

const OPERATION_ID = "operation_measure";
const MERGED_AT = new Date("2026-08-14T14:40:56.438Z");
const AFTER_WINDOW = new Date("2026-12-01T00:00:00.000Z");

const WINDOWS = planWindows({
  mergedAt: MERGED_AT,
  baselineDays: 28,
  measurementDays: 28,
  settlingDays: 14,
});

function deps(registry: FakeSourceRegistry | NoConnectedMetricSources): MeasurementDeps {
  return { supabase: fakeSupabase(db), sources: registry };
}

/** A connected source whose two windows carry the given daily values. */
function sourceWith(baselinePerDay: number, postPerDay: number) {
  return new FakeMetricSource({
    seriesByWindowStart: {
      [WINDOWS.baseline.start]: flatSeries(28, baselinePerDay),
      [WINDOWS.measurement.start]: flatSeries(28, postPerDay),
    },
  });
}

async function seedMeasurement(): Promise<void> {
  seedMergedForMeasurement(db);

  db.seed("measurement_plans", {
    id: "plan_measure",
    project_id: MEASUREMENT_FIXTURES.project,
    user_id: MEASUREMENT_FIXTURES.user,
    prepared_change_id: MEASUREMENT_FIXTURES.preparedChange,
    change_merge_id: MEASUREMENT_FIXTURES.merge,
    primary_metric: "search_impressions",
    metric_direction: "higher_is_better",
    status: "ready",
  });

  db.seed("operation_runs", {
    id: OPERATION_ID,
    project_id: MEASUREMENT_FIXTURES.project,
    user_id: MEASUREMENT_FIXTURES.user,
    operation_type: "business_measurement",
    status: "queued",
    stage: "preparing",
    input_identity: "i".repeat(64),
  });

  const created = await createMeasurement(fakeSupabase(db), {
    projectId: MEASUREMENT_FIXTURES.project,
    userId: MEASUREMENT_FIXTURES.user,
    measurementPlanId: "plan_measure",
    changeMergeId: MEASUREMENT_FIXTURES.merge,
    metricKey: "search_impressions",
    metricDirection: "higher_is_better",
    metricAggregation: metricDefinition("search_impressions").aggregation,
    baselineWindow: WINDOWS.baseline,
    measurementWindow: WINDOWS.measurement,
    status: "waiting_for_window",
    measurementPolicyVersion: MEASUREMENT_POLICY_VERSION,
    measurementProfileVersion: "nextjs-seo-foundations-measurement-v1",
    evidenceSchemaVersion: MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
    measurementIdentity: "m".repeat(64),
    operationRunId: OPERATION_ID,
    nextObservationAt: WINDOWS.resultAvailableAt,
  });

  if (!created.ok) throw new Error("fixture measurement could not be created");
}

function row() {
  return db.rows("business_outcome_measurements")[0];
}

function events(): string[] {
  return db.rows("audit_events").map((entry) => String(entry.event_type));
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("a measurement that is not due queries nothing (§45)", () => {
  it("makes no metric request before the window closes", async () => {
    await seedMeasurement();
    const source = sourceWith(100, 130);

    const outcome = await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([source])),
      OPERATION_ID,
      new Date("2026-09-01T00:00:00.000Z"),
    );

    expect(outcome.ok).toBe(false);
    expect(source.requests).toHaveLength(0);
    expect(row().status).toBe("waiting_for_window");
  });

  it("reads the stored window rather than recomputing one (§42)", async () => {
    await seedMeasurement();
    const source = sourceWith(100, 130);

    await measureBusinessOutcomeStep(deps(new FakeSourceRegistry([source])), OPERATION_ID, AFTER_WINDOW);

    // The windows requested are byte-identical to the stored ones. A recomputed
    // window would drift forward every time the step ran.
    expect(source.requests.map((request) => request.window.start)).toEqual([
      WINDOWS.baseline.start,
      WINDOWS.measurement.start,
    ]);
  });
});

describe("a complete measurement records the numbers behind it (§37, §38)", () => {
  it("classifies an increase as improved and stores the values", async () => {
    await seedMeasurement();

    const outcome = await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([sourceWith(100, 130)])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    expect(outcome).toEqual({ ok: true });
    expect(row().status).toBe("improved");
    expect(row().baseline_value).toBe(2800);
    expect(row().observed_value).toBe(3640);
    expect(row().sample_size_before).toBe(2800);
    expect(row().data_quality).toBe("complete");
    expect(row().completed_at).toBeTruthy();
  });

  it("records a decrease as degraded rather than hiding it (§25)", async () => {
    await seedMeasurement();

    await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([sourceWith(1000, 700)])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    expect(row().status).toBe("degraded");
    expect(Number(row().observed_relative_change)).toBeLessThan(0);
  });

  it("records insufficient_data rather than a result from thin data (§14)", async () => {
    await seedMeasurement();

    await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([sourceWith(1, 2)])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    expect(row().status).toBe("insufficient_data");
    expect(row().observed_relative_change ?? null).toBeNull();
    expect(events()).toContain("business_measurement.insufficient_data");
  });

  it("stores provenance for both windows, with no credential (§18)", async () => {
    await seedMeasurement();

    await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([sourceWith(100, 130)])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    const provenance = row().provenance as Array<Record<string, unknown>>;
    expect(provenance).toHaveLength(2);
    expect(provenance[0].sourceKind).toBe("search_console");
    expect(provenance[0].adapter).toBe("fake_search_console_v1");
    expect(provenance[0].daysReturned).toBe(28);

    const serialized = JSON.stringify(provenance).toLowerCase();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("api_key");
  });

  it("never stores the daily series itself", async () => {
    await seedMeasurement();

    await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([sourceWith(100, 130)])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    // Two aggregates and two sample sizes — never 56 daily values.
    const serialized = JSON.stringify(row());
    expect(serialized).not.toContain('"points"');
  });

  it("emits exactly one terminal audit event, even when replayed (§35)", async () => {
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([sourceWith(100, 130)]));

    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);

    expect(events().filter((type) => type === "business_measurement.completed")).toHaveLength(1);
    expect(db.rows("business_outcome_measurements")).toHaveLength(1);
  });

  it("does not re-query the source once terminal", async () => {
    await seedMeasurement();
    const source = sourceWith(100, 130);
    const dependencies = deps(new FakeSourceRegistry([source]));

    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    const after = source.requests.length;
    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);

    expect(source.requests).toHaveLength(after);
  });
});

describe("a source failure is never a business result (§33, §46)", () => {
  it.each([
    ["unauthorized", "metric_source_unauthorized", true],
    ["rate_limited", "metric_source_rate_limited", true],
    ["unavailable", "metric_source_unavailable", true],
    ["metric_unsupported", "metric_unavailable", false],
  ] as const)("maps %s to %s", async (failWith, expected, retryable) => {
    await seedMeasurement();

    const outcome = await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([new FakeMetricSource({ failWith })])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    expect(outcome).toEqual({ ok: false, failureCode: expected, retryable });
  });

  it("never records degraded for a source failure", async () => {
    // The mutation this kills: collapsing provider errors into a metric verdict,
    // which would tell a customer their traffic fell because our token expired.
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([new FakeMetricSource({ failWith: "unavailable" })]));

    const outcome = await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    if (outcome.ok) throw new Error("expected a failure");
    await abortMeasurementStep(dependencies, OPERATION_ID, outcome);

    expect(row().status).toBe("failed");
    expect(row().status).not.toBe("degraded");
    expect(row().failure_code).toBe("metric_source_unavailable");
    expect(row().baseline_value ?? null).toBeNull();
  });

  it("keeps a retryable failure due, so 'Vibe will try again' is true (§33)", async () => {
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([new FakeMetricSource({ failWith: "rate_limited" })]));

    const outcome = await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    if (outcome.ok) throw new Error("expected a failure");
    await abortMeasurementStep(dependencies, OPERATION_ID, outcome);

    expect(row().next_observation_at).toBeTruthy();
  });

  it("clears the due marker for a permanent failure", async () => {
    await seedMeasurement();
    const dependencies = deps(
      new FakeSourceRegistry([new FakeMetricSource({ failWith: "metric_unsupported" })]),
    );

    const outcome = await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    if (outcome.ok) throw new Error("expected a failure");
    await abortMeasurementStep(dependencies, OPERATION_ID, outcome);

    expect(row().next_observation_at ?? null).toBeNull();
  });

  it("reports a disconnected source as source_required, not as a metric result", async () => {
    await seedMeasurement();

    const outcome = await measureBusinessOutcomeStep(
      deps(new NoConnectedMetricSources()),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    expect(outcome).toEqual({ ok: false, failureCode: "metric_source_required", retryable: true });
    expect(row().status).toBe("waiting_for_window");
  });

  it("never records a result when only the post-change window fails", async () => {
    // The realistic shape: the baseline is history and returns instantly, the
    // recent window is what a provider rate-limits. A source failing there must
    // not become "the metric fell" — which is the mutation §46.10 names, and
    // which a baseline-only failure test cannot catch.
    await seedMeasurement();
    const source = new FakeMetricSource({
      failWith: "rate_limited",
      failWindowStart: WINDOWS.measurement.start,
      seriesByWindowStart: { [WINDOWS.baseline.start]: flatSeries(28, 100) },
    });
    const dependencies = deps(new FakeSourceRegistry([source]));

    const outcome = await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);

    if (outcome.ok) throw new Error("expected a source failure");
    expect(outcome).toEqual({
      ok: false,
      failureCode: "metric_source_rate_limited",
      retryable: true,
    });
    // Nothing terminal was written, and certainly not a verdict.
    expect(row().status).toBe("measuring");
    expect(row().baseline_value ?? null).toBeNull();
    expect(row().completed_at ?? null).toBeNull();

    await abortMeasurementStep(dependencies, OPERATION_ID, outcome);
    expect(row().status).toBe("failed");
    expect(row().status).not.toBe("degraded");
  });

  it("never queries the post window when the baseline read failed", async () => {
    // Half a comparison is not worth a second provider call.
    await seedMeasurement();
    const source = new FakeMetricSource({ failWith: "unavailable" });

    await measureBusinessOutcomeStep(deps(new FakeSourceRegistry([source])), OPERATION_ID, AFTER_WINDOW);

    expect(source.requests).toHaveLength(1);
  });
});

describe("a terminal measurement is immutable (§12, §38)", () => {
  it("refuses to overwrite a completed result", async () => {
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([sourceWith(100, 130)]));

    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    expect(row().status).toBe("improved");

    await abortMeasurementStep(dependencies, OPERATION_ID, {
      failureCode: "measurement_failed",
      retryable: false,
    });

    expect(row().status).toBe("improved");
  });
});

describe("nothing billed is touched (§36, §45)", () => {
  it("makes no AI, sandbox, browser or GitHub call for a whole run", async () => {
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([sourceWith(100, 130)]));

    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    await completeMeasurementOperationStep(dependencies, OPERATION_ID);

    for (const table of [
      "ai_usage_events",
      "sandbox_usage_events",
      "review_browser_usage",
      "business_readiness_audits",
      "opportunity_sets",
      "prepared_changes_writes",
      "change_merges_writes",
    ]) {
      expect(db.rows(table)).toHaveLength(0);
    }
  });

  it("makes exactly two metric requests — one per window", async () => {
    await seedMeasurement();
    const source = sourceWith(100, 130);

    await measureBusinessOutcomeStep(deps(new FakeSourceRegistry([source])), OPERATION_ID, AFTER_WINDOW);

    expect(source.requests).toHaveLength(2);
  });

  it("never reverts, re-merges or redeploys after a degraded result (§28)", async () => {
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([sourceWith(1000, 700)]));

    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);

    expect(row().status).toBe("degraded");
    // The merge record is untouched: a bad outcome does not unmake history (§27).
    expect(db.rows("change_merges")[0].status).toBe("merged");
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
    expect(db.rows("operation_runs").filter((r) => r.operation_type === "change_merge")).toHaveLength(0);
  });
});

describe("a measurement cannot write history, structurally (§27, §46)", () => {
  /**
   * Asserted against the source rather than behaviourally.
   *
   * The behavioural version — mutate the step to downgrade the merge, then
   * check the merge row — is **inert under the in-memory database**, whose
   * update builder does nothing without a terminal call. A test that cannot
   * observe the mutation cannot kill it, and reporting it as killed would be
   * false confidence.
   *
   * The property that actually matters is stronger anyway and is checkable
   * exactly: this module never writes to the tables that record delivery. A
   * degraded business outcome does not unmake an approval, a merge or a
   * verified production outcome — those were true when recorded and stay true.
   */
  const source = readFileSync(
    join(process.cwd(), "src/modules/operations/business-measurement/execution.ts"),
    "utf8",
  );

  it.each([
    "change_merges",
    "change_approvals",
    "prepared_changes",
    "change_outcome_verifications",
  ])("never references the %s table at all", (table) => {
    expect(source).not.toContain(table);
  });

  it("writes only to its own measurement store and the operation store", () => {
    const imports = source.slice(0, source.indexOf("/**"));
    expect(imports).toContain("@/modules/business-measurement/store");
    expect(imports).not.toMatch(/@\/modules\/(merge|approvals|execution|outcome-verification)\/store/);
  });

  it("leaves the merge and prepared change untouched through a degraded run", async () => {
    await seedMeasurement();

    await measureBusinessOutcomeStep(
      deps(new FakeSourceRegistry([sourceWith(1000, 700)])),
      OPERATION_ID,
      AFTER_WINDOW,
    );

    expect(row().status).toBe("degraded");
    expect(db.rows("change_merges")[0].status).toBe("merged");
    expect(db.rows("change_approvals")[0].status).toBe("approved");
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
  });
});

describe("the operation converges on the measurement it produced", () => {
  it("completes pointing at the measurement row", async () => {
    await seedMeasurement();
    const dependencies = deps(new FakeSourceRegistry([sourceWith(100, 130)]));

    await measureBusinessOutcomeStep(dependencies, OPERATION_ID, AFTER_WINDOW);
    await completeMeasurementOperationStep(dependencies, OPERATION_ID);

    const operation = db.rows("operation_runs")[0];
    expect(operation.status).toBe("completed");
    expect(operation.result_id).toBe(row().id);
  });
});
