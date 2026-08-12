import type { AIEffort, AIOperation } from "./provider";

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
  effort: AIEffort;
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
  effort: "high",
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
  effort: "high",
  maxOutputTokens: 12_000,
  maxInputTokens: 40_000,
};

const CONFIGS: Record<AIOperation, OperationConfig> = {
  business_readiness_audit: BUSINESS_READINESS_AUDIT_CONFIG,
  opportunity_generation: OPPORTUNITY_GENERATION_CONFIG,
};

export function getOperationConfig(operation: AIOperation): OperationConfig {
  return CONFIGS[operation];
}
