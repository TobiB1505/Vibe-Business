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

const CONFIGS: Record<AIOperation, OperationConfig> = {
  business_readiness_audit: BUSINESS_READINESS_AUDIT_CONFIG,
};

export function getOperationConfig(operation: AIOperation): OperationConfig {
  return CONFIGS[operation];
}
