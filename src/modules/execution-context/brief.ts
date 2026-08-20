/**
 * What Vibe already knows that bears on *this* step (EXECUTION CONTEXT INTELLIGENCE).
 *
 * ## The problem this exists for
 *
 * Run #3 succeeded and spent eight minutes forty-four seconds, twenty-one
 * provider calls and $0.3465 to change two files by sixteen lines. Almost all of
 * it went on rediscovery: fourteen file reads and ten commands establishing a
 * repository layout Vibe had already analysed, stored and versioned before the
 * run started.
 *
 * The agent was sent into a repository it was told nothing about, because the
 * only repository facts in its prompt were a framework list, a package manager
 * and a commit SHA. Everything else it had to find.
 *
 * ## The principle
 *
 * > Verify relevant facts. Do not broadly rediscover.
 *
 * A brief is not a substitute for the repository — the agent still reads, and it
 * still works against the pinned commit. It is a starting point with provenance:
 * every fact carries where it came from, which file proves it, at which
 * revision, and how strongly it is grounded. A fact that turns out to be wrong
 * is a reason to look further; a fact that is right saves a turn.
 *
 * ## Why it is data, never instruction (Rule 25, Rule 42)
 *
 * Every value in a brief is derived from a customer's repository, their action
 * plan, or their own recorded answers. None of it was authored by Vibe. It is
 * therefore rendered inside labelled untrusted fences at the agent boundary, and
 * it cannot reach the system prompt — the same rule the Planner's prose already
 * lives under, applied to a richer payload.
 *
 * The structure enforces it as well as the rendering does: a fact is a typed
 * subject/value pair with a bounded string, not a paragraph, so there is no
 * field a directive could arrive in intact.
 */

import type { ExecutionSurfaceRequirement } from "./surface";

/**
 * How strongly a fact is grounded.
 *
 * The repository analyzer's own vocabulary, reused rather than reinvented. It is
 * categorical because the analyzer's is: inventing a numeric score would put a
 * precision on these that nothing in the pipeline measures.
 */
export const FACT_CONFIDENCE = ["high", "medium", "low"] as const;
export type FactConfidence = (typeof FACT_CONFIDENCE)[number];

/**
 * Which part of Vibe established a fact.
 *
 * The plan's own prose — the objective, the customer's approved decisions, the
 * assumptions — is deliberately not a source here. It is already carried into
 * the prompt verbatim from the immutable spec, and a bounded second copy inside
 * a brief would be the duplicate source of truth this sprint set out to avoid.
 * Those words *are* read by the compiler, as a signal for what is relevant.
 */
export const FACT_SOURCES = [
  "repository_scan",
  "product_profile",
  "live_product_scan",
  "execution_spec",
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/**
 * What a fact is *about*.
 *
 * A closed vocabulary rather than free text, for the same reason the event log's
 * `type` is closed: an open subject field is a free-text field, and free text is
 * where a directive would arrive. It also makes a brief queryable — "which runs
 * were told the auth boundary" is a filter, not a grep.
 */
export const FACT_SUBJECTS = [
  "framework",
  "router",
  "runtime",
  "package_manager",
  "check_command",
  "public_surface",
  "authenticated_surface",
  "auth_boundary",
  "route_group",
  "api_location",
  "business_surface",
  "product_capability",
  /**
   * The surface the step's own cited evidence says the work lands on.
   *
   * Distinct from `public_surface`, which lists what the repository has.
   * This one says which of it *this step applies to*, and it exists only when
   * a trusted `ExecutionSurfaceRequirement` resolved to something.
   */
  "execution_surface",
] as const;
export type FactSubject = (typeof FACT_SUBJECTS)[number];

/** Bytes any single string in a brief may occupy. */
export const MAX_FACT_VALUE = 200;

/** Repository paths are data too, and a repository chooses how long they are. */
export const MAX_BRIEF_PATH = 200;

export type FactEvidence = {
  /** Repository-relative path that proves it. Never file content. */
  path: string;
  /** The commit the evidence was read at. Absent for a non-repository source. */
  revision?: string;
};

export type ContextFact = {
  subject: FactSubject;
  /** Bounded, single-line, and never a sentence a model could act on. */
  value: string;
  source: FactSource;
  confidence: FactConfidence;
  evidence: readonly FactEvidence[];
};

/**
 * Why a file is worth looking at first.
 *
 * Three, because three are what Vibe can currently derive from stored
 * intelligence. A `framework_convention` reason would need a surface→path table
 * — "robots lives at app/robots.ts" — which is exactly the hardcoding this
 * sprint is supposed to avoid; where a file *should* go is expressed instead as
 * a `router` fact naming the directory this repository's own route files were
 * observed in. A `previously_changed` reason would need execution history,
 * which nothing reads yet.
 */
export const CANDIDATE_REASONS = [
  "business_surface_evidence",
  "route_source",
  "layout",
  /**
   * A page in the surface the step's cited evidence resolved to.
   *
   * The reason run #7 had to find seven files itself. It is derived from
   * `evidenceIds` through route intelligence (`surface.ts`), never from the
   * step's words — which is what makes it work identically for canonical URLs,
   * CTA copy and analytics attribution.
   */
  "public_page_surface",
  "authenticated_page_surface",
] as const;
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];

