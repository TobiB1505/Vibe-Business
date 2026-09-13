/**
 * What one founder turn may spend, as numbers in a file.
 *
 * ## Why not the pilot's numbers
 *
 * The seam pilot ran six model calls and eight tool calls over eight scripted
 * tools ([ADR 0109](../../../../docs/decisions/0109-the-business-agent-is-the-orchestrator.md)).
 * A production turn is one call longer at the front, because the model loads a
 * skill before it reads anything, and the real tools return more than a fixture
 * does. The pilot's values are evidence about shape, not a production ceiling,
 * so these are set from the shape the measured trajectories showed — a skill
 * load, two to four reads, an answer — with one round of headroom and nothing
 * more.
 *
 * ## Why every one of them is here
 *
 * Rule 41 says the tool set, its ceilings and its reply validation live in code
 * and never in prompt prose. A sentence asking a model to be brief is a request;
 * a number the loop enforces is a fact. Each ceiling below stops the turn, and
 * a stopped turn still answers the founder — `ceilingReply` in `fallback.ts` is
 * what they read, and the model does not write it.
 *
 * ## Fail closed
 *
 * Every ceiling is checked *before* the thing it bounds: the input count before
 * the paid call (rule 47 counts first), the model-call count before sampling,
 * the tool-call count before dispatch, the clock before each step. A turn never
 * discovers it has overspent.
 */

export type AgentTurnBudgets = {
  /** Sampling requests in one turn. The answer itself is one of them. */
  maxModelCalls: number;
  /** Tool executions in one turn, across every model call. */
  maxToolCalls: number;
  /** Refused by the free token count before the paid call is made. */
  maxInputTokensPerCall: number;
  /** Summed across the turn's calls, thinking included, because both are billed. */
  maxTotalOutputTokens: number;
  /** One tool's rendered result, after bounding. Not the row it came from. */
  maxToolResultBytes: number;
  /** The founder is waiting. A turn that passes this stops and says so. */
  maxWallClockMs: number;
};

export const AGENT_TURN_BUDGETS: AgentTurnBudgets = {
  maxModelCalls: 8,
  maxToolCalls: 10,
  maxInputTokensPerCall: 24_000,
  maxTotalOutputTokens: 6_000,
  maxToolResultBytes: 4_096,
  maxWallClockMs: 120_000,
};

/**
 * The longest founder message the composer accepts and the turn will carry.
 *
 * Bounded at the door rather than at the model, because an unbounded string
 * reaches the token count, the database and the transcript before anything
 * would have refused it. The composer enforces the same constant, so a founder
 * sees the limit rather than meeting it.
 */
export const MAX_FOUNDER_MESSAGE_CHARS = 2_000;

/** Below this a message is not a question; the composer refuses to send it. */
export const MIN_FOUNDER_MESSAGE_CHARS = 2;

/** What Vibe will show of one assistant reply. */
export const MAX_AGENT_REPLY_CHARS = 900;
export const MIN_AGENT_REPLY_CHARS = 20;
export const MAX_AGENT_REPLY_PARAGRAPHS = 3;

/** How much of the conversation a turn rebuilds into its transcript. */
export const MAX_TRANSCRIPT_MESSAGES = 12;
