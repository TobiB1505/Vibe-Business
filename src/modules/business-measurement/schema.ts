/**
 * The business outcome measurement domain (Sprint 12B §1, §2, §10, §15).
 *
 * ## The third question, and why it is the hardest
 *
 * ```
 * DELIVERY          did the approved change reach the repository?   Sprint 11C
 * PRODUCT OUTCOME   did the intended behaviour appear publicly?     Sprint 12A
 * BUSINESS OUTCOME  did the metric it was meant to move, move?      ← here
 * ```
 *
 * The first two are answerable by observation: a branch points at a commit, a
 * file is reachable. This one is not. It needs somebody else's data, a defined
 * baseline, a defined window, enough traffic for the comparison to mean
 * anything, and — for the question people actually want answered — a controlled
 * experiment this product does not run.
 *
 * So the whole module is built around what it is *not* allowed to say.
 *
 * ## Business impact is never inferred (§2)
 *
 * Not from a merge, not from a passing build, not from a reachable
 * `robots.txt`, not from a nicer-looking page, and not from a model's opinion
 * that the change was a good idea. Business outcome requires metric evidence.
 *
 * **No evidence is `insufficient_data`, never `neutral` and never `improved`.**
 * The absence of measurement is not a measurement.
 *
 * ## Observed change is not caused change (§10)
 *
 * If conversion moves 4.1% → 4.5% after a merge, the honest sentence is
 * *"conversion increased during the post-change measurement window"*. The
 * sentence *"this change caused a 9.8% increase"* requires a control group,
 * and there isn't one. Everything in this domain is named `observed…` for that
 * reason, and `causality.ts` exists to keep it that way.
 */

/**
 * What a stored measurement was computed under (§12).
 *
 * Versions the *rules*, not the numbers: baseline construction, post-window
 * construction, minimum-sample requirements, timezone handling, aggregation,
 * comparison and the tolerance band.
 *
 * Change any of those and a stored `improved` would come to mean something it
 * was never computed under — so the version is part of the measurement's
 * identity, and historical rows are never silently recalculated (§12).
 */
export const MEASUREMENT_POLICY_VERSION = "measurement-policy-v1" as const;

/** The shape of the persisted JSONB provenance (§18, §37). */
export const MEASUREMENT_EVIDENCE_SCHEMA_VERSION = "measurement-evidence-v1" as const;

/**
 * The metric categories V0.1 can represent (§4).
 *
 * Deliberately small. A vocabulary of forty metrics nobody can measure is
 * worse than a vocabulary of eight that maps onto real sources, because it
 * invites plans that can never be executed.
 */
export const METRIC_CATEGORIES = [
  "traffic",
  "conversion",
  "activation",
  "revenue",
  "retention",
  "search_visibility",
] as const;
export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

/**
 * What "better" means for a metric (§5).
 *
 * Not every metric should go up. Bounce rate going down is good; conversion
 * rate going down is not. A classifier that assumed one direction would report
 * an improvement as a regression for half the vocabulary.
 *
 * `target_range` is declared and deliberately **not implemented**. No metric in
 * the V0.1 vocabulary has a target band, and the plumbing to carry one would be
 * speculative. It exists in the union so that a future metric declaring it
 * cannot be silently misclassified as `higher_is_better` — `classify.ts`
 * refuses it with a typed reason instead (§5, CLAUDE.md rule 15).
 */
