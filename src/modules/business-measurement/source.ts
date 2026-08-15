import type {
  MeasurementWindow,
  MetricAggregation,
  MetricKey,
  MetricSourceKind,
} from "./schema";

/**
 * The vendor-neutral metric source boundary (Sprint 12B §6, §7, §33).
 *
 * ## What this interface is for
 *
 * So that the measurement engine can never learn a vendor's vocabulary. It asks
 * for *a metric, over a window, in a timezone*, and receives daily values. It
 * does not know — and must not be able to discover — whether those came from
 * Search Console, GA4, PostHog, Stripe, Plausible, Cloudflare or a customer's
 * own Postgres.
 *
 * Everything vendor-specific lives in an adapter behind this port: the query
 * dialect, the pagination, the sampling rules, the date semantics, the auth.
 *
 * ## Why the return type is a series and not a number
 *
 * Because the number is the *engine's* to compute, under the versioned policy.
 * An adapter that returned a pre-aggregated total would be deciding the
 * aggregation, and two adapters would eventually decide it differently — which
 * is how a comparison ends up summing one side and averaging the other.
 *
 * Daily granularity is also what makes `dataQuality` answerable at all: you
 * cannot tell that three days are missing from a single total (§17).
 *
 * ## Why failures are typed rather than thrown
 *
 * Because the four ways a source can let you down mean four different things to
 * a user — reconnect, wait, it is not covered, it is broken — and an exception
 * flattens them into one (§33).
 */

/** One day's value, in the window's timezone. */
export type MetricDataPoint = {
  /** `YYYY-MM-DD` in the requested timezone. */
  day: string;
  value: number;
  /**
   * The denominator, for rate metrics.
   *
   * A conversion rate of 5% over 20 sessions and over 20,000 sessions are not
   * the same evidence, and the rate alone cannot tell them apart. Null for
   * count metrics, where the value *is* the observation count.
   */
  sampleSize?: number;
};

export type MetricSeries = {
  metricKey: MetricKey;
  window: MeasurementWindow;
  /** One entry per day the source had data for. May be shorter than the window. */
  points: MetricDataPoint[];
  /** Which kind of source answered. Recorded as provenance (§18). */
  sourceKind: MetricSourceKind;
  /** Adapter identifier, versioned. Never a vendor account id or a secret. */
  adapter: string;
  retrievedAt: string;
};

/**
 * Typed source failures (§33).
 *
 * Each maps to a different sentence and a different next step. `unavailable`
 * and `rate_limited` are retryable; `unauthorized` needs a human; `unsupported`
 * is a coverage statement about the adapter, not an error.
 */
export type MetricSourceFailure =
  | "unauthorized"
  | "unavailable"
  | "rate_limited"
  | "metric_unsupported";

export type MetricSeriesResult =
  | { ok: true; series: MetricSeries }
  | { ok: false; error: MetricSourceFailure };

export type MetricSeriesRequest = {
  metricKey: MetricKey;
  window: MeasurementWindow;
  aggregation: MetricAggregation;
};

/**
 * One connected source, capable of answering for some metrics.
 *
 * Deliberately narrow: one method, and no way to ask it to do anything but
 * read. There is no write path, no "create goal", no "tag release" — a
 * measurement boundary that could mutate a customer's analytics account would
 * be a different and much larger trust question.
 */
export interface BusinessMetricSource {
  readonly kind: MetricSourceKind;
  /** Adapter identifier, versioned. Recorded in provenance. */
  readonly adapter: string;
  /** Which metrics this source can answer for, given how it is connected. */
  supports(metricKey: MetricKey): boolean;
  getMetricSeries(request: MetricSeriesRequest): Promise<MetricSeriesResult>;
}

/**
 * The sources connected for one project.
 *
 * ## Why an empty registry is the honest default
 *
 * Vibe Business has **no analytics connector**. Not Search Console, not GA4,
 * not PostHog — the codebase was searched before this module was written and
 * the only mention of analytics anywhere is the Business Audit correctly
 * stating that no such data is available to it.
 *
 * So this resolver returns nothing, and the product says
 * `metric_source_required` rather than inventing a connector to make a dogfood
 * look green (§7, §49). Building one is the next sprint, and when it exists it
 * registers here without any other layer changing.
 */
export interface MetricSourceRegistry {
  /** Every source connected for a project. Empty until a connector exists. */
  sourcesFor(projectId: string): Promise<BusinessMetricSource[]>;
}

/** Picks the first connected source that can answer for a metric, or null. */
export async function resolveSourceForMetric(
  registry: MetricSourceRegistry,
  params: { projectId: string; metricKey: MetricKey },
): Promise<BusinessMetricSource | null> {
  const sources = await registry.sourcesFor(params.projectId);
  return sources.find((source) => source.supports(params.metricKey)) ?? null;
}

/**
 * The registry as it stands today: nothing connected, for anybody.
 *
 * Not a stub to be filled in later with fake data — a truthful statement of the
 * current capability. A fake production connector would make every measurement
 * in the product a fabrication, which is the one thing this sprint exists to
 * prevent (§2, §49).
 */
export class NoConnectedMetricSources implements MetricSourceRegistry {
  async sourcesFor(): Promise<BusinessMetricSource[]> {
    return [];
  }
}
