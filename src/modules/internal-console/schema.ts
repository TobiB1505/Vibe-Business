/**
 * What the operator console shows, as a closed vocabulary.
 *
 * The rows this module reads come from six tables with six different shapes.
 * The console renders one feed and four counters, so the shapes are normalized
 * here — once, in types — rather than in the component.
 *
 * Nothing in this file carries customer content. See `columns.ts` for the
 * reason that is a property of the queries rather than of good intentions.
 */

/** How long a window a panel covers. Two, because two questions are asked. */
export const CONSOLE_WINDOWS = ["24h", "7d"] as const;
export type ConsoleWindow = (typeof CONSOLE_WINDOWS)[number];

export const WINDOW_MS: Record<ConsoleWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * How many feed lines one refresh may carry.
 *
 * Bounded for the same reason every read in this repository is: a console that
 * fetches "everything" gets slower exactly as the system gets busier, which is
 * when it is being looked at.
 */
export const FEED_LIMIT = 80;

/** How many rows a spend or tool query may consider. */
export const SAMPLE_LIMIT = 2000;

/**
 * The severity a feed line renders as.
 *
 * Derived from the row, never stored: `failed` is bad, `needs_user` is waiting
 * on a person rather than broken, and everything else is ordinary progress.
 */
export const FEED_LEVELS = ["ok", "active", "waiting", "bad"] as const;
export type FeedLevel = (typeof FEED_LEVELS)[number];

/** One line in the terminal feed. */
export type FeedLine = {
  id: string;
  /** ISO timestamp of the most recent thing that happened to this operation. */
  at: string;
  level: FeedLevel;
  operationType: string;
  status: string;
  stage: string;
  failureCode: string | null;
  /** Truncated project id. The console never needs the whole one to be useful. */
  projectRef: string | null;
  /** Milliseconds from start to completion, or to now while it is running. */
  durationMs: number | null;
};

/** The in-flight picture: what is running right now, and what is stuck. */
export type InFlight = {
  queued: number;
  running: number;
  needsUser: number;
  /** The longest-running operation that has not finished, if there is one. */
  oldest: { operationType: string; stage: string; ageMs: number } | null;
};

/** One operation type's outcome over a window. */
export type OutcomeRow = {
  operationType: string;
  completed: number;
  failed: number;
  cancelled: number;
};

/** One failure code, and how often it happened. */
export type FailureRow = { failureCode: string; count: number };

/**
 * Money, in integer micro-USD.
 *
 * Provider costs arrive as decimal USD and get summed. Summing floats drifts,
 * and this repository already refuses to do that for Credits (`credits/units.ts`),
 * so the same discipline applies here even though nothing is charged from it.
 */
export type MicroUsd = number;

export type SpendSource = "inference" | "sandbox" | "browser";

export type SpendRow = {
  source: SpendSource;
  events: number;
  microUsd: MicroUsd;
};

/** Where projects currently stand. Counts of states, never names. */
export type FunnelRow = { state: string; count: number };

/** What the agent asked its gateway for, and what the gateway said. */
export type ToolRow = {
  tool: string;
  allowed: number;
  denied: number;
  failed: number;
};

/** Everything one refresh returns. */
export type ConsoleSnapshot = {
  /** When the server built this, so the client can show staleness honestly. */
  takenAt: string;
  window: ConsoleWindow;
  feed: readonly FeedLine[];
  inFlight: InFlight;
  outcomes: readonly OutcomeRow[];
  failures: readonly FailureRow[];
  spend: readonly SpendRow[];
  funnel: readonly FunnelRow[];
  tools: readonly ToolRow[];
  /** True when a query hit its bound, so a total is a floor rather than a total. */
  truncated: boolean;
};
