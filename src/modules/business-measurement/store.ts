import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessOutcomeMeasurement,
  DataQuality,
  MeasurementFailureCode,
  MeasurementPlan,
  MeasurementPlanStatus,
  MeasurementStatus,
  MeasurementWindow,
  MetricAggregation,
  MetricDirection,
  MetricKey,
  MetricProvenance,
  MetricSourceKind,
} from "./schema";

/**
 * Persistence for measurement plans and results (Sprint 12B §37, §38).
 *
 * ## Two clients, two very different privileges
 *
 * A plan and a measurement request run under the caller's cookie-scoped client,
 * where the insert policies independently re-verify the merge, the plan and the
 * metric. Everything that writes a *number* runs under the service-role client
 * that only durable execution holds — because there is **no update policy** on
 * either table, so an authoritative result is unreachable from a browser by
 * construction rather than by convention (§44).
 *
 * A user may ask what happened to their metric. A user may not answer.
 *
 * ## The failure class this is written against
 *
 * Sprint 10B's preview usage ledger: the external work succeeded, the
 * persistence was silently refused by RLS, and every test stayed green because
 * the tests never asked whether the row arrived. So every authoritative write
 * here returns the row it wrote, `null` means "the database did not accept
 * this", and the callers treat `null` as a failure rather than as a no-op (§38).
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

const PLAN_COLUMNS =
  "id, user_id, project_id, prepared_change_id, change_merge_id, business_goal, primary_metric, " +
  "secondary_metrics, metric_direction, metric_category, compatible_source_kinds, baseline_days, " +
  "measurement_days, settling_days, minimum_observations, measurement_profile, " +
  "measurement_profile_version, measurement_policy_version, status, unsupported_reason, " +
  "created_at, updated_at";

const MEASUREMENT_COLUMNS =
  "id, user_id, project_id, measurement_plan_id, change_merge_id, metric_key, metric_direction, " +
  "metric_aggregation, metric_source_kind, baseline_start, baseline_end, measurement_start, " +
  "measurement_end, measurement_timezone, baseline_value, observed_value, " +
  "observed_absolute_change, observed_relative_change, sample_size_before, sample_size_after, " +
  "status, data_quality, failure_code, provenance, measurement_policy_version, " +
  "measurement_profile_version, evidence_schema_version, measurement_identity, operation_run_id, " +
  "next_observation_at, started_at, completed_at, created_at, updated_at";

type Row = Record<string, unknown>;

function mapPlan(row: Row): MeasurementPlan {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    preparedChangeId: String(row.prepared_change_id),
    changeMergeId: String(row.change_merge_id),
    businessGoal: String(row.business_goal),
    primaryMetric: row.primary_metric as MetricKey,
    secondaryMetrics: (row.secondary_metrics as MetricKey[] | null) ?? [],
    metricDirection: row.metric_direction as MetricDirection,
    metricCategory: row.metric_category as MeasurementPlan["metricCategory"],
    compatibleSourceKinds: (row.compatible_source_kinds as MetricSourceKind[] | null) ?? [],
    baselineDays: Number(row.baseline_days),
    measurementDays: Number(row.measurement_days),
    settlingDays: Number(row.settling_days ?? 0),
    minimumObservations: Number(row.minimum_observations),
    measurementProfile: String(row.measurement_profile),
    measurementProfileVersion: String(row.measurement_profile_version),
    measurementPolicyVersion: String(row.measurement_policy_version),
    status: row.status as MeasurementPlanStatus,
    unsupportedReason: (row.unsupported_reason as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function windowFrom(start: unknown, end: unknown, timezone: unknown, days: number): MeasurementWindow {
  return {
    start: new Date(String(start)).toISOString(),
    end: new Date(String(end)).toISOString(),
    timezone: String(timezone),
    days,
  };
}

function dayCount(start: unknown, end: unknown): number {
  const from = Date.parse(String(start));
  const to = Date.parse(String(end));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function mapMeasurement(row: Row): BusinessOutcomeMeasurement {
  const timezone = row.measurement_timezone;

  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    measurementPlanId: String(row.measurement_plan_id),
    changeMergeId: String(row.change_merge_id),
    metricKey: row.metric_key as MetricKey,
    metricDirection: row.metric_direction as MetricDirection,
    metricAggregation: row.metric_aggregation as MetricAggregation,
    metricSourceKind: (row.metric_source_kind as MetricSourceKind | null) ?? null,
    baselineWindow: windowFrom(
      row.baseline_start,
      row.baseline_end,
      timezone,
      dayCount(row.baseline_start, row.baseline_end),
    ),
    measurementWindow: windowFrom(
      row.measurement_start,
      row.measurement_end,
      timezone,
      dayCount(row.measurement_start, row.measurement_end),
    ),
    baselineValue: (row.baseline_value as number | null) ?? null,
    observedValue: (row.observed_value as number | null) ?? null,
    observedAbsoluteChange: (row.observed_absolute_change as number | null) ?? null,
    observedRelativeChange: (row.observed_relative_change as number | null) ?? null,
    sampleSizeBefore: (row.sample_size_before as number | null) ?? null,
    sampleSizeAfter: (row.sample_size_after as number | null) ?? null,
    status: row.status as MeasurementStatus,
    dataQuality: (row.data_quality as DataQuality | null) ?? null,
    failureCode: (row.failure_code as MeasurementFailureCode | null) ?? null,
    provenance: (row.provenance as MetricProvenance[] | null) ?? [],
    measurementPolicyVersion: String(row.measurement_policy_version),
    measurementProfileVersion: String(row.measurement_profile_version),
    evidenceSchemaVersion: String(row.evidence_schema_version),
    measurementIdentity: String(row.measurement_identity),
    operationRunId: (row.operation_run_id as string | null) ?? null,
    nextObservationAt: (row.next_observation_at as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ---------------------------------------------------------------------
// Measurement plans
// ---------------------------------------------------------------------

export type CreatePlanResult =
  | { ok: true; plan: MeasurementPlan }
  | { ok: false; error: "already_exists" | "persistence_failed" };

/**
 * Records what would be measured (§3).
 *
 * Free, deterministic, and independent of whether any source is connected — a
 * project with no analytics can still be told truthfully what Vibe would watch.
 */
