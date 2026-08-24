import type { BusinessLens, Confidence } from "@/modules/business-audit/schema";

/**
 * The Opportunity domain model (Sprint 8 §3, §4).
 *
 * Deliberately its own versioned model rather than an enrichment of the audit.
 * The audit answers *"what is the current state?"*; an opportunity answers
 * *"what should be worked on next?"*. Mutating audit findings into imperatives
 * would collapse the two, and neither could then be evaluated on its own
 * terms — a wrong diagnosis and a wrong priority are different failures with
 * different fixes.
 *
 * Every enum here is coarse on purpose. `high | medium | low` is what the
 * evidence can actually support; a percentage or an hour estimate would be
 * precision the model does not have and the user would reasonably act on.
 */

/**
 * v2 recorded **which audit conclusion each Move came from** (CORE-2b FIX §1, §2).
 *
 * The engine has always known this — it reads the audit's conclusions and decides what
 * to do about them — and it always threw the answer away. The Action Planner then had to
 * reconstruct it from evidence overlap, which is a reasonable way to recover a fact and
 * a bad way to hold one: reconstruction can be ambiguous, and a strategic plan built on
 * a guessed root problem is exactly the failure this product exists not to have.
 *
 * So the relationship is stated at creation time by the layer that knows it.
 *
 * v3 moves the attribution vocabulary from the five retired dimensions to the
 * nine business lenses ([ADR 0050 §5]). A Move now names the lens it most
 * belongs to — the same vocabulary the audit reasons in — so the chain
 * audit → conclusion → Move speaks one language end to end. The versions move
 * because they feed the reuse identity (rule 48): a dimension-attributed set
 * is no longer an acceptable answer to "what should this founder do next?".
 */
export const OPPORTUNITY_SCHEMA_VERSION = "business-opportunity.v3" as const;
export const OPPORTUNITY_SET_SCHEMA_VERSION = "business-opportunity-set.v3" as const;

/** Bumped when prioritization behaviour changes materially (§22). */
export const OPPORTUNITY_ENGINE_VERSION = "opportunity-engine-v3" as const;

/**
 * Focus is the product (§1, §21).
 *
 * A backlog of twenty is a way of avoiding the decision the founder is paying
 * us to make. Three is the default; five is the ceiling the schema and the
 * validator both enforce.
 */
export const DEFAULT_OPPORTUNITY_COUNT = 3;
export const MAX_OPPORTUNITIES = 5;

/** If addressed, how meaningful this could be — never a guaranteed outcome. */
export type OpportunityImpact = "high" | "medium" | "low";

/** Approximate implementation and business effort. No hour estimates (§6). */
export type OpportunityEffort = "high" | "medium" | "low";

/**
 * What Vibe might eventually be able to do about it (§9).
 *
 * Recorded now so Sprint 9 can pick one safe category to execute, rather than
 * discovering afterwards that the model never distinguished "change some copy"
 * from "call fifty prospects".
 */
export const EXECUTION_TYPES = [
  "code_change",
  "content_change",
  "configuration_change",
  "business_decision",
  "research",
  "manual_external_action",
  "measurement",
] as const;
export type ExecutionType = (typeof EXECUTION_TYPES)[number];

/**
 * Whether Vibe could act on it today (§10).
 *
 * The honest middle value is the important one: plenty of real opportunities
 * are blocked on a founder's decision, and labelling those `ready` would make
 * a future "Let Vibe do it" button lie.
 */
export const EXECUTION_READINESS = ["ready", "needs_user_input", "not_supported_yet"] as const;
export type ExecutionReadiness = (typeof EXECUTION_READINESS)[number];

/**
 * A small vocabulary for grouping and duplicate detection (§17, §18).
 *
 * Separate from the business lenses on purpose: a lens says which part of the
 * business is weak, a category says what kind of work this is. They are not
 * the same axis, and merging them would force "add analytics" to pretend to
 * be a retention problem.
 */
export const OPPORTUNITY_CATEGORIES = [
  "positioning",
  "monetization",
  "acquisition",
  "conversion",
  "onboarding",
  "retention",
  "analytics",
  "trust",
  "seo",
  "product",
] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

export type BusinessOpportunity = {
  /** Stable within a set. Deterministic, derived from category and rank. */
  id: string;
  /**
   * The audit conclusion this Move exists to address (CORE-2b FIX §1).
   *
   * A key into the set's own audit — see `business-audit/conclusions.ts` for why a
   * conclusion is addressed by `(business_audit_id, conclusion_key)` rather than by a
   * single foreign key. The audit id lives on the set, so together they are a complete,
   * canonical reference.
   *
   * **This is the authoritative relationship** (§3). The Action Planner's evidence-overlap
   * reconciliation is a legacy fallback for sets written before v2, and is never
   * consulted when this is present.
   *
   * Null on legacy sets, and on a Move whose cited key did not exist in the audit — a
   * fabricated reference is dropped rather than stored, exactly as a fabricated evidence
   * id is (Rule 45). Null means "unknown", never "none".
   */
  sourceConclusionKey: string | null;
  /** 1-based, unique and contiguous within the set (§12). */
  rank: number;
  title: string;
  /** What is wrong or missing, stated as a current-state problem. */
  problem: string;
  /** Why this deserves attention now rather than later (§13). */
  whyNow: string;
  impact: OpportunityImpact;
  effort: OpportunityEffort;
  /** Confidence that the problem exists and matters — not expected impact (§7). */
  confidence: Confidence;
  category: OpportunityCategory;
  /**
   * The business lens this Move most belongs to (§8, ADR 0050 §5).
   *
   * Null only on Moves stored before `business-opportunity.v3`, which were
   * attributed to a retired dimension instead; their stored attribution is a
   * record and is not translated. Validation always sets a lens on a new Move.
   */
  primaryLens: BusinessLens | null;
  secondaryLenses: BusinessLens[];
  /** Evidence ids from the pack, validated to exist (§14). */
  evidenceIds: string[];
  executionType: ExecutionType;
  executionReadiness: ExecutionReadiness;
  /**
   * What must happen first — either a decision the founder owes, or another
   * opportunity in this set by rank. Prerequisite ordering is a first-class
   * output, not an implied reading of the list (§11).
   */
  dependencies: string[];
};

export type OpportunitySet = {
  schemaVersion: typeof OPPORTUNITY_SET_SCHEMA_VERSION;
  opportunitySchemaVersion: typeof OPPORTUNITY_SCHEMA_VERSION;
  engineVersion: typeof OPPORTUNITY_ENGINE_VERSION;
  promptVersion: string;
  rubricVersion: string;
  evidencePackVersion: string;
  /** The audit this prioritization was derived from. */
  auditId: string;
  provider: string;
  model: string;
  opportunities: BusinessOpportunity[];
  /** Integrity notes from validation, e.g. dropped ids or merged duplicates. */
  validationNotes: string[];
  generatedAt: string;
};

export const IMPACT_LABELS: Record<OpportunityImpact, string> = {
  high: "High impact",
  medium: "Medium impact",
  low: "Low impact",
};

export const EFFORT_LABELS: Record<OpportunityEffort, string> = {
  high: "High effort",
  medium: "Medium effort",
  low: "Low effort",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

/** User-facing execution copy. Never promises automation that does not exist. */
export const EXECUTION_READINESS_LABELS: Record<ExecutionReadiness, string> = {
  ready: "Ready for Vibe",
  needs_user_input: "Needs your input",
  not_supported_yet: "Not automated yet",
};
