import type { FounderIntent, PrimaryGoal } from "@/modules/projects/founder-intent";
import { sourceKindsFor, metricDefinition } from "@/modules/business-measurement/metrics";
import type {
  MetricCategory,
  MetricDirection,
  MetricKey,
  MetricSourceKind,
} from "@/modules/business-measurement/schema";
import type { ExecutionCapability } from "./schema";

/**
 * Measurement contracts belong to execution capabilities (Sprint 12B §8, §9).
 *
 * Same argument as the outcome contract in Sprint 12A, one question further
 * along: the code that knows what it changed is the only code entitled to say
 * what business metric that change was supposed to move.
 *
 * The alternative — a measurement service with a switch statement over
 * capabilities, or worse a model asked "what metric should we watch?" — fails
 * in the same two ways every time. The switch rots because nobody updates it
 * when a generator changes. The model produces a plausible metric that drifts
 * with every prompt revision and cannot be tested.
 *
 * ## What never influences a plan
 *
 * **No free-form model output** (§8). A plan is a pure function of
 * `(capability, business context)`. The opportunity's *title* and *problem
 * text* are model prose and are deliberately not read — the same rule
 * `capabilities.ts` follows, for the same reason: model wording is not a
 * machine API.
 *
 * ## And what a plan must never do
 *
 * Invent a metric for a capability that has no honest one. `unsupported` is a
 * complete and useful answer; a fabricated metric produces a measurement of
 * something nobody intended to change, and it will eventually move, and
 * somebody will act on it.
 */

export type MeasurementProfile = {
  profile: string;
  profileVersion: string;
  primaryMetric: MetricKey;
  secondaryMetrics: MetricKey[];
  metricDirection: MetricDirection;
  metricCategory: MetricCategory;
  compatibleSourceKinds: MetricSourceKind[];
  baselineDays: number;
  measurementDays: number;
  /**
   * Whole days after the merge before the post-window opens (§9, §13).
   *
   * Capability-specific because "how long until this could plausibly show up"
   * is a property of what changed, not of measurement in general.
   */
  settlingDays: number;
  /** Restated on the plan so a stored plan does not depend on the registry. */
  minimumObservations: number;
  /** Why this metric, in one sentence a founder would recognise. */
  rationale: string;
};

export type MeasurementContractResolution =
  | { supported: true; profile: MeasurementProfile; businessGoal: string }
  | { supported: false; reason: string };

/**
 * The SEO capability's business measurement (§9).
 *
 * ## What robots.txt and a sitemap can and cannot do
 *
 * The **product outcome** is deterministic and immediate: the files are
 * reachable, the sitemap lists the homepage and not the login form. Sprint 12A
 * verified exactly that, in minutes.
 *
 * The **business outcome** is neither. Publishing a sitemap does not create
 * demand. What it plausibly does, over weeks, is help a crawler find and
 * re-crawl pages it was already willing to index — which shows up first in
 * impressions, then maybe in clicks, then maybe in sessions.
 *
 * So the primary metric is **search impressions**: the earliest signal in that
 * chain and the one most directly downstream of "the crawler can now see the
 * site properly". Clicks and organic sessions are recorded as secondary
 * context, never used to classify (§15).
 *
 * ## What this profile deliberately does not claim
 *
 * That robots.txt and a sitemap *should* increase impressions. They might not,
 * and a plan that encoded an expected uplift would turn every honest null
 * result into an apparent failure of the change. The plan says what to watch;
 * the classifier says what happened; neither says what should have happened
 * (§9).
 *
 * ## Why 28 days rather than 7
 *
 * Because search is slow. A crawler may take a fortnight to revisit, and a
 * seven-day window straddling a single weekend is mostly measuring the weekend.
 * A 14-day settling gap plus a 28-day window is the shortest honest answer for
 * this capability — and it is exactly why the domain had to support weeks
 * rather than assuming Sprint 12A's fifteen minutes (§31).
 */