export type FileCandidate = {
  path: string;
  reason: CandidateReason;
  confidence: FactConfidence;
  /** What this file is believed to govern, e.g. a route path. Bounded. */
  note: string | null;
};

/**
 * Whether the intelligence describes the commit the run works against.
 *
 * `fresh` is the only state in which repository facts are presented as
 * established. `stale` and `unknown` still produce a brief — the plan, the
 * decisions and the objective do not depend on a commit — but every
 * repository-derived fact is withheld, because a path that moved is worse than
 * no path at all: it sends the agent somewhere confidently wrong.
 */
export const FRESHNESS_STATES = ["fresh", "stale", "unknown"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export type BriefFreshness = {
  state: FreshnessState;
  /** The commit the intelligence was taken at. Null when there is none. */
  snapshotSha: string | null;
  /** The commit this execution runs against. */
  executionSha: string;
  snapshotId: string | null;
};

/**
 * How a live deployment relates to the repository revision.
 *
 * Three states and no fourth, because there is no evidence anywhere in this
 * product that ties a deployed origin to a Git SHA. Today every answer is
 * `unknown`, and saying so is the point: `verified` would be a claim about a
 * deployment record that does not exist.
 */
export const LIVE_RELATIONS = ["verified", "inferred", "unknown"] as const;
export type LiveRelation = (typeof LIVE_RELATIONS)[number];

export type LiveProductContext = {
  origin: string | null;
  relationToRepository: LiveRelation;
};

/**
 * What was left out, and why.
 *
 * Recorded rather than silent for the same reason a truncated listing is: a
 * bounded selection presented as the whole of what is known is how a reader
 * comes to believe Vibe knows less than it does.
 */
export type BriefTruncation = {
  factsOmitted: number;
  candidatesOmitted: number;
};

/**
 * What the step's cited evidence said its surface is, and what resolving it
 * against the pinned snapshot produced.
 *
 * Carried on the brief rather than recomputed, so a stored run answers "how many
 * public pages did Vibe actually know about, and how many fitted?" without
 * re-deriving anything.
 */
export type BriefSurface = {
  requirement: ExecutionSurfaceRequirement;
  publicPagesResolved: number;
  publicPagesIncluded: number;
  authenticatedPagesResolved: number;
  authenticatedPagesIncluded: number;
};

/**
 * How large the thing being compressed was (Sprint 0053).
 *
 * Every other number on this brief measures **what Vibe sent** — a bounded,
 * Vibe-controlled compression. None of them measures **how big the repository
 * being compressed was**, and run #9 showed why that matters: the same Action
 * Step, at the same pricing class, cost 2.16× what its previous pass cost,
 * because the repository had grown three relevant files underneath it.
 * `candidatesRendered` went 6 → 12 — against a cap of exactly 12, so the metric
 * was saturated and could not tell a repository with twelve relevant files from
 * one with fifty.
 *
 * These are read straight off the pinned snapshot's own `AnalysisMetrics` and
 * route table. Nothing is re-derived and nothing is fetched: the analyzer
 * already counted all of it, and this carries the counts onto the run so that
 * repository shape and run cost are joinable in one query rather than by
 * walking back to the snapshot.
 *
 * ## Why every field is nullable, and why null is never zero
 *
 * A run whose snapshot is stale or absent has no size *at the commit it ran
 * against*. The snapshot describes a different tree, and reporting its size as
 * this run's would be the confidently-wrong number the freshness gate exists to
 * refuse. Null says "not measured"; zero would say "an empty repository".
 *
 * ## What this is not
 *
 * Not a copy of the repository, and not a step toward one (Rule 26). Six
 * integers derived from intelligence Vibe already stores — no path, no name, no
 * content.
 */
export type BriefRepositoryScale = {
  /** Tree entries the analyzer considered at this commit. */
  treeEntries: number | null;
  /** Files whose contents it actually fetched. */
  filesAnalyzed: number | null;
  /** Bytes of those files. The analyzer's own read budget, not the tree's size. */
  bytesAnalyzed: number | null;
  /** Routes the analyzer resolved. The closest thing to "how much product". */
  routesDetected: number | null;
  /** Business surfaces it recognised. */
  surfacesDetected: number | null;
  /**
   * Candidates the compiler had *before* `BRIEF_BUDGET.maxCandidates` cut the
   * list. The one number that de-saturates `candidatesRendered`: it makes "the
   * brief was clipped" visible instead of indistinguishable from "the
   * repository happened to offer exactly twelve".
   */
  candidatesAvailable: number;
};

export type ExecutionBrief = {
  briefVersion: string;

  /* What is being asked. From the plan; already fenced when rendered. */
  task: string;
  businessIntent: string;
  doneWhen: string;

  facts: readonly ContextFact[];
  fileCandidates: readonly FileCandidate[];

  /**
   * Areas the step is believed not to touch.
   *
   * Stated as *believed*, never as a prohibition — the write scope is what
   * actually bounds the change, and a hint that hardened into a rule would be a
   * second, unversioned policy competing with the compiled one.
   */
  likelyIrrelevantAreas: readonly string[];

  live: LiveProductContext;
  freshness: BriefFreshness;
  truncated: BriefTruncation;
  surface: BriefSurface;
  /** Observability only — never rendered into the prompt. */
  repositoryScale: BriefRepositoryScale;
};

/* ---------------------------------------------------------------------------
 * Bounds
 * ------------------------------------------------------------------------ */

/**
 * How large a brief may get.
 *
 * A ceiling, not a target. The failure this prevents is the one PART H names:
 * "give the agent more context" becoming "give the agent the whole audit", which
 * costs more than the exploration it replaces. Twenty facts and twelve
 * candidates is comfortably more than any single step needs and far less than
 * any complete document.
 *
 * The rendered-byte cap is the one that actually binds, because it is the one
 * the provider bills for.
 */
export const BRIEF_BUDGET = {
  maxFacts: 20,
  maxCandidates: 12,
  maxEvidencePerFact: 3,
  maxIrrelevantAreas: 8,
  /** Rendered prompt bytes. ~1.5 KB is roughly 400 tokens. */
  maxRenderedBytes: 6144,
} as const;

/** Collapsed, trimmed and cut. Applied to every string that enters a brief. */
export function boundText(value: string, max = MAX_FACT_VALUE): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}