export async function createMeasurementPlan(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    changeMergeId: string;
    businessGoal: string;
    primaryMetric: MetricKey;
    secondaryMetrics: MetricKey[];
    metricDirection: MetricDirection;
    metricCategory: MeasurementPlan["metricCategory"];
    compatibleSourceKinds: MetricSourceKind[];
    baselineDays: number;
    measurementDays: number;
    settlingDays: number;
    minimumObservations: number;
    measurementProfile: string;
    measurementProfileVersion: string;
    measurementPolicyVersion: string;
    status: MeasurementPlanStatus;
    unsupportedReason: string | null;
  },
): Promise<CreatePlanResult> {
  const { data, error } = await supabase
    .from("measurement_plans")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      prepared_change_id: params.preparedChangeId,
      change_merge_id: params.changeMergeId,
      business_goal: params.businessGoal,
      primary_metric: params.primaryMetric,
      secondary_metrics: params.secondaryMetrics,
      metric_direction: params.metricDirection,
      metric_category: params.metricCategory,
      compatible_source_kinds: params.compatibleSourceKinds,
      baseline_days: params.baselineDays,
      measurement_days: params.measurementDays,
      settling_days: params.settlingDays,
      minimum_observations: params.minimumObservations,
      measurement_profile: params.measurementProfile,
      measurement_profile_version: params.measurementProfileVersion,
      measurement_policy_version: params.measurementPolicyVersion,
      status: params.status,
      unsupported_reason: params.unsupportedReason,
    })
    .select(PLAN_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_exists" };
    return { ok: false, error: "persistence_failed" };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, plan: mapPlan(data as unknown as Row) };
}

export async function findPlanForMerge(
  supabase: SupabaseClient,
  params: { projectId: string; changeMergeId: string },
): Promise<MeasurementPlan | null> {
  const { data, error } = await supabase
    .from("measurement_plans")
    .select(PLAN_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("change_merge_id", params.changeMergeId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapPlan(data as unknown as Row) : null;
}

/**
 * The same lookup for a whole list, in one query (VB-023).
 *
 * At most one plan per merge — the unique index on `(project_id,
 * change_merge_id)` is what makes that true — so this keys by merge id and
 * cannot lose one to another.
 */
export async function findPlansForMerges(
  supabase: SupabaseClient,
  params: { projectId: string; changeMergeIds: readonly string[] },
): Promise<Map<string, MeasurementPlan>> {
  const ids = [...new Set(params.changeMergeIds)];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("measurement_plans")
    .select(PLAN_COLUMNS)
    .eq("project_id", params.projectId)
    .in("change_merge_id", ids);

  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => {
      const plan = mapPlan(row as unknown as Row);
      return [plan.changeMergeId, plan];
    }),
  );
}

