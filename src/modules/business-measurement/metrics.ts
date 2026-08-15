import type {
  MetricAggregation,
  MetricCategory,
  MetricDirection,
  MetricKey,
  MetricSourceKind,
} from "./schema";

/**
 * The metric registry (Sprint 12B §4, §5, §14).
 *
 * One place that answers, for every metric Vibe knows: what kind of thing it
 * is, which way is better, how a series of daily values becomes one number,
 * which sources could supply it, and how much data a comparison needs before it
 * means anything.
 *
 * ## Why the minimums live here rather than in the classifier
 *
 * Because they are a property of the *metric*, not of the comparison. Eight
 * hundred impressions is a thin week for a search metric and an enormous one
 * for paid conversions. A single global "minimum 100 observations" would be
 * simultaneously too strict for one metric and far too loose for another —
 * and the too-loose direction is the one that produces confident nonsense.
 *
 * ## Why they are deliberately conservative
 *
 * The failure this project must not produce is a founder changing their product
 * strategy because Vibe reported an "improvement" computed from eleven
 * visitors. Refusing to answer is cheap; answering wrongly is not (§14).
 */

export type MetricDefinition = {
  key: MetricKey;
  category: MetricCategory;
  direction: MetricDirection;
  aggregation: MetricAggregation;
  /** Human label, used wherever the metric is named on screen. */
  label: string;
  /** Source kinds that could supply it. Order is preference, not availability. */
  sourceKinds: MetricSourceKind[];
  /**
   * The smallest total observation count in **each** window for a comparison to
   * be worth stating.
   *
   * Applied to both halves independently: a strong baseline against a nearly
   * empty post-window is exactly as meaningless as the reverse, and checking
   * only the total would let one side carry the other.
   */
  minimumObservationsPerWindow: number;
  /**
   * The smallest relative movement that is not noise, as a fraction (§16).
   *
   * Movement inside this band classifies as `neutral`. Without it, a metric
   * that drifts by 0.3% week to week would report an improvement or a
   * regression every single time, and the product would be a coin flip with a
   * confident voice.
   */
  neutralBand: number;
};

/**
 * Every metric V0.1 can reason about.
 *
 * A `Record` over the closed key union rather than a lookup with a default, so
 * adding a key without deciding its direction and minimums is a type error
 * rather than a metric that silently defaults to "higher is better and any
 * movement counts".
 */
export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  search_impressions: {
    key: "search_impressions",
    category: "search_visibility",
    direction: "higher_is_better",
    aggregation: "sum",
    label: "Search impressions",
    sourceKinds: ["search_console"],
    // Impressions are the highest-volume signal in the set and the noisiest
    // week to week, so the bar is a genuine week of data rather than a token.
    minimumObservationsPerWindow: 500,
    neutralBand: 0.05,
  },
  search_clicks: {
    key: "search_clicks",
    category: "search_visibility",
    direction: "higher_is_better",
    aggregation: "sum",
    label: "Organic search clicks",
    sourceKinds: ["search_console"],
    // An order of magnitude below impressions, because clicks are that much
    // rarer — but still enough that a single unusual day cannot carry it.
    minimumObservationsPerWindow: 50,
    neutralBand: 0.05,
  },
  organic_sessions: {
    key: "organic_sessions",
    category: "traffic",
    direction: "higher_is_better",
    aggregation: "sum",
    label: "Organic sessions",
    sourceKinds: ["web_analytics", "product_analytics"],
    minimumObservationsPerWindow: 100,
    neutralBand: 0.05,
  },
};

export function metricDefinition(key: MetricKey): MetricDefinition {
  return METRIC_DEFINITIONS[key];
}

export function metricLabel(key: MetricKey): string {
  return METRIC_DEFINITIONS[key].label;
}

/** Source kinds that could supply a metric. Never a specific vendor (§6). */
export function sourceKindsFor(key: MetricKey): MetricSourceKind[] {
  return METRIC_DEFINITIONS[key].sourceKinds;
}