const SEO_FOUNDATIONS_PROFILE: MeasurementProfile = {
  profile: "nextjs_seo_foundations_measurement_v1",
  profileVersion: "nextjs-seo-foundations-measurement-v1",
  primaryMetric: "search_impressions",
  secondaryMetrics: ["search_clicks", "organic_sessions"],
  metricDirection: "higher_is_better",
  metricCategory: "search_visibility",
  compatibleSourceKinds: sourceKindsFor("search_impressions"),
  baselineDays: 28,
  measurementDays: 28,
  settlingDays: 14,
  minimumObservations: metricDefinition("search_impressions").minimumObservationsPerWindow,
  rationale:
    "A sitemap and robots.txt help search engines discover and re-crawl your public pages. If that works, it shows up first as more impressions in search results — usually over weeks, not days.",
};

const CAPABILITY_MEASUREMENT_PROFILES: Record<ExecutionCapability, MeasurementProfile | null> = {
  nextjs_seo_foundations_v1: SEO_FOUNDATIONS_PROFILE,
  nextjs_seo_foundations_v2: SEO_FOUNDATIONS_PROFILE,
  /**
   * Agentic execution has no measurement profile, and this null is a real
   * answer rather than a gap.
   *
   * A profile names one metric, one direction and one settling window — facts
   * about *what a specific change does to a business*. A generator has those
   * because it always emits the same thing. The agentic capability deliberately
   * does not: it is "a bounded change to application source", and the business
   * effect of one belongs to the Action Plan step it implements, not to the
   * mechanism that implemented it.
   *
   * Attaching a profile here would mean claiming that every agent-produced
   * change moves the same metric, which is the kind of confident-sounding
   * wrong answer Sprint 8 taught this codebase to refuse. Measuring individual
   * plan steps is real work with its own contract, and it is not this sprint's.
   */
  agentic_execution_v1: null,
};

/**
 * The business goal a plan is stated against (§3).
 *
 * Taken from the project's own recorded context, so the plan reads back in the
 * founder's terms rather than in the capability's. Falls back to the
 * capability's rationale when no goal was recorded — which is honest, since the
 * metric was chosen by the capability either way.
 */
function businessGoalFor(
  profile: MeasurementProfile,
  intent: FounderIntent | null,
): string {
  const goal = intent?.primaryGoal ?? null;

  // A closed enum only. Since CORE-2 there is no free text in this layer at
  // all, so arbitrary prose can no longer reach a stored plan by construction.
  const GOAL_PHRASES: Record<PrimaryGoal, string> = {
    launch: "Reach the people looking for a product like yours",
    get_first_users: "Be findable by people searching for what you do",
    monetize: "Bring more qualified visitors to your pricing",
    improve_conversion: "Bring more qualified visitors who are ready to convert",
    improve_retention: "Be findable by the people most likely to stay",
    grow_revenue: "Grow the top of the funnel that revenue depends on",
  };

  return goal === null ? profile.rationale : GOAL_PHRASES[goal];
}

export type MeasurementContractInput = {
  capability: string;
  /** The founder's stated intent. Null when none has been saved. */
  founderIntent: FounderIntent | null;
};

export function measurementProfileForCapability(capability: string): MeasurementProfile | null {
  return CAPABILITY_MEASUREMENT_PROFILES[capability as ExecutionCapability] ?? null;
}

/**
 * The measurement plan for one capability, or a stated refusal.
 *
 * Deterministic: same capability and same context produce byte-identical
 * plans — which is what makes a stored plan meaningful rather than a snapshot
 * of whatever the code happened to do that day.
 */
export function resolveMeasurementContract(
  input: MeasurementContractInput,
): MeasurementContractResolution {
  const profile = measurementProfileForCapability(input.capability);

  if (profile === null) {
    // A complete answer, not a gap to be filled with a guess (§8).
    return {
      supported: false,
      reason: "Vibe cannot yet define a business metric for this kind of change.",
    };
  }

  return {
    supported: true,
    profile,
    businessGoal: businessGoalFor(profile, input.founderIntent),
  };
}
