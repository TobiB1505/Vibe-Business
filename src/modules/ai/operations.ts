import type { AIOperation, AIReasoning } from "./provider";

/**
 * Central configuration for every AI operation (Sprint 4 §10).
 *
 * Model identifiers, effort levels and token budgets live here and nowhere
 * else. No route handler, Server Action, or component may name a model, and
 * nothing user-supplied may select one — a model chooser would let a caller
 * pick an expensive model on our bill.
 */

export type OperationConfig = {
  operation: AIOperation;
  model: string;
  /**
   * Reasoning depth, stated as a capability of the chosen model rather than as
   * a free-standing preference — see `AIReasoning`. It lives beside `model`
   * deliberately: the two are one decision, and separating them is what let a
   * model that cannot take an effort level be configured with one.
   */
  reasoning: AIReasoning;
  /**
   * Hard ceiling on generated tokens. Under adaptive thinking, reasoning
   * counts toward this limit too, so it is set well above the size of the
   * expected JSON: the audit schema is compact, but truncating it mid-object
   * would waste the whole (paid) call.
   */
  maxOutputTokens: number;
  /**
   * Refuse to send a request whose counted input exceeds this (Sprint 4 §14).
   * A V0.1 evidence pack is a few thousand tokens, so this is roughly an
   * order of magnitude of headroom — it exists to catch a pathological
   * snapshot, not to trim normal ones.
   */
  maxInputTokens: number;
};

export const BUSINESS_READINESS_AUDIT_CONFIG: OperationConfig = {
  operation: "business_readiness_audit",
  // Sonnet 5 is the production audit model. Judging business readiness from
  // mixed evidence is a nuanced reasoning task, not extraction, so the
  // model is chosen for judgement quality at a price that keeps a
  // per-project audit in fractions of a cent.
  model: "claude-sonnet-5",
  // `high` is Sonnet 5's API default and the right first setting for a task
  // where we are about to measure quality: stepping down to `medium` is a
  // cost optimization to make *after* there is a quality baseline to
  // compare against, not before.
  reasoning: { mode: "adaptive", effort: "high" },
  maxOutputTokens: 16_000,
  maxInputTokens: 30_000,
};

/**
 * Prioritization (Sprint 8 §19).
 *
 * Its own config, deliberately: the audit's settings are a measured baseline
 * and changing them to suit a second operation would invalidate every audit
 * comparison made so far.
 *
 * Same model and effort as the audit, for the same reason — deciding what a
 * founder should do next from mixed evidence is judgement, not extraction, and
 * `high` is the right first setting when quality has yet to be measured.
 *
 * The budgets differ. Output is smaller because at most 5 opportunities is a
 * far smaller object than a five-dimension audit, and input is larger because
 * this operation sends the audit *and* the evidence pack it came from.
 */
export const OPPORTUNITY_GENERATION_CONFIG: OperationConfig = {
  operation: "opportunity_generation",
  model: "claude-sonnet-5",
  reasoning: { mode: "adaptive", effort: "high" },
  maxOutputTokens: 12_000,
  maxInputTokens: 40_000,
};

/**
 * Product Understanding (CORE-1 §21).
 *
 * The first operation configured for **cost** rather than for judgement, and
 * the reason is a product decision, not a technical one: this runs inside the
 * free understanding flow that every new project goes through. An operation
 * every user hits before paying anything has to be cheap enough that the
 * answer to "should we run it?" is always yes.
 *
 * Haiku 4.5 rather than Sonnet 5, because the task is genuinely easier than
 * the audit's. The hard half of understanding a product — which surfaces
 * exist, what a person can do, what the brand is — is answered
 * deterministically before this call. What remains is reading a page of
 * structured facts and writing three sentences about it: summarisation with
 * a closed vocabulary, not judgement from mixed evidence.
 *
 * No thinking and no effort, and that is a fact about the model before it is a
 * preference. Haiku 4.5 predates adaptive thinking and the effort control:
 * it rejects both, so a request carrying them is refused outright rather than
 * degraded. This config originally asked for `medium` effort, which made every
 * Product Understanding run fail on its first call to the API — including the
 * free token count, so the feature broke before it could spend anything.
 *
 * The task also does not want them. The hard half of understanding a product
 * is answered deterministically before this call; what remains is summarising
 * a page of structured facts, which is the work `none` describes.
 *
 * Budgets are smaller than the audit's on both sides. Input is a single
 * product's evidence with no rubric and no prior audit attached; output is
 * eleven short fields.
 */
export const PRODUCT_UNDERSTANDING_CONFIG: OperationConfig = {
  operation: "product_understanding",
  model: "claude-haiku-4-5-20251001",
  reasoning: { mode: "none" },
  maxOutputTokens: 6_000,
  maxInputTokens: 24_000,
};

const CONFIGS: Record<AIOperation, OperationConfig> = {
  business_readiness_audit: BUSINESS_READINESS_AUDIT_CONFIG,
  opportunity_generation: OPPORTUNITY_GENERATION_CONFIG,
  product_understanding: PRODUCT_UNDERSTANDING_CONFIG,
};

export function getOperationConfig(operation: AIOperation): OperationConfig {
  return CONFIGS[operation];
}