/**
 * Ranks facts so a cap keeps the strongest.
 *
 * Confidence first, then source. The spec ranks first because it is immutable
 * and pinned; a deterministic repository scan outranks a model-built profile;
 * a live scan ranks last because nothing ties it to the commit being worked on.
 * Within a tier the compiler's own order is kept, which makes the selection
 * deterministic — the same inputs produce the same brief, which is what makes a
 * stored run re-readable.
 */
const SOURCE_RANK: Record<FactSource, number> = {
  execution_spec: 0,
  repository_scan: 1,
  product_profile: 2,
  live_product_scan: 3,
};

const CONFIDENCE_RANK: Record<FactConfidence, number> = { high: 0, medium: 1, low: 2 };

export function rankFacts(facts: readonly ContextFact[]): ContextFact[] {
  return [...facts]
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => {
      const byConfidence =
        CONFIDENCE_RANK[a.fact.confidence] - CONFIDENCE_RANK[b.fact.confidence];
      if (byConfidence !== 0) return byConfidence;

      const bySource = SOURCE_RANK[a.fact.source] - SOURCE_RANK[b.fact.source];
      if (bySource !== 0) return bySource;

      return a.index - b.index;
    })
    .map((entry) => entry.fact);
}

export function rankCandidates(candidates: readonly FileCandidate[]): FileCandidate[] {
  return [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const byConfidence =
        CONFIDENCE_RANK[a.candidate.confidence] - CONFIDENCE_RANK[b.candidate.confidence];
      return byConfidence !== 0 ? byConfidence : a.index - b.index;
    })
    .map((entry) => entry.candidate);
}
