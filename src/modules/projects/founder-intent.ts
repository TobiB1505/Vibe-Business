import { createHash } from "node:crypto";

/**
 * Founder Intent (CORE-2 §4, §5).
 *
 * ## What this is, and what it deliberately is not
 *
 * This is what remains of Sprint 4's Business Context after CORE-2 retired it
 * as a competing model. The Product Profile is now the single semantic answer
 * to *"what is this product?"*, so anything that was really a product fact no
 * longer lives here — it was migrated into the profile as a user-confirmed
 * claim, which is a stronger home for it than this table ever was:
 *
 *     productSummary   →  profile correction `shortDescription`
 *     targetCustomer   →  profile correction `primaryAudience`
 *
 * Both arrive in the profile as `confidence: "confirmed"` with source
 * `user_confirmed`, which is exactly the semantics CORE-2 §5 asks for and
 * which a second parallel table could never have expressed.
 *
 * What is left is the part the Product Profile genuinely cannot answer, and
 * must not be asked to. A profile describes the product as it exists. These
 * three fields describe **the founder's own position and intention**:
 *
 *  - `stage`             where they think they are
 *  - `primaryGoal`       what they are trying to do next
 *  - `monetizationModel` how they *intend* to make money
 *
 * The third is the one worth defending, because CORE-2 §4 names "pricing
 * model" and "business model" among the concepts that must not be duplicated.
 * It is not duplicated. The profile owns what is *observable* — whether a
 * pricing surface exists, whether payment or subscription capability is
 * present — as `businessSignals` derived from evidence. This field holds
 * something evidence cannot see: a declared intention, whose most useful value
 * is `planned`, meaning precisely that nothing is observable yet. An audit that
 * cannot tell "no monetization, and none intended" from "no monetization yet,
 * subscription planned" would prioritize the same work for two very different
 * businesses.
 *
 * Deliberately small: three fields, all closed enums, all optional. There is no
 * free text here at all any more — which also means this layer can no longer
 * carry anything sensitive, and nothing typed here can reach a model as prose.
 *
 * Values still reach an AI model as evidence, never as instruction (ADR 0011),
 * but they are enum labels chosen by us rather than text chosen by a user.
 */

export const PROJECT_STAGES = [
  "prototype",
  "launched_no_users",
  "active_users",
  "paid_customers",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const MONETIZATION_MODELS = [
  "none",
  "planned",
  "free",
  "subscription",
  "one_time",
  "usage_based",
  "marketplace",
  "other",
] as const;
export type MonetizationModel = (typeof MONETIZATION_MODELS)[number];

export const PRIMARY_GOALS = [
  "launch",
  "get_first_users",
  "monetize",
  "improve_conversion",
  "improve_retention",
  "grow_revenue",
] as const;
export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];

/**
 * Every field is optional.
 *
 * This is the second thing CORE-2 changed. Business Context had one required
 * field — `productSummary` — and it was a hard prerequisite for a first audit:
 * a founder could not be audited until they had typed a paragraph describing
 * their own product. That requirement existed because nothing else could
 * answer "what is this product?". The Product Profile answers it now, from
 * evidence, before anyone is asked anything. So the gate is gone, and with it
 * the reason to demand any of this before an audit can run.
 */
export type FounderIntent = {
  stage: ProjectStage | null;
  monetizationModel: MonetizationModel | null;
  primaryGoal: PrimaryGoal | null;
};

export const EMPTY_FOUNDER_INTENT: FounderIntent = {
  stage: null,
  monetizationModel: null,
  primaryGoal: null,
};

export type FounderIntentRejection =
  | "invalid_stage"
  | "invalid_monetization_model"
  | "invalid_primary_goal";

export type ParseFounderIntentResult =
  | { ok: true; intent: FounderIntent }
  | { ok: false; error: FounderIntentRejection };

function optionalEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): { ok: true; value: T[number] | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  return allowed.includes(value) ? { ok: true, value: value as T[number] } : { ok: false };
}

/**
 * Validates raw form input into a `FounderIntent`.
 *
 * Pure and synchronous so the same rules apply wherever intent enters the
 * system, and so they can be tested without a database.
 */
export function parseFounderIntent(input: {
  stage?: unknown;
  monetizationModel?: unknown;
  primaryGoal?: unknown;
}): ParseFounderIntentResult {
  const stage = optionalEnum(input.stage, PROJECT_STAGES);
  if (!stage.ok) return { ok: false, error: "invalid_stage" };

  const monetizationModel = optionalEnum(input.monetizationModel, MONETIZATION_MODELS);
  if (!monetizationModel.ok) return { ok: false, error: "invalid_monetization_model" };

  const primaryGoal = optionalEnum(input.primaryGoal, PRIMARY_GOALS);
  if (!primaryGoal.ok) return { ok: false, error: "invalid_primary_goal" };

  return {
    ok: true,
    intent: {
      stage: stage.value,
      monetizationModel: monetizationModel.value,
      primaryGoal: primaryGoal.value,
    },
  };
}

/** True when the founder has stated nothing. A legitimate, auditable state. */
export function isEmptyFounderIntent(intent: FounderIntent): boolean {
  return (
    intent.stage === null && intent.monetizationModel === null && intent.primaryGoal === null
  );
}

/**
 * Content hash of founder intent, forming part of an audit's input identity
 * (CORE-2 §7).
 *
 * Field order is fixed rather than taken from object key order, so the hash
 * depends only on the values: re-saving the form unchanged produces the same
 * hash and correctly reuses the existing audit, while any real change
 * invalidates it and buys a fresh one.
 *
 * An empty intent hashes to a stable value like any other, rather than to a
 * sentinel. "The founder stated nothing" is a real input to an audit, and it
 * has to be distinguishable from "the founder stated a prototype stage" in the
 * identity — otherwise filling the form in for the first time would silently
 * return the audit that was produced before it was filled in.
 */
export function hashFounderIntent(intent: FounderIntent): string {
  const canonical = JSON.stringify([
    intent.stage,
    intent.monetizationModel,
    intent.primaryGoal,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export const STAGE_LABELS: Record<ProjectStage, string> = {
  prototype: "Prototype",
  launched_no_users: "Launched, no users yet",
  active_users: "Has active users",
  paid_customers: "Has paying customers",
};

export const MONETIZATION_LABELS: Record<MonetizationModel, string> = {
  none: "No monetization",
  planned: "Monetization planned but not built",
  free: "Free product",
  subscription: "Subscription",
  one_time: "One-time payment",
  usage_based: "Usage-based",
  marketplace: "Marketplace / commission",
  other: "Other",
};

export const GOAL_LABELS: Record<PrimaryGoal, string> = {
  launch: "Launch",
  get_first_users: "Get first users",
  monetize: "Start monetizing",
  improve_conversion: "Improve conversion",
  improve_retention: "Improve retention",
  grow_revenue: "Grow revenue",
};
