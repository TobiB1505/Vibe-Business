/**
 * The ceilings both seams run under (ADR 0109 §7, pilot values).
 *
 * Every number here is a hard stop enforced by the loop in code — never a
 * sentence in a prompt. A model that wants a ninth tool call does not get
 * one; a turn whose transcript would exceed the per-call input ceiling is
 * refused before the call is made, by the free token count.
 *
 * The values are pilot values: small enough that a runaway trajectory costs
 * cents, large enough that every case in `cases.ts` can be solved inside
 * them. The audit proposed 8 model calls and 12 tool calls for production;
 * the pilot deliberately runs tighter so that "stopped within the ceiling"
 * is a claim about the model's own stopping and not about a generous limit.
 */
export type PilotBudgets = {
  /** Model calls per turn, including the one that answers. */
  maxModelCalls: number;
  /** Tool calls per turn, executed or refused alike — a refusal still cost a call. */
  maxToolCalls: number;
  /** Output tokens summed over every model call of the turn. */
  maxTotalOutputTokens: number;
  /** Per model call, checked by the free count before the paid call. */
  maxInputTokensPerCall: number;
  /** A tool result is cut to this many bytes before it reaches the model. */
  maxToolResultBytes: number;
};

export const PILOT_BUDGETS: PilotBudgets = {
  maxModelCalls: 6,
  maxToolCalls: 8,
  maxTotalOutputTokens: 6_000,
  maxInputTokensPerCall: 24_000,
  maxToolResultBytes: 4_096,
};

/** The founder's own message is bounded too, before it is fenced. */
export const MAX_FOUNDER_MESSAGE_CHARS = 2_000;