export async function findPlanForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<MeasurementPlan | null> {
  const { data, error } = await supabase
    .from("measurement_plans")
    .select(PLAN_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("prepared_change_id", params.preparedChangeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapPlan(data as unknown as Row) : null;
}

// ---------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------

export type CreateMeasurementResult =
  | { ok: true; measurement: BusinessOutcomeMeasurement }
  | { ok: false; error: "already_exists" | "persistence_failed" };

/**
 * Records a requested measurement, with both windows already fixed (§42).
 *
 * The windows are written here and never recomputed. A baseline re-derived at
 * comparison time would change a historical result as the calendar advances,
 * which is the single most misleading thing this table could do.
 */
export async function createMeasurement(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    measurementPlanId: string;
    changeMergeId: string;
    metricKey: MetricKey;
    metricDirection: MetricDirection;
    metricAggregation: MetricAggregation;
    baselineWindow: MeasurementWindow;
    measurementWindow: MeasurementWindow;
    status: Extract<MeasurementStatus, "waiting_for_source" | "waiting_for_window">;
    measurementPolicyVersion: string;
    measurementProfileVersion: string;
    evidenceSchemaVersion: string;
    measurementIdentity: string;
    operationRunId: string | null;
    nextObservationAt: string | null;
  },
): Promise<CreateMeasurementResult> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      measurement_plan_id: params.measurementPlanId,
      change_merge_id: params.changeMergeId,
      metric_key: params.metricKey,
      metric_direction: params.metricDirection,
      metric_aggregation: params.metricAggregation,
      baseline_start: params.baselineWindow.start,
      baseline_end: params.baselineWindow.end,
      measurement_start: params.measurementWindow.start,
      measurement_end: params.measurementWindow.end,
      measurement_timezone: params.baselineWindow.timezone,
      status: params.status,
      measurement_policy_version: params.measurementPolicyVersion,
      measurement_profile_version: params.measurementProfileVersion,
      evidence_schema_version: params.evidenceSchemaVersion,
      measurement_identity: params.measurementIdentity,
      operation_run_id: params.operationRunId,
      next_observation_at: params.nextObservationAt,
      provenance: [],
    })
    .select(MEASUREMENT_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_exists" };
    return { ok: false, error: "persistence_failed" };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, measurement: mapMeasurement(data as unknown as Row) };
}

/**
 * The measurement for one exact question, in any state except a Vibe-side
 * failure (§35).
 *
 * The authority lookup — "has this already been measured?" — matched by
 * identity, never by "the latest measurement for this merge".
 */
export async function findMeasurementByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; measurementIdentity: string },
): Promise<BusinessOutcomeMeasurement | null> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .select(MEASUREMENT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("measurement_identity", params.measurementIdentity)
    .in("status", [
      "waiting_for_source",
      "waiting_for_window",
      "measuring",
      "improved",
      "degraded",
      "neutral",
      "insufficient_data",
    ])
    .maybeSingle();

  if (error) throw error;
  return data ? mapMeasurement(data as unknown as Row) : null;
}