export const METRIC_DIRECTIONS = ["higher_is_better", "lower_is_better", "target_range"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

/**
 * How a series of daily values becomes one comparable number (§12).
 *
 * Part of the policy rather than a per-call option: comparing a *sum* before
 * against a *mean* after is a mistake that produces a large, confident and
 * entirely fictional change.
 */
export const METRIC_AGGREGATIONS = ["sum", "mean", "rate"] as const;
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

/**
 * The metric keys V0.1 knows how to reason about (§4).
 *
 * Only what a current or immediately-foreseeable capability needs. Adding a key
 * is a deliberate act that must also state its category, direction, aggregation
 * and minimum-sample shape — see `metrics.ts`.
 */
export const METRIC_KEYS = [
  /** Search Console: how often the site appeared in results. */
  "search_impressions",
  /** Search Console: how often somebody clicked through. */
  "search_clicks",
  /** Web analytics: sessions attributed to organic search. */
  "organic_sessions",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * Kinds of metric source, vendor-neutral (§6).
 *
 * The *kind* is domain vocabulary; a *connection* names a specific vendor and
 * lives behind an adapter. The measurement engine only ever sees the kind, so
 * it cannot grow provider-specific behaviour by accident.
 */
export const METRIC_SOURCE_KINDS = [
  "search_console",
  "web_analytics",
  "product_analytics",
  "billing",
  "first_party",
] as const;
export type MetricSourceKind = (typeof METRIC_SOURCE_KINDS)[number];

/**
 * MeasurementPlan lifecycle (§3, §8).
 *
 * A plan is *what we would measure*, decided deterministically from the
 * capability, the opportunity and the business context. It is not a
 * measurement, and it costs nothing to produce.
 */
export const MEASUREMENT_PLAN_STATUSES = [
  /** Vibe knows what it would measure and could measure it if a source existed. */
  "ready",
  /**
   * The capability has no meaningful business metric Vibe can name.
   *
   * Stated rather than invented. A plan that made one up would produce a
   * measurement of something nobody intended to change (§8).
   */
  "unsupported",
] as const;
export type MeasurementPlanStatus = (typeof MEASUREMENT_PLAN_STATUSES)[number];

/**
 * BusinessOutcomeMeasurement lifecycle (§15, §20).
 *
 * Five of these are *states of the world*, not failures — and the product must
 * render them as five different sentences:
 *
 * ```
 * waiting_for_source   nobody has connected the data              (not a result)
 * waiting_for_window   the post-change period has not elapsed     (not a result)
 * measuring            collecting                                 (not a result)
 * improved / degraded / neutral                                   (results)
 * insufficient_data    there was data, and not enough of it       (an honest non-result)
 * failed               Vibe could not measure                     (about Vibe)
 * ```
 *
 * `insufficient_data` and `failed` are the two that most invite a wrong word.
 * Neither is "no impact", and the UI is forbidden from rendering them that way
 * (§21, §26).
 */
export const MEASUREMENT_STATUSES = [
  "waiting_for_source",
  "waiting_for_window",
  "measuring",
  "improved",
  "degraded",
  "neutral",
  "insufficient_data",
  "failed",
] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

/** Statuses that are a settled answer about the business metric. */
export function isMeasurementTerminal(status: MeasurementStatus): boolean {
  return (
    status === "improved" ||
    status === "degraded" ||
    status === "neutral" ||
    status === "insufficient_data" ||
    status === "failed"
  );
}

/** True for the three statuses that state a direction of movement. */
export function isMeasurementResult(status: MeasurementStatus): boolean {
  return status === "improved" || status === "degraded" || status === "neutral";
}

/**
 * How complete the underlying data was (§17).
 *
 * Persisted rather than derived at read time, because it qualifies the result
 * permanently. A comparison built on half a window is not a normal comparison,
 * and a reader two months later has no other way to know.
 */
export const DATA_QUALITY = ["complete", "partial", "insufficient", "source_error"] as const;
export type DataQuality = (typeof DATA_QUALITY)[number];

/**
 * Every way measurement can refuse or fail (§33).
 *
 * Split deliberately along the axis that decides what a user can do about it:
 * a missing connection is a setup problem, an expired authorization is a
 * reconnect, a rate limit is a wait, and an unavailable metric is a coverage
 * gap. Collapsing them all into `failed` would make every one of them look like
 * a Vibe bug.
 */
export const MEASUREMENT_FAILURE_CODES = [
  /** No compatible metric source is connected for this project (§20, §21). */
  "metric_source_required",
  /** A source exists but does not provide the metric the plan names. */
  "metric_unavailable",
  /** The connection's authorization is no longer valid. Reconnect. */
  "metric_source_unauthorized",
  /** The source could not be reached. Retryable. */
  "metric_source_unavailable",
  /** The source asked us to slow down. Retryable. */
  "metric_source_rate_limited",
  /** The capability has no business metric Vibe can name (§8). */
  "measurement_not_defined",
  /** The change was never merged, so there is nothing to measure against. */
  "measurement_merge_required",
  /** The direction is declared but not implemented — never guessed (§5). */
  "measurement_direction_unsupported",
  /** The caller does not hold measurement authority over this project. */
  "measurement_not_authorized",
  /** The durable operation could not be enqueued. */
  "measurement_execution_start_failed",
  "measurement_persistence_failed",
  "measurement_failed",
] as const;
export type MeasurementFailureCode = (typeof MEASUREMENT_FAILURE_CODES)[number];

/** Failure codes where reconnecting or waiting is the honest next step (§33). */
export function isRecoverableMeasurementFailure(code: MeasurementFailureCode): boolean {
  return (
    code === "metric_source_unavailable" ||
    code === "metric_source_rate_limited" ||
    code === "metric_source_unauthorized"
  );
}

/**
 * One explicit, closed time window (§11, §13, §32).
 *
 * Both bounds and the timezone travel together, always. A window without its
 * timezone is not a window — "7 days before the merge" means different data in
 * `America/Los_Angeles` than in `Europe/Berlin`, and the difference is largest
 * exactly where traffic is.
 */
export type MeasurementWindow = {
  /** Inclusive start, ISO 8601 instant. */
  start: string;
  /** Exclusive end, ISO 8601 instant. */
  end: string;
  /** IANA zone the calendar days were computed in. Never implicit (§32). */
  timezone: string;
  /** Whole calendar days covered. */
  days: number;
};

/**
 * What would be measured, and how (§3).
 *
 * Deterministically derived — from the execution capability, the opportunity it
 * addressed and the project's business context. Never from free-form model
 * output (§8).
 */
export type MeasurementPlan = {
  id: string;
  projectId: string;
  userId: string;

  preparedChangeId: string;
  changeMergeId: string;

  /** The business goal this change was meant to serve, in the project's own words. */
  businessGoal: string;
  /** The one metric the result is stated in terms of. */
  primaryMetric: MetricKey;
  /** Context metrics, recorded but never used to classify the result. */
  secondaryMetrics: MetricKey[];
  metricDirection: MetricDirection;
  metricCategory: MetricCategory;
  /** Which kinds of source could supply the primary metric. */
  compatibleSourceKinds: MetricSourceKind[];

  baselineDays: number;
  measurementDays: number;
  /** How long after the merge the post-change window opens (§13). */
  settlingDays: number;
  minimumObservations: number;

  measurementProfile: string;
  measurementProfileVersion: string;
  measurementPolicyVersion: string;

  status: MeasurementPlanStatus;
  /** Present only when `unsupported`. */
  unsupportedReason: string | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * Where an observed value came from (§18).
 *
 * Enough to answer *"where did this number come from?"* two months later, and
 * deliberately nothing more. **No OAuth token, no refresh token, no API key, no
 * raw provider payload** — a provenance record is not a credential store, and
 * an analytics response can contain per-user data that has no business in this
 * table.
 */
export type MetricProvenance = {
  sourceKind: MetricSourceKind;
  /** Opaque connection id. Never a secret, never a vendor account identifier. */
  connectionId: string | null;
  /** Adapter identifier, e.g. `search_console_v1`. Versioned like everything else. */
  adapter: string;
  metricKey: MetricKey;
  aggregation: MetricAggregation;
  window: MeasurementWindow;
  /** Days the source actually returned, which may be fewer than the window (§17). */
  daysReturned: number;
  retrievedAt: string;
};

/**
 * One measurement of one metric across one baseline/post pair (§15).
 *
 * Immutable once terminal. A measurement is a statement about a period that has
 * already happened, and recomputing it later under different rules would make
 * every historical record unreadable (§12).
 */
export type BusinessOutcomeMeasurement = {
  id: string;
  projectId: string;
  userId: string;

  measurementPlanId: string;
  changeMergeId: string;

  metricKey: MetricKey;
  metricDirection: MetricDirection;
  metricAggregation: MetricAggregation;

  /** Null until a source is connected and selected. */
  metricSourceKind: MetricSourceKind | null;

  baselineWindow: MeasurementWindow;
  measurementWindow: MeasurementWindow;

  /** Null until collected. Never defaulted to zero — absent is not zero. */
  baselineValue: number | null;
  observedValue: number | null;
  /**
   * `observedValue - baselineValue`, and named `observed` throughout.
   *
   * Never `impact`, never `uplift`, never `causedChange`. The name is the
   * safeguard (§10).
   */
  observedAbsoluteChange: number | null;
  observedRelativeChange: number | null;

  sampleSizeBefore: number | null;
  sampleSizeAfter: number | null;

  status: MeasurementStatus;
  dataQuality: DataQuality | null;
  failureCode: MeasurementFailureCode | null;

  /** Provenance for both halves. Empty until something was retrieved (§18). */
  provenance: MetricProvenance[];

  measurementPolicyVersion: string;
  measurementProfileVersion: string;
  evidenceSchemaVersion: string;

  measurementIdentity: string;
  operationRunId: string | null;

  /**
   * When this measurement next becomes actionable (§30, §31).
   *
   * The scheduling contract, expressed as data rather than as a running
   * process. A measurement is *due* when this instant has passed; whatever
   * eventually resumes due measurements — a visit, an explicit action, or a
   * scheduled runner that does not exist yet — reads this column rather than
   * knowing anything about windows.
   */
  nextObservationAt: string | null;

  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * **A measurement never rewrites delivery or product outcome** (§27).
 *
 * Named as a function so the rule lives in code rather than only in prose.
 *
 * A degraded business outcome does not unmake an approval, a merge, or a
 * verified production outcome. Those were true when they were recorded and stay
 * true. The four coexist:
 *
 * ```
 * Approved              ✅
 * Merged                ✅
 * Production outcome    ✅
 * Business impact       ↓ degraded
 * ```
 *
 * A product that hid the first three because the fourth was bad would be
 * hiding the evidence a person needs in order to decide what to do about it.
 */
export function measurementNeverRewritesHistory(): true {
  return true;
}
