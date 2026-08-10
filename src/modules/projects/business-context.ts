import { createHash } from "node:crypto";

/**
 * Business Context (Sprint 4 §2).
 *
 * Repository and website evidence describe what was *built* and what is
 * *served*. Neither can tell us who the product is for, what stage it is
 * at, or what the founder is actually trying to do next — and an audit that
 * guesses those is worse than one that asks.
 *
 * Deliberately small: five fields, four of them closed enums. This is not a
 * founder questionnaire, and it asks for nothing sensitive — no revenue, no
 * financial data, no personal information (Sprint 4 §2).
 *
 * Every free-text value here is UNTRUSTED DATA. It reaches an AI model as
 * evidence, never as instruction (ADR 0011).
 */

export const PROJECT_STAGES = ["prototype", "launched_no_users", "active_users", "paid_customers"] as const;
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

/** Bounded so a pasted document cannot become the prompt (Sprint 4 §2). */
export const PRODUCT_SUMMARY_MAX_LENGTH = 600;
export const PRODUCT_SUMMARY_MIN_LENGTH = 20;
export const TARGET_CUSTOMER_MAX_LENGTH = 300;

export type BusinessContext = {
  /** Required before a first audit — the one field nothing else can supply. */
  productSummary: string;
  targetCustomer: string | null;
  stage: ProjectStage | null;
  monetizationModel: MonetizationModel | null;
  primaryGoal: PrimaryGoal | null;
};

export type BusinessContextRejection =
  | "product_summary_required"
  | "product_summary_too_short"
  | "product_summary_too_long"
  | "target_customer_too_long"
  | "invalid_stage"
  | "invalid_monetization_model"
  | "invalid_primary_goal";

export type ParseBusinessContextResult =
  | { ok: true; context: BusinessContext }
  | { ok: false; error: BusinessContextRejection };

/**
 * Collapses whitespace and trims.
 *
 * C0/C1 control characters are stripped rather than escaped: this text is
 * rendered into a fenced evidence block for a model, and a stray newline or
 * control byte is the cheapest way to try to fake a fence boundary.
 */
function normalizeText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function optionalEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): { ok: true; value: T[number] | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  return allowed.includes(value) ? { ok: true, value: value as T[number] } : { ok: false };
}

/**
 * Validates raw form input into a `BusinessContext`.
 *
 * Pure and synchronous so it is fully unit-testable, and so the same rules
 * apply wherever context enters the system.
 */
export function parseBusinessContext(input: {
  productSummary: unknown;
  targetCustomer?: unknown;
  stage?: unknown;
  monetizationModel?: unknown;
  primaryGoal?: unknown;
}): ParseBusinessContextResult {
  if (typeof input.productSummary !== "string") return { ok: false, error: "product_summary_required" };

  const productSummary = normalizeText(input.productSummary);
  if (productSummary.length === 0) return { ok: false, error: "product_summary_required" };
  if (productSummary.length < PRODUCT_SUMMARY_MIN_LENGTH) {
    return { ok: false, error: "product_summary_too_short" };
  }
  if (productSummary.length > PRODUCT_SUMMARY_MAX_LENGTH) {
    return { ok: false, error: "product_summary_too_long" };
  }

  let targetCustomer: string | null = null;
  if (typeof input.targetCustomer === "string") {
    const normalized = normalizeText(input.targetCustomer);
    if (normalized.length > TARGET_CUSTOMER_MAX_LENGTH) {
      return { ok: false, error: "target_customer_too_long" };
    }
    targetCustomer = normalized.length === 0 ? null : normalized;
  }

  const stage = optionalEnum(input.stage, PROJECT_STAGES);
  if (!stage.ok) return { ok: false, error: "invalid_stage" };

  const monetizationModel = optionalEnum(input.monetizationModel, MONETIZATION_MODELS);
  if (!monetizationModel.ok) return { ok: false, error: "invalid_monetization_model" };

  const primaryGoal = optionalEnum(input.primaryGoal, PRIMARY_GOALS);
  if (!primaryGoal.ok) return { ok: false, error: "invalid_primary_goal" };

  return {
    ok: true,
    context: {
      productSummary,
      targetCustomer,
      stage: stage.value,
      monetizationModel: monetizationModel.value,
      primaryGoal: primaryGoal.value,
    },
  };
}

/**
 * Content hash of a business context, used as part of an audit's input
 * identity (Sprint 4 §23).
 *
 * Field order is fixed rather than taken from object key order, so the hash
 * depends only on the values — an edit that changes nothing produces the
 * same hash and correctly reuses the existing audit, while any real change
 * invalidates it.
 */
export function hashBusinessContext(context: BusinessContext): string {
  const canonical = JSON.stringify([
    context.productSummary,
    context.targetCustomer,
    context.stage,
    context.monetizationModel,
    context.primaryGoal,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