/** A **display** question, never an authority one. */
export async function getLatestMeasurementForPlan(
  supabase: SupabaseClient,
  params: { projectId: string; measurementPlanId: string },
): Promise<BusinessOutcomeMeasurement | null> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .select(MEASUREMENT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("measurement_plan_id", params.measurementPlanId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapMeasurement(data as unknown as Row) : null;
}

/**
 * The newest measurement for each of several plans, in one query (VB-023).
 *
 * Ordered newest-first and grouped here, for the same reason
 * `readLatestPerPreparedChange` does it that way: PostgREST has no
 * `distinct on`, and the first row seen for a plan is that plan's latest.
 *
 * The budget is the plan count rather than a constant, because measurements
 * accumulate per plan over a project's life and a fixed ceiling would start
 * hiding older plans as they do. Any plan the batch could not resolve is
 * re-read on its own.
 */
export async function getLatestMeasurementsForPlans(
  supabase: SupabaseClient,
  params: { projectId: string; measurementPlanIds: readonly string[] },
): Promise<Map<string, BusinessOutcomeMeasurement>> {
  const ids = [...new Set(params.measurementPlanIds)];
  const latest = new Map<string, BusinessOutcomeMeasurement>();
  if (ids.length === 0) return latest;

  const budget = ids.length * 10;

  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .select(MEASUREMENT_COLUMNS)
    .eq("project_id", params.projectId)
    .in("measurement_plan_id", ids)
    .order("created_at", { ascending: false })
    .limit(budget);

  if (error) throw error;

  const rows = data ?? [];
  for (const row of rows) {
    const measurement = mapMeasurement(row as unknown as Row);
    if (!latest.has(measurement.measurementPlanId)) {
      latest.set(measurement.measurementPlanId, measurement);
    }
  }

  if (rows.length < budget) return latest;

  for (const id of ids.filter((planId) => !latest.has(planId))) {
    const single = await getLatestMeasurementForPlan(supabase, {
      projectId: params.projectId,
      measurementPlanId: id,
    });
    if (single) latest.set(id, single);
  }

  return latest;
}

/** The measurement a workflow step owns. Ownership comes from the operation. */
export async function findMeasurementByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<BusinessOutcomeMeasurement | null> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .select(MEASUREMENT_COLUMNS)
    .eq("operation_run_id", operationRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapMeasurement(data as unknown as Row) : null;
}

/** Marks collection as under way. Conditional, so a replay does not restart it. */
export async function markMeasuring(
  supabase: SupabaseClient,
  params: { measurementId: string; projectId: string; sourceKind: MetricSourceKind },
): Promise<BusinessOutcomeMeasurement | null> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .update({
      status: "measuring",
      metric_source_kind: params.sourceKind,
      started_at: new Date().toISOString(),
    })
    .eq("id", params.measurementId)
    .eq("project_id", params.projectId)
    .in("status", ["waiting_for_source", "waiting_for_window", "measuring"])
    .select(MEASUREMENT_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapMeasurement(data as unknown as Row) : null;
}

/**
 * Records the terminal observed result (§16, §24, §25, §26).
 *
 * `improved`, `degraded`, `neutral` and `insufficient_data` all come through
 * here, because all four are statements about data that was actually collected,
 * and all four must carry the numbers behind them — the database refuses them
 * otherwise.
 */
export async function completeMeasurement(
  supabase: SupabaseClient,
  params: {
    measurementId: string;
    projectId: string;
    status: Extract<
      MeasurementStatus,
      "improved" | "degraded" | "neutral" | "insufficient_data"
    >;
    baselineValue: number | null;
    observedValue: number | null;
    observedAbsoluteChange: number | null;
    observedRelativeChange: number | null;
    sampleSizeBefore: number;
    sampleSizeAfter: number;
    dataQuality: DataQuality;
    provenance: MetricProvenance[];
  },
): Promise<BusinessOutcomeMeasurement | null> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .update({
      status: params.status,
      baseline_value: params.baselineValue,
      observed_value: params.observedValue,
      observed_absolute_change: params.observedAbsoluteChange,
      observed_relative_change: params.observedRelativeChange,
      sample_size_before: params.sampleSizeBefore,
      sample_size_after: params.sampleSizeAfter,
      data_quality: params.dataQuality,
      provenance: params.provenance,
      failure_code: null,
      next_observation_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.measurementId)
    .eq("project_id", params.projectId)
    // Only while still in flight. A terminal measurement is immutable: a late
    // or replayed step must never rewrite a result the user has been shown, and
    // a re-collection over the same windows would produce a *different* number
    // as the source backfills (§12).
    .in("status", ["waiting_for_source", "waiting_for_window", "measuring"])
    .select(MEASUREMENT_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapMeasurement(data as unknown as Row) : null;
}

/**
 * Records that Vibe could not measure (§33).
 *
 * Structurally separate from `completeMeasurement`, because "the metric did not
 * move" and "Vibe could not read the metric" are different claims and a shared
 * code path is how they eventually become one.
 */
export async function failMeasurement(
  supabase: SupabaseClient,
  params: {
    measurementId: string;
    projectId: string;
    failureCode: MeasurementFailureCode;
    /** Set when retrying later is the honest next step (§33). */
    nextObservationAt?: string | null;
  },
): Promise<BusinessOutcomeMeasurement | null> {
  const { data, error } = await supabase
    .from("business_outcome_measurements")
    .update({
      status: "failed",
      failure_code: params.failureCode,
      next_observation_at: params.nextObservationAt ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.measurementId)
    .eq("project_id", params.projectId)
    .in("status", ["waiting_for_source", "waiting_for_window", "measuring"])
    .select(MEASUREMENT_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapMeasurement(data as unknown as Row) : null;
}
