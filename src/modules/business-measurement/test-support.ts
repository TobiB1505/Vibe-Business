import { FakeDatabase } from "@/modules/operations/test-support";
import type {
  BusinessMetricSource,
  MetricSeriesRequest,
  MetricSeriesResult,
  MetricSourceFailure,
  MetricSourceRegistry,
} from "./source";
import type { MeasurementWindow, MetricKey, MetricSourceKind } from "./schema";

/**
 * Test doubles for business measurement (Sprint 12B §41, §44, §45).
 *
 * ## What is modelled honestly rather than approximately
 *
 * **Calls are counted.** "Rendering the page makes zero provider calls" and
 * "a measurement that is not due queries nothing" are properties this sprint
 * rests on, and a double that cannot count cannot prove either (§45).
 *
 * **Failures are the real typed ones.** A source that could only succeed or
 * throw would make the four-way distinction in §33 untestable, and that
 * distinction is the difference between "reconnect", "wait", "not covered" and
 * "this is broken".
 *
 * Nothing here contacts a vendor.
 */

export const MEASUREMENT_FIXTURES = {
  project: "project_measure",
  user: "user_measure",
  preparedChange: "prepared_measure",
  approval: "approval_measure",
  merge: "merge_measure",
  snapshot: "snapshot_measure",
} as const;

export const MEASURED_COMMIT = "e".repeat(40);
/** The merge instant every fixture window is anchored on. */
export const MERGED_AT = "2026-08-14T14:40:56.438Z";

export type FakeSourceOptions = {
  kind?: MetricSourceKind;
  adapter?: string;
  /** Metrics this source can answer for. Defaults to search metrics. */
  supported?: MetricKey[];
  /** Daily values per window start, keyed by the window's ISO start. */
  seriesByWindowStart?: Record<string, number[]>;
  /** Denominators for rate metrics, keyed the same way. */
  sampleSizesByWindowStart?: Record<string, number[]>;
  /** When set, every request fails this way instead. */
  failWith?: MetricSourceFailure;
  /**
   * Fails only the window starting at this instant.
   *
   * The realistic shape of a source failure: the baseline is history and comes
   * back instantly, while the post-change window is the recent data a provider
   * is slowest to settle and likeliest to rate-limit. A double that could only
   * fail *both* reads would leave the more common half untested.
   */
  failWindowStart?: string;
};

/**
 * One connected source, with scripted daily values.
 *
 * Values are supplied per window rather than as one list, so a test can give
 * the baseline and the post-change window genuinely different data — which is
 * the entire point of the comparison and impossible to express with a single
 * series.
 */
export class FakeMetricSource implements BusinessMetricSource {
  readonly requests: MetricSeriesRequest[] = [];

  constructor(private readonly options: FakeSourceOptions = {}) {}

  get kind(): MetricSourceKind {
    return this.options.kind ?? "search_console";
  }

  get adapter(): string {
    return this.options.adapter ?? "fake_search_console_v1";
  }

  supports(metricKey: MetricKey): boolean {
    const supported = this.options.supported ?? ["search_impressions", "search_clicks"];
    return supported.includes(metricKey);
  }

  async getMetricSeries(request: MetricSeriesRequest): Promise<MetricSeriesResult> {
    this.requests.push(request);

    const failsThisWindow =
      this.options.failWindowStart === undefined ||
      this.options.failWindowStart === request.window.start;

    if (this.options.failWith && failsThisWindow) {
      return { ok: false, error: this.options.failWith };
    }

    const values = this.options.seriesByWindowStart?.[request.window.start] ?? [];
    const samples = this.options.sampleSizesByWindowStart?.[request.window.start];

    return {
      ok: true,
      series: {
        metricKey: request.metricKey,
        window: request.window,
        points: values.map((value, index) => ({
          day: dayOffset(request.window, index),
          value,
          ...(samples ? { sampleSize: samples[index] } : {}),
        })),
        sourceKind: this.kind,
        adapter: this.adapter,
        retrievedAt: "2026-09-26T00:00:05.000Z",
      },
    };
  }
}

