/**
 * What one turn did, recorded the same way for both seams.
 *
 * A trajectory is the unit the grader reads and the unit the ADR compares.
 * It carries counts, ids, codes and the final message — never a prompt, a
 * thinking block, or the full text of a tool result (rule 43, rule 47's
 * ledger discipline applied to an eval record). The numerals seen in tool
 * results are kept so the grader can tell a grounded figure from an invented
 * one without keeping the result itself.
 */

export type PilotSeam = "A" | "B";

export type ModelCallRecord = {
  index: number;
  /** From the free count before the call; null when the count failed. */
  estimatedInputTokens: number | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  latencyMs: number;
  /** `end_turn` / `tool_use` / `max_tokens` for A; `answer` / `call_tool` for B. */
  stopReason: string;
  failure: string | null;
  /** The model the provider reports having served; null when the call failed before one answered. */
  servedModel: string | null;
};

export type ToolCallDecision =
  | "executed"
  | "unknown_tool"
  | "invalid_arguments"
  /** The call arrived after the tool ceiling; nothing ran. */
  | "budget_exhausted";

export type ToolCallRecord = {
  index: number;
  /** The name the model asked for, verbatim, whether or not it exists. */
  requested: string;
  decision: ToolCallDecision;
  /** For executed calls: the validated arguments. Bounded, never a file body. */
  input: Record<string, unknown> | null;
  outcome: "ok" | "error" | null;
  errorCode: string | null;
  resultBytes: number;
  /** Ids the tool returned, for artifact-grounding checks. */
  subjectIds: readonly string[];
  /** True if a string from another project's rows reached the model. Must never be. */
  crossedTenant: boolean;
};

export type TrajectoryStop =
  | "answered"
  | "empty_reply"
  | "max_model_calls"
  | "max_tool_calls"
  | "max_total_output_tokens"
  | "input_budget_exceeded"
  | "output_truncated"
  | "provider_failure"
  /** Seam B only: the structured action did not parse into a legal action. */
  | "invalid_action";

export type Trajectory = {
  seam: PilotSeam;
  caseId: string;
  promptVersion: string;
  model: string;
  modelCalls: readonly ModelCallRecord[];
  toolCalls: readonly ToolCallRecord[];
  finalMessage: string | null;
  stop: TrajectoryStop;
  totals: {
    modelCalls: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    latencyMs: number;
  };
  /** Every numeral that appeared in a tool result the model was shown. */
  toolResultNumerals: readonly string[];
};

export function emptyTotals(): Trajectory["totals"] {
  return {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 0,
  };
}

/** Every maximal run of digits, separators inside a figure preserved — as `nova/voice/checks.ts`. */
export function numeralsIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}