function dayOffset(window: MeasurementWindow, index: number): string {
  const start = Date.parse(window.start);
  return new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A registry with the given sources, counting how often it is consulted. */
export class FakeSourceRegistry implements MetricSourceRegistry {
  lookups = 0;

  constructor(private readonly sources: BusinessMetricSource[] = []) {}

  async sourcesFor(): Promise<BusinessMetricSource[]> {
    this.lookups += 1;
    return this.sources;
  }
}

/** A series of `days` identical values, for tests about volume rather than shape. */
export function flatSeries(days: number, perDay: number): number[] {
  return Array.from({ length: days }, () => perDay);
}

export type SeedMergedOptions = {
  capability?: string;
  mergeStatus?: "merged" | "blocked" | "failed";
  mergedAt?: string;
  primaryGoal?: string | null;
  /** False models a project with no recorded business context. */
  withContext?: boolean;
};

/**
 * A project whose SEO change was merged — the baseline every plan test starts
 * from, so a refusal is always attributable to the fact that was removed.
 */
export function seedMergedForMeasurement(
  db: FakeDatabase,
  options: SeedMergedOptions = {},
): void {
  const status = options.mergeStatus ?? "merged";

  db.seed("projects", {
    id: MEASUREMENT_FIXTURES.project,
    user_id: MEASUREMENT_FIXTURES.user,
    production_url: "https://product.test/",
  });

  if (options.withContext !== false) {
    db.seed("project_business_context", {
      project_id: MEASUREMENT_FIXTURES.project,
      product_summary: "A business layer for AI-built products, for solo founders.",
      target_customer: "Solo founders shipping with AI tools",
      stage: "active_users",
      monetization_model: "subscription",
      primary_goal: options.primaryGoal === undefined ? "get_first_users" : options.primaryGoal,
      context_hash: "c".repeat(64),
      updated_at: "2026-08-10T00:00:00.000Z",
    });
  }

  db.seed("prepared_changes", {
    id: MEASUREMENT_FIXTURES.preparedChange,
    project_id: MEASUREMENT_FIXTURES.project,
    user_id: MEASUREMENT_FIXTURES.user,
    status: "prepared",
    execution_capability: options.capability ?? "nextjs_seo_foundations_v2",
    execution_version: "nextjs-seo-foundations-v2",
    repository_snapshot_id: MEASUREMENT_FIXTURES.snapshot,
    commit_sha: MEASURED_COMMIT,
    base_sha: "b".repeat(40),
    base_branch: "main",
    branch_name: "vibe/seo-foundations",
    files: [{ path: "src/app/sitemap.ts", contentHash: "a".repeat(64), bytes: 512 }],
  });

  db.seed("change_approvals", {
    id: MEASUREMENT_FIXTURES.approval,
    project_id: MEASUREMENT_FIXTURES.project,
    user_id: MEASUREMENT_FIXTURES.user,
    prepared_change_id: MEASUREMENT_FIXTURES.preparedChange,
    prepared_commit_sha: MEASURED_COMMIT,
    prepared_base_sha: "b".repeat(40),
    status: "approved",
  });

  db.seed("change_merges", {
    id: MEASUREMENT_FIXTURES.merge,
    project_id: MEASUREMENT_FIXTURES.project,
    user_id: MEASUREMENT_FIXTURES.user,
    prepared_change_id: MEASUREMENT_FIXTURES.preparedChange,
    change_approval_id: MEASUREMENT_FIXTURES.approval,
    repository_connection_id: "connection_measure",
    prepared_commit_sha: MEASURED_COMMIT,
    prepared_base_sha: "b".repeat(40),
    default_branch: "main",
    observed_default_head_before: "b".repeat(40),
    merge_policy_version: "merge-policy-v1",
    merge_strategy: "fast_forward_exact_commit",
    merge_identity: "m".repeat(64),
    status,
    resulting_default_head_sha: status === "merged" ? MEASURED_COMMIT : null,
    merged_at: status === "merged" ? (options.mergedAt ?? MERGED_AT) : null,
    created_at: "2026-08-14T14:40:46.000Z",
  });
}

export { FakeDatabase };
